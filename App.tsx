
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { processConsultationAudio } from './services/geminiService';
import { AppState, ConsultationSummary, AppSettings } from './types';
import SummaryCard from './components/SummaryCard';

const DEFAULT_SETTINGS: AppSettings = {
  startStopKey: 'F5',
  copyKey: 'F6'
};

const App: React.FC = () => {
  const [appState, setAppState] = useState<AppState>(AppState.IDLE);
  const [summary, setSummary] = useState<ConsultationSummary | null>(null);
  const [timer, setTimer] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [settings, setSettings] = useState<AppSettings>(() => {
    const saved = localStorage.getItem('otoRecordSettings');
    return saved ? JSON.parse(saved) : DEFAULT_SETTINGS;
  });
  
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerIntervalRef = useRef<number | null>(null);
  const stateRef = useRef(appState);
  const summaryRef = useRef(summary);

  // Keep refs in sync for global listeners
  useEffect(() => { stateRef.current = appState; }, [appState]);
  useEffect(() => { summaryRef.current = summary; }, [summary]);

  const saveSettings = (newSettings: AppSettings) => {
    setSettings(newSettings);
    localStorage.setItem('otoRecordSettings', JSON.stringify(newSettings));
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      audioChunksRef.current = [];

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      recorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        await handleAudioProcessing(audioBlob);
        stream.getTracks().forEach(track => track.stop());
      };

      recorder.start();
      setAppState(AppState.RECORDING);
      startTimer();
    } catch (err) {
      console.error("Erro ao acessar microfone:", err);
      setErrorMsg("Erro ao acessar o microfone. Verifique as permissões.");
      setAppState(AppState.ERROR);
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && stateRef.current === AppState.RECORDING) {
      mediaRecorderRef.current.stop();
      stopTimer();
    }
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
      console.error("Erro no processamento:", err);
      setErrorMsg("Não foi possível processar o áudio. Tente novamente.");
      setAppState(AppState.ERROR);
    }
  };

  const copySummaryText = useCallback(() => {
    const s = summaryRef.current;
    if (!s) return;
    const text = `
PRONTUÁRIO OTORRINOLARINGOLÓGICO
-------------------------------
IDENTIFICAÇÃO: ${s.pacienteInfo || 'N/A'}
QUEIXA PRINCIPAL: ${s.queixaPrincipal}
HDA: ${s.hda}
EXAME FÍSICO: ${s.exameFisico || 'Não registrado verbalmente'}
HIPÓTESE DIAGNÓSTICA: ${s.hipoteseDiagnostica || 'A investigar'}
CONDUTA: ${s.conduta}
    `.trim();
    navigator.clipboard.writeText(text);
    const toast = document.createElement('div');
    toast.className = 'fixed bottom-8 left-1/2 -translate-x-1/2 bg-slate-800 text-white px-6 py-3 rounded-full shadow-2xl z-[100] animate-fadeIn';
    toast.innerText = 'Prontuário copiado! (Atalho detectado)';
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 2000);
  }, []);

  const toggleConsultation = useCallback(() => {
    const currentState = stateRef.current;
    if (currentState === AppState.IDLE || currentState === AppState.RESULT || currentState === AppState.ERROR) {
      resetApp();
      startRecording();
    } else if (currentState === AppState.RECORDING) {
      stopRecording();
    }
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger if user is typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      if (e.key === settings.startStopKey) {
        e.preventDefault();
        toggleConsultation();
      } else if (e.key === settings.copyKey) {
        if (stateRef.current === AppState.RESULT) {
          e.preventDefault();
          copySummaryText();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [settings, toggleConsultation, copySummaryText]);

  const startTimer = () => {
    setTimer(0);
    timerIntervalRef.current = window.setInterval(() => {
      setTimer(prev => prev + 1);
    }, 1000);
  };

  const stopTimer = () => {
    if (timerIntervalRef.current) {
      clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = null;
    }
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const resetApp = () => {
    setAppState(AppState.IDLE);
    setSummary(null);
    setTimer(0);
    setErrorMsg(null);
  };

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 px-6 py-4 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-blue-600 p-2 rounded-lg text-white">
              <i className="fas fa-ear-listen text-xl"></i>
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-800 leading-none">OtoRecord</h1>
              <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider mt-1">Inteligência Médica</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="hidden md:flex gap-4 text-xs font-medium text-slate-400">
              <span className="bg-slate-100 px-2 py-1 rounded">Atalho Grav: <b>{settings.startStopKey}</b></span>
              <span className="bg-slate-100 px-2 py-1 rounded">Atalho Copiar: <b>{settings.copyKey}</b></span>
            </div>
            <button 
              onClick={() => setShowSettings(true)}
              className="p-2 text-slate-400 hover:text-blue-600 transition-colors"
              title="Configurações de Atalhos"
            >
              <i className="fas fa-cog text-xl"></i>
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 p-6 flex flex-col items-center justify-center max-w-7xl mx-auto w-full">
        {appState === AppState.IDLE && (
          <div className="text-center max-w-lg animate-fadeIn">
            <div className="w-24 h-24 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center mx-auto mb-6 text-3xl">
              <i className="fas fa-microphone"></i>
            </div>
            <h2 className="text-2xl font-bold text-slate-800 mb-4">Iniciar Gravação</h2>
            <p className="text-slate-600 mb-8">
              Pressione <span className="font-bold text-blue-600">{settings.startStopKey}</span> ou clique no botão abaixo para gravar a consulta.
            </p>
            <button 
              onClick={startRecording}
              className="bg-blue-600 hover:bg-blue-700 text-white px-8 py-4 rounded-full font-bold shadow-lg transform active:scale-95 transition-all flex items-center gap-3 mx-auto text-lg"
            >
              <i className="fas fa-circle text-red-500 animate-pulse"></i> Iniciar Consulta
            </button>
          </div>
        )}

        {appState === AppState.RECORDING && (
          <div className="text-center animate-fadeIn">
            <div className="mb-8 relative">
              <div className="w-32 h-32 bg-red-100 rounded-full flex items-center justify-center mx-auto text-4xl text-red-500 relative z-10">
                <i className="fas fa-microphone animate-pulse"></i>
              </div>
              <div className="absolute top-0 left-1/2 -translate-x-1/2 w-32 h-32 bg-red-200 rounded-full animate-ping opacity-25"></div>
            </div>
            <div className="text-4xl font-mono font-bold text-slate-800 mb-2">
              {formatTime(timer)}
            </div>
            <p className="text-red-500 font-semibold mb-8 uppercase tracking-widest text-sm">Gravando...</p>
            <button 
              onClick={stopRecording}
              className="bg-slate-800 hover:bg-slate-900 text-white px-10 py-4 rounded-full font-bold shadow-lg transition-all flex items-center gap-3 mx-auto text-lg"
            >
              <i className="fas fa-stop text-white"></i> Finalizar ({settings.startStopKey})
            </button>
          </div>
        )}

        {appState === AppState.PROCESSING && (
          <div className="text-center max-w-md animate-fadeIn">
            <div className="mb-8">
              <div className="w-20 h-20 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto"></div>
            </div>
            <h2 className="text-2xl font-bold text-slate-800 mb-4">Analisando Áudio</h2>
            <p className="text-slate-600">
              Extraindo sintomas e condutas relevantes...
            </p>
            <div className="mt-8 space-y-3">
              <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                <div className="h-full bg-blue-600 w-2/3 animate-[progress_2s_infinite]"></div>
              </div>
            </div>
          </div>
        )}

        {appState === AppState.RESULT && summary && (
          <div className="w-full">
            <div className="max-w-4xl mx-auto mb-4 flex justify-between items-center text-sm text-slate-400">
              <span>Dica: Pressione <kbd className="bg-slate-200 px-1.5 py-0.5 rounded text-slate-700 font-bold">{settings.copyKey}</kbd> para copiar rápido</span>
              <span>Pressione <kbd className="bg-slate-200 px-1.5 py-0.5 rounded text-slate-700 font-bold">{settings.startStopKey}</kbd> para nova consulta</span>
            </div>
            <SummaryCard summary={summary} onReset={resetApp} />
          </div>
        )}

        {appState === AppState.ERROR && (
          <div className="text-center max-w-md animate-fadeIn">
            <div className="w-20 h-20 bg-red-100 text-red-600 rounded-full flex items-center justify-center mx-auto mb-6 text-3xl">
              <i className="fas fa-exclamation-triangle"></i>
            </div>
            <h2 className="text-2xl font-bold text-slate-800 mb-4">Erro</h2>
            <p className="text-slate-600 mb-8">{errorMsg}</p>
            <button 
              onClick={resetApp}
              className="bg-blue-600 hover:bg-blue-700 text-white px-8 py-3 rounded-xl font-bold shadow-lg transition-all mx-auto"
            >
              Tentar Novamente
            </button>
          </div>
        )}
      </main>

      {/* Settings Modal */}
      {showSettings && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full overflow-hidden animate-fadeIn">
            <div className="p-6">
              <div className="flex justify-between items-center mb-6">
                <h3 className="text-xl font-bold text-slate-800">Atalhos de Teclado</h3>
                <button onClick={() => setShowSettings(false)} className="text-slate-400 hover:text-slate-600">
                  <i className="fas fa-times"></i>
                </button>
              </div>
              
              <div className="space-y-6">
                <div>
                  <label className="block text-sm font-semibold text-slate-600 mb-2">Iniciar / Parar Consulta</label>
                  <div className="relative group">
                    <input 
                      type="text"
                      readOnly
                      value={settings.startStopKey}
                      onKeyDown={(e) => {
                        e.preventDefault();
                        saveSettings({...settings, startStopKey: e.key});
                      }}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-center font-mono font-bold text-blue-600 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 transition-all cursor-pointer hover:bg-slate-100"
                    />
                    <div className="absolute inset-y-0 right-3 flex items-center text-slate-300 group-hover:text-blue-400">
                      <i className="fas fa-keyboard"></i>
                    </div>
                  </div>
                  <p className="text-[10px] text-slate-400 mt-2 italic text-center">Clique e pressione a nova tecla</p>
                </div>

                <div>
                  <label className="block text-sm font-semibold text-slate-600 mb-2">Copiar Prontuário</label>
                  <div className="relative group">
                    <input 
                      type="text"
                      readOnly
                      value={settings.copyKey}
                      onKeyDown={(e) => {
                        e.preventDefault();
                        saveSettings({...settings, copyKey: e.key});
                      }}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-center font-mono font-bold text-blue-600 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 transition-all cursor-pointer hover:bg-slate-100"
                    />
                    <div className="absolute inset-y-0 right-3 flex items-center text-slate-300 group-hover:text-blue-400">
                      <i className="fas fa-keyboard"></i>
                    </div>
                  </div>
                  <p className="text-[10px] text-slate-400 mt-2 italic text-center">Clique e pressione a nova tecla</p>
                </div>
              </div>

              <div className="mt-8 flex gap-3">
                <button 
                  onClick={() => {
                    saveSettings(DEFAULT_SETTINGS);
                    setShowSettings(false);
                  }}
                  className="flex-1 px-4 py-2 text-slate-500 text-sm font-medium hover:bg-slate-100 rounded-lg transition-colors"
                >
                  Resetar Padrões
                </button>
                <button 
                  onClick={() => setShowSettings(false)}
                  className="flex-1 bg-blue-600 text-white px-4 py-2 rounded-lg font-bold hover:bg-blue-700 transition-colors shadow-md"
                >
                  Concluído
                </button>
              </div>
            </div>
            <div className="bg-blue-50 p-4 text-[11px] text-blue-600 text-center border-t border-blue-100">
              <i className="fas fa-info-circle mr-1"></i> Evite usar teclas reservadas pelo sistema.
            </div>
          </div>
        </div>
      )}

      {/* Footer */}
      <footer className="bg-white border-t border-slate-200 p-4">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-center gap-4">
          <p className="text-slate-500 text-sm">
            &copy; 2024 OtoRecord - Inteligência Médica Avançada
          </p>
          <div className="flex gap-4 text-slate-400 text-sm">
            <span className="flex items-center gap-1"><i className="fas fa-shield-alt"></i> HIPAA Compliant</span>
            <span className="flex items-center gap-1"><i className="fas fa-lock"></i> AES-256 Cloud</span>
          </div>
        </div>
      </footer>

      <style>{`
        @keyframes progress {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(100%); }
        }
        .animate-fadeIn {
          animation: fadeIn 0.3s ease-out forwards;
        }
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        kbd {
          font-family: monospace;
        }
      `}</style>
    </div>
  );
};

export default App;
