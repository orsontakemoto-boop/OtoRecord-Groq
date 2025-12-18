
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { processConsultationAudio } from './services/geminiService';
import { AppState, ConsultationSummary, AppSettings } from './types';
import SummaryCard from './components/SummaryCard';

const DEFAULT_SETTINGS: AppSettings = {
  startStopKey: 'F5',
  copyKey: 'F6'
};

const FAREWELL_WORDS = [
  'tchau', 'até mais', 'até logo', 'quando precisar', 
  'me ligue', 'me liga', 'bom descanso', 'obrigado doutor', 
  'obrigada doutor', 'pode ir', 'tá bom então', 'até a próxima'
];

const App: React.FC = () => {
  const [appState, setAppState] = useState<AppState>(AppState.IDLE);
  const [summary, setSummary] = useState<ConsultationSummary | null>(null);
  const [timer, setTimer] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [isAutoStopping, setIsAutoStopping] = useState(false);
  const [settings, setSettings] = useState<AppSettings>(() => {
    try {
      const saved = localStorage.getItem('otoRecordSettings');
      return saved ? JSON.parse(saved) : DEFAULT_SETTINGS;
    } catch {
      return DEFAULT_SETTINGS;
    }
  });
  
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerIntervalRef = useRef<number | null>(null);
  const recognitionRef = useRef<any>(null);
  const autoStopTimeoutRef = useRef<number | null>(null);
  
  const appStateRef = useRef(appState);
  const settingsRef = useRef(settings);

  useEffect(() => { appStateRef.current = appState; }, [appState]);
  useEffect(() => { settingsRef.current = settings; }, [settings]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && appStateRef.current === AppState.RECORDING) {
      mediaRecorderRef.current.stop();
      if (recognitionRef.current) recognitionRef.current.stop();
      if (autoStopTimeoutRef.current) window.clearTimeout(autoStopTimeoutRef.current);
      stopTimer();
      setIsAutoStopping(false);
    }
  }, []);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      audioChunksRef.current = [];

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) audioChunksRef.current.push(event.data);
      };

      recorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        handleAudioProcessing(audioBlob);
        stream.getTracks().forEach(track => track.stop());
      };

      recorder.start();
      setAppState(AppState.RECORDING);
      startTimer();
      initSpeechRecognition();
    } catch (err) {
      setErrorMsg("Erro ao acessar o microfone. Verifique as permissões.");
      setAppState(AppState.ERROR);
    }
  };

  const initSpeechRecognition = () => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    const recognition = new SpeechRecognition();
    recognition.lang = 'pt-BR';
    recognition.continuous = true;
    recognition.interimResults = true;

    recognition.onresult = (event: any) => {
      const transcript = Array.from(event.results)
        .map((result: any) => result[0].transcript)
        .join('')
        .toLowerCase();

      // Reset auto-stop timer if new speech is detected
      if (autoStopTimeoutRef.current) {
        window.clearTimeout(autoStopTimeoutRef.current);
        autoStopTimeoutRef.current = null;
        setIsAutoStopping(false);
      }

      const hasFarewell = FAREWELL_WORDS.some(word => transcript.includes(word));
      
      if (hasFarewell) {
        setIsAutoStopping(true);
        // Espera 3.5 segundos de silêncio após uma palavra de despedida
        autoStopTimeoutRef.current = window.setTimeout(() => {
          stopRecording();
          showToast("Consulta encerrada automaticamente.");
        }, 3500);
      }
    };

    recognition.onerror = () => {
      // Falha silenciosa no reconhecimento não interrompe a gravação principal
      console.warn("Speech recognition error - manual stop still available");
    };

    recognition.start();
    recognitionRef.current = recognition;
  };

  const handleAudioProcessing = async (blob: Blob) => {
    setAppState(AppState.PROCESSING);
    try {
      const reader = new FileReader();
      reader.readAsDataURL(blob);
      reader.onloadend = async () => {
        const base64Audio = (reader.result as string).split(',')[1];
        const result = await processConsultationAudio(base64Audio, 'audio/webm');
        setSummary(result);
        setAppState(AppState.RESULT);
      };
    } catch (err) {
      setErrorMsg("Erro ao processar áudio. Verifique sua conexão e chave de API.");
      setAppState(AppState.ERROR);
    }
  };

  const copySummaryText = useCallback(() => {
    const s = summary; 
    if (!s) return;
    const text = `
PRONTUÁRIO OTORRINOLARINGOLÓGICO
-------------------------------
IDENTIFICAÇÃO: ${s.pacienteInfo || 'N/A'}
QUEIXA PRINCIPAL: ${s.queixaPrincipal}
HDA: ${s.hda}
EXAME FÍSICO: ${s.exameFisico || 'Não registrado'}
HIPÓTESE DIAGNÓSTICA: ${s.hipoteseDiagnostica || 'A investigar'}
CONDUTA: ${s.conduta}
    `.trim();
    
    // Tenta usar a API moderna primeiro
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => {
        showToast("Prontuário copiado!");
      }).catch(err => {
        console.error('Falha ao copiar:', err);
        fallbackCopyTextToClipboard(text);
      });
    } else {
      fallbackCopyTextToClipboard(text);
    }
  }, [summary]);

  const fallbackCopyTextToClipboard = (text: string) => {
    const textArea = document.createElement("textarea");
    textArea.value = text;
    textArea.style.position = "fixed";
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    try {
      document.execCommand('copy');
      showToast("Prontuário copiado!");
    } catch (err) {
      console.error('Erro ao copiar (fallback):', err);
    }
    document.body.removeChild(textArea);
  };

  const showToast = (msg: string) => {
    const toast = document.createElement('div');
    toast.className = 'fixed bottom-8 left-1/2 -translate-x-1/2 bg-blue-600 text-white px-6 py-3 rounded-full shadow-2xl z-[200] animate-bounce text-sm font-bold flex items-center gap-2';
    toast.innerHTML = `<i class="fas fa-check-circle"></i> ${msg}`;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
  };

  const toggleConsultation = useCallback(() => {
    if (appStateRef.current === AppState.RECORDING) {
      stopRecording();
    } else {
      resetApp();
      startRecording();
    }
  }, [stopRecording]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      if (e.key === settingsRef.current.startStopKey) {
        e.preventDefault();
        toggleConsultation();
      } else if (e.key === settingsRef.current.copyKey) {
        if (appStateRef.current === AppState.RESULT) {
          e.preventDefault();
          copySummaryText();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [toggleConsultation, copySummaryText]);

  const startTimer = () => {
    setTimer(0);
    timerIntervalRef.current = window.setInterval(() => setTimer(v => v + 1), 1000);
  };

  const stopTimer = () => {
    if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
  };

  const resetApp = () => {
    setAppState(AppState.IDLE);
    setSummary(null);
    setTimer(0);
    setErrorMsg(null);
    setIsAutoStopping(false);
  };

  const saveSettings = (newSettings: AppSettings) => {
    setSettings(newSettings);
    localStorage.setItem('otoRecordSettings', JSON.stringify(newSettings));
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-50">
      <header className="bg-white border-b border-slate-200 px-6 py-4 sticky top-0 z-40">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-blue-600 p-2 rounded-lg text-white">
              <i className="fas fa-ear-listen text-xl"></i>
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-800">OtoRecord</h1>
              <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Inteligência Médica</p>
            </div>
          </div>
          <button onClick={() => setShowSettings(true)} className="p-2 text-slate-400 hover:text-blue-600">
            <i className="fas fa-cog text-xl"></i>
          </button>
        </div>
      </header>

      <main className="flex-1 p-6 flex flex-col items-center justify-center">
        {appState === AppState.IDLE && (
          <div className="text-center max-w-lg animate-fadeIn">
            <div className="w-24 h-24 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center mx-auto mb-6 text-3xl">
              <i className="fas fa-microphone"></i>
            </div>
            <h2 className="text-2xl font-bold text-slate-800 mb-2">Nova Consulta</h2>
            <p className="text-slate-500 mb-8">O app encerrará sozinho ao ouvir palavras de despedida seguidas de silêncio.</p>
            <button onClick={startRecording} className="bg-blue-600 hover:bg-blue-700 text-white px-8 py-4 rounded-full font-bold shadow-lg flex items-center gap-3 mx-auto transition-transform active:scale-95">
              <i className="fas fa-play"></i> Iniciar Gravação ({settings.startStopKey})
            </button>
          </div>
        )}

        {appState === AppState.RECORDING && (
          <div className="text-center">
            <div className="w-32 h-32 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-6 relative">
              <i className="fas fa-microphone text-4xl text-red-500 animate-pulse"></i>
              <div className="absolute inset-0 border-4 border-red-500 rounded-full animate-ping opacity-20"></div>
            </div>
            <div className="text-5xl font-mono font-bold text-slate-800 mb-4">
              {Math.floor(timer / 60)}:{(timer % 60).toString().padStart(2, '0')}
            </div>
            
            {isAutoStopping ? (
              <div className="mb-6 px-4 py-2 bg-amber-100 text-amber-700 rounded-full text-sm font-bold animate-bounce inline-block">
                <i className="fas fa-clock mr-2"></i> Detectando fim da consulta...
              </div>
            ) : (
              <div className="mb-6 text-slate-400 text-xs font-medium uppercase tracking-widest">
                Gravando áudio da consulta
              </div>
            )}

            <div>
              <button onClick={stopRecording} className="bg-slate-800 text-white px-10 py-4 rounded-full font-bold shadow-lg active:scale-95 transition-transform">
                Parar Manual ({settings.startStopKey})
              </button>
            </div>
          </div>
        )}

        {appState === AppState.PROCESSING && (
          <div className="text-center max-w-sm">
            <div className="w-16 h-16 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-6"></div>
            <h2 className="text-xl font-bold text-slate-800">Sintetizando Prontuário...</h2>
            <p className="text-slate-500 mt-2">Aguarde enquanto a IA organiza as informações da consulta.</p>
          </div>
        )}

        {appState === AppState.RESULT && summary && (
          <div className="w-full max-w-4xl animate-fadeIn">
            <div className="mb-4 flex justify-between items-center px-2">
              <span className="text-xs text-slate-400 font-medium">Atalho para copiar: <b className="text-slate-600">{settings.copyKey}</b></span>
              <button onClick={resetApp} className="text-xs text-blue-600 font-bold hover:underline">NOVA CONSULTA</button>
            </div>
            <SummaryCard summary={summary} onReset={resetApp} onCopy={copySummaryText} />
          </div>
        )}

        {appState === AppState.ERROR && (
          <div className="text-center max-w-md">
            <i className="fas fa-exclamation-circle text-5xl text-red-500 mb-4"></i>
            <h2 className="text-xl font-bold text-slate-800">{errorMsg}</h2>
            <button onClick={resetApp} className="mt-6 bg-blue-600 text-white px-6 py-2 rounded-lg font-bold">Voltar</button>
          </div>
        )}
      </main>

      {showSettings && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-xs">
            <h3 className="text-lg font-bold mb-6">Configurar Atalhos</h3>
            <div className="space-y-4">
              <div>
                <label className="text-xs font-bold text-slate-400 uppercase">Gravar/Parar</label>
                <input 
                  className="w-full mt-1 bg-slate-50 border p-3 rounded-xl text-center font-mono font-bold cursor-pointer focus:ring-2 ring-blue-500 outline-none"
                  readOnly value={settings.startStopKey}
                  onKeyDown={(e) => { e.preventDefault(); saveSettings({...settings, startStopKey: e.key}); }}
                />
              </div>
              <div>
                <label className="text-xs font-bold text-slate-400 uppercase">Copiar Texto</label>
                <input 
                  className="w-full mt-1 bg-slate-50 border p-3 rounded-xl text-center font-mono font-bold cursor-pointer focus:ring-2 ring-blue-500 outline-none"
                  readOnly value={settings.copyKey}
                  onKeyDown={(e) => { e.preventDefault(); saveSettings({...settings, copyKey: e.key}); }}
                />
              </div>
            </div>
            <button onClick={() => setShowSettings(false)} className="w-full mt-8 bg-blue-600 text-white py-3 rounded-xl font-bold">Salvar e Sair</button>
          </div>
        </div>
      )}

      <footer className="p-4 text-center text-[10px] text-slate-400 font-medium uppercase tracking-widest border-t border-slate-100 bg-white">
        OtoRecord &bull; {new Date().getFullYear()} &bull; Inteligência Médica Segura
      </footer>

      <style>{`
        @keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
        .animate-fadeIn { animation: fadeIn 0.4s ease-out forwards; }
      `}</style>
    </div>
  );
};

export default App;
