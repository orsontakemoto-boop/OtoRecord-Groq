
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { processConsultationAudio } from './services/geminiService';
import { AppState, ConsultationSummary, AppSettings } from './types';
import SummaryCard from './components/SummaryCard';

const DEFAULT_SETTINGS: AppSettings = {
  startStopKey: 'F5',
  copyKey: 'F6',
  selectedDeviceId: '',
  inputGain: 1.0
};

const IMMEDIATE_STOP_WORDS = ['tchau', 'tchau-tchau', 'tchau tchau'];

const FAREWELL_WORDS = [
  ...IMMEDIATE_STOP_WORDS,
  'até mais', 'até logo', 'quando precisar', 
  'me ligue', 'me liga', 'bom descanso', 'obrigado doutor', 
  'obrigada doutor', 'pode ir', 'tá bom então', 'até a próxima',
  'tá certo doutor', 'muito obrigado', 'finalizar consulta'
];

const SILENCE_THRESHOLD = 15; 
const SILENCE_DELAY_MS = 3000; 

const safeGetItem = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch (e) {
    console.warn('LocalStorage access denied:', e);
    return null;
  }
};

const safeSetItem = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch (e) {
    console.warn('LocalStorage set denied:', e);
  }
};

const App: React.FC = () => {
  const [appState, setAppState] = useState<AppState>(AppState.IDLE);
  const [summary, setSummary] = useState<ConsultationSummary | null>(null);
  const [timer, setTimer] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [isPausedBySilence, setIsPausedBySilence] = useState(false);
  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([]);
  const [currentLevel, setCurrentLevel] = useState(0);
  
  // BYOK: Recuperação da chave manual
  const [apiKeyInput, setApiKeyInput] = useState(() => safeGetItem('GEMINI_API_KEY') || '');
  const [hasStoredKey, setHasStoredKey] = useState(() => !!safeGetItem('GEMINI_API_KEY'));
  
  const [settings, setSettings] = useState<AppSettings>(() => {
    try {
      const saved = safeGetItem('otoRecordSettings');
      return saved ? JSON.parse(saved) : DEFAULT_SETTINGS;
    } catch {
      return DEFAULT_SETTINGS;
    }
  });
  
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const mimeTypeRef = useRef<string>('');
  const timerIntervalRef = useRef<number | null>(null);
  const recognitionRef = useRef<any>(null);
  const autoStopTimeoutRef = useRef<number | null>(null);

  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const silenceStartRef = useRef<number | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  
  const appStateRef = useRef(appState);
  const settingsRef = useRef(settings);

  useEffect(() => { appStateRef.current = appState; }, [appState]);
  useEffect(() => { settingsRef.current = settings; }, [settings]);

  useEffect(() => {
    if (showSettings) {
      getAudioDevices();
    }
  }, [showSettings]);

  useEffect(() => {
    if (gainNodeRef.current) {
      gainNodeRef.current.gain.setTargetAtTime(settings.inputGain || 1.0, audioContextRef.current?.currentTime || 0, 0.1);
    }
  }, [settings.inputGain]);

  const handleSaveKey = () => {
    if (apiKeyInput.trim()) {
      safeSetItem('GEMINI_API_KEY', apiKeyInput.trim());
      setHasStoredKey(true);
      showToast("Chave salva com sucesso!");
    } else {
      showToast("Por favor, insira uma chave válida.");
    }
  };

  const getAudioDevices = async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const audioInputs = devices.filter(device => device.kind === 'audioinput');
      setAudioDevices(audioInputs);
    } catch (err) {
      console.error("Erro ao listar dispositivos:", err);
    }
  };

  const getSupportedMimeType = () => {
    const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
    for (const type of types) {
      if (MediaRecorder.isTypeSupported(type)) return type;
    }
    return '';
  };

  const stopRecording = useCallback(() => {
    if (appStateRef.current !== AppState.RECORDING) return;
    
    if (recognitionRef.current) {
      recognitionRef.current.onend = null;
      recognitionRef.current.stop();
    }

    if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      audioContextRef.current.close().catch(console.error);
    }
    
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }

    if (autoStopTimeoutRef.current) window.clearTimeout(autoStopTimeoutRef.current);
    stopTimer();
    setIsPausedBySilence(false);
    setCurrentLevel(0);
  }, []);

  const analyzeAudio = () => {
    if (!analyserRef.current) return;

    const dataArray = new Uint8Array(analyserRef.current.fftSize);
    analyserRef.current.getByteTimeDomainData(dataArray);

    let maxDeviation = 0;
    for (let i = 0; i < dataArray.length; i++) {
      const deviation = Math.abs(dataArray[i] - 128);
      if (deviation > maxDeviation) maxDeviation = deviation;
    }
    
    const levelPercent = Math.min(100, (maxDeviation / 128) * 100 * 1.5);
    setCurrentLevel(levelPercent);

    const freqData = new Uint8Array(analyserRef.current.frequencyBinCount);
    analyserRef.current.getByteFrequencyData(freqData);
    let freqSum = 0;
    for (let i = 0; i < freqData.length; i++) freqSum += freqData[i];
    const average = freqSum / freqData.length;

    const isSilent = average < SILENCE_THRESHOLD;
    const now = Date.now();

    if (isSilent) {
      if (!silenceStartRef.current) {
        silenceStartRef.current = now;
      } else if (now - silenceStartRef.current > SILENCE_DELAY_MS) {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
          mediaRecorderRef.current.pause();
          setIsPausedBySilence(true);
        }
      }
    } else {
      silenceStartRef.current = null;
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'paused') {
        mediaRecorderRef.current.resume();
        setIsPausedBySilence(false);
      }
    }

    animationFrameRef.current = requestAnimationFrame(analyzeAudio);
  };

  const startRecording = async () => {
    try {
      const constraints: MediaStreamConstraints = { 
        audio: settingsRef.current.selectedDeviceId 
          ? { deviceId: { exact: settingsRef.current.selectedDeviceId } }
          : true 
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      if (audioContext.state === 'suspended') await audioContext.resume();

      const source = audioContext.createMediaStreamSource(stream);
      const gainNode = audioContext.createGain();
      const analyser = audioContext.createAnalyser();
      const destination = audioContext.createMediaStreamDestination();
      
      gainNode.gain.value = settingsRef.current.inputGain || 1.0;
      analyser.fftSize = 512;
      
      source.connect(gainNode);
      gainNode.connect(analyser);
      analyser.connect(destination);
      
      audioContextRef.current = audioContext;
      gainNodeRef.current = gainNode;
      analyserRef.current = analyser;

      const mimeType = getSupportedMimeType();
      mimeTypeRef.current = mimeType;
      
      const recorder = new MediaRecorder(destination.stream, mimeType ? { mimeType } : undefined);
      
      mediaRecorderRef.current = recorder;
      audioChunksRef.current = [];

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) audioChunksRef.current.push(event.data);
      };

      recorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: mimeType || 'audio/webm' });
        handleAudioProcessing(audioBlob);
        stream.getTracks().forEach(track => track.stop());
      };

      recorder.start();
      setAppState(AppState.RECORDING);
      startTimer();
      initSpeechRecognition();
      analyzeAudio();

    } catch (err) {
      console.error(err);
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
      let latestTranscript = "";
      for (let i = event.resultIndex; i < event.results.length; ++i) {
        latestTranscript += event.results[i][0].transcript;
      }
      
      const text = latestTranscript.toLowerCase();
      if (text.trim().length > 0 && mediaRecorderRef.current && mediaRecorderRef.current.state === 'paused') {
        mediaRecorderRef.current.resume();
        setIsPausedBySilence(false);
      }

      if (autoStopTimeoutRef.current) {
        window.clearTimeout(autoStopTimeoutRef.current);
        autoStopTimeoutRef.current = null;
      }

      const hasImmediateTrigger = IMMEDIATE_STOP_WORDS.some(word => text.includes(word));
      if (hasImmediateTrigger) {
        autoStopTimeoutRef.current = window.setTimeout(() => {
          if (appStateRef.current === AppState.RECORDING) stopRecording();
        }, 1200);
        return;
      }

      const hasGeneralFarewell = FAREWELL_WORDS.some(word => text.includes(word));
      if (hasGeneralFarewell) {
        autoStopTimeoutRef.current = window.setTimeout(() => {
          if (appStateRef.current === AppState.RECORDING) stopRecording();
        }, 3500);
      }
    };

    recognition.onend = () => {
      if (appStateRef.current === AppState.RECORDING) {
        try { recognition.start(); } catch(e) {}
      }
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
        try {
          const base64Audio = (reader.result as string).split(',')[1];
          const result = await processConsultationAudio(base64Audio, mimeTypeRef.current || 'audio/webm');
          setSummary(result);
          setAppState(AppState.RESULT);
        } catch (innerError: any) {
          console.error("Erro no processamento:", innerError);
          const msg = innerError.message || "";
          if (msg.includes("401") || msg.includes("invalid key") || msg.includes("API_KEY_INVALID")) {
            setErrorMsg("Chave API inválida. Verifique em Configurações.");
          } else {
            setErrorMsg(msg || "Erro no processamento.");
          }
          setAppState(AppState.ERROR);
        }
      };
    } catch (err) {
      setErrorMsg("Erro na leitura do áudio.");
      setAppState(AppState.ERROR);
    }
  };

  const copySummaryText = useCallback(() => {
    if (!summary) return;
    const text = `
PRONTUÁRIO OTORRINOLARINGOLÓGICO
-------------------------------
IDENTIFICAÇÃO: ${summary.pacienteInfo || 'N/A'}
QUEIXA PRINCIPAL: ${summary.queixaPrincipal}
HDA: ${summary.hda}
EXAME FÍSICO: ${summary.exameFisico || 'Não registrado'}
HIPÓTESE DIAGNÓSTICA: ${summary.hipoteseDiagnostica || 'A investigar'}
CONDUTA: ${summary.conduta}
    `.trim();
    
    navigator.clipboard.writeText(text).then(() => showToast("Copiado!"));
  }, [summary]);

  const showToast = (msg: string) => {
    const toast = document.createElement('div');
    toast.className = 'fixed bottom-8 left-1/2 -translate-x-1/2 bg-blue-600 text-white px-6 py-3 rounded-full shadow-2xl z-[200] animate-bounce text-sm font-bold';
    toast.innerText = msg;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 2000);
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
      if (e.key === settingsRef.current.startStopKey) { e.preventDefault(); toggleConsultation(); }
      else if (e.key === settingsRef.current.copyKey && appStateRef.current === AppState.RESULT) { e.preventDefault(); copySummaryText(); }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [toggleConsultation, copySummaryText]);

  const startTimer = () => {
    setTimer(0);
    timerIntervalRef.current = window.setInterval(() => {
      if (!isPausedBySilence) setTimer(v => v + 1);
    }, 1000);
  };

  const stopTimer = () => { if (timerIntervalRef.current) clearInterval(timerIntervalRef.current); };

  const resetApp = () => {
    setAppState(AppState.IDLE);
    setSummary(null);
    setTimer(0);
    setErrorMsg(null);
    setIsPausedBySilence(false);
    setCurrentLevel(0);
  };

  const saveSettings = (newSettings: AppSettings) => {
    setSettings(newSettings);
    safeSetItem('otoRecordSettings', JSON.stringify(newSettings));
  };

  const ApiKeySection = () => (
    <div className="bg-blue-50/50 p-6 rounded-2xl border border-blue-100 mb-6">
      <div className="flex items-center gap-2 mb-3">
        <i className="fas fa-key text-blue-600 text-sm"></i>
        <h4 className="text-[10px] font-bold text-blue-600 uppercase tracking-widest">Chave de API Gemini</h4>
      </div>
      <p className="text-xs text-slate-500 mb-4">
        Sua chave é armazenada localmente no seu navegador.
      </p>
      <div className="flex gap-2">
        <input 
          type="password" 
          placeholder="Insira sua chave aqui..."
          className="flex-1 px-4 py-2.5 bg-white border border-blue-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none"
          value={apiKeyInput}
          onChange={(e) => setApiKeyInput(e.target.value)}
        />
        <button 
          onClick={handleSaveKey}
          className="bg-blue-600 hover:bg-blue-700 text-white px-5 py-2.5 rounded-xl text-sm font-bold shadow-sm transition-all active:scale-95"
        >
          Salvar
        </button>
      </div>
      <div className="text-right mt-3">
        <a 
          href="https://aistudio.google.com/app/apikey" 
          target="_blank" 
          rel="noopener noreferrer"
          className="text-[10px] font-bold text-blue-600 hover:underline uppercase tracking-tight"
        >
          Obter chave grátis
        </a>
      </div>
    </div>
  );

  if (!hasStoredKey) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50 p-6 text-center">
        <div className="bg-white p-10 rounded-3xl shadow-2xl max-w-md w-full border border-blue-50 animate-fadeIn">
          <div className="bg-blue-600 w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-6 text-white text-2xl shadow-lg shadow-blue-200">
            <i className="fas fa-ear-listen"></i>
          </div>
          <h1 className="text-2xl font-bold text-slate-800 mb-2">Bem-vindo ao OtoRecord</h1>
          <p className="text-slate-500 mb-8 text-sm">
            Para iniciar, configure sua própria chave de API. Cada médico utiliza sua cota individual para garantir performance.
          </p>
          <ApiKeySection />
        </div>
      </div>
    );
  }

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
          <button onClick={() => setShowSettings(true)} className="p-2 text-slate-400 hover:text-blue-600 transition-colors">
            <i className="fas fa-cog text-xl"></i>
          </button>
        </div>
      </header>

      <main className="flex-1 p-6 flex flex-col items-center justify-center">
        {appState === AppState.IDLE && (
          <div className="text-center max-w-lg animate-fadeIn">
            <div className="w-24 h-24 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center mx-auto mb-6 text-3xl shadow-inner">
              <i className="fas fa-microphone"></i>
            </div>
            <h2 className="text-2xl font-bold text-slate-800 mb-8">Pronto para iniciar</h2>
            <button onClick={startRecording} className="bg-blue-600 hover:bg-blue-700 text-white px-10 py-5 rounded-full font-bold shadow-xl flex items-center gap-3 mx-auto transition-transform active:scale-95 text-lg">
              <i className="fas fa-play"></i> Iniciar Consulta
            </button>
            <p className="mt-6 text-slate-400 text-sm italic">Pressione {settings.startStopKey} para atalho rápido</p>
          </div>
        )}

        {appState === AppState.RECORDING && (
          <div className="w-full max-w-md text-center">
            <div className={`text-6xl font-mono font-bold mb-8 tabular-nums ${isPausedBySilence ? 'text-amber-500' : 'text-slate-800'}`}>
              {Math.floor(timer / 60)}:{(timer % 60).toString().padStart(2, '0')}
            </div>

            <div className="mb-8 bg-white p-6 rounded-3xl shadow-lg border border-slate-100">
              <div className="flex justify-between text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">
                <span>Nível de Entrada</span>
                <span className={currentLevel > 85 ? 'text-red-500 font-bold' : currentLevel > 60 ? 'text-amber-500 font-bold' : 'text-green-500'}>
                  {currentLevel > 85 ? 'Distorção' : currentLevel > 60 ? 'Limite' : 'Bom'}
                </span>
              </div>
              
              <div className="h-8 w-full bg-slate-100 rounded-xl overflow-hidden flex gap-0.5 p-1.5 border border-slate-200 shadow-inner">
                {Array.from({ length: 20 }).map((_, i) => {
                  const step = (i + 1) * 5;
                  const active = currentLevel >= step;
                  let colorClass = 'bg-slate-200';
                  if (active) {
                    if (step > 85) colorClass = 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.5)]';
                    else if (step > 60) colorClass = 'bg-amber-400';
                    else colorClass = 'bg-green-500 shadow-[0_0_5px_rgba(34,197,94,0.3)]';
                  }
                  return <div key={i} className={`flex-1 rounded-sm transition-all duration-75 ${colorClass}`} />;
                })}
              </div>

              <div className="mt-6">
                <div className="flex justify-between items-center mb-2">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-1">
                    <i className="fas fa-volume-up"></i> Ganho do Microfone
                  </label>
                  <span className="text-xs font-mono font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded">
                    {((settings.inputGain || 1.0) * 100).toFixed(0)}%
                  </span>
                </div>
                <input 
                  type="range" min="0" max="2" step="0.05"
                  className="w-full h-2 bg-slate-100 rounded-lg appearance-none cursor-pointer accent-blue-600"
                  value={settings.inputGain || 1.0}
                  onChange={(e) => saveSettings({...settings, inputGain: parseFloat(e.target.value)})}
                />
              </div>
            </div>
            
            <button onClick={stopRecording} className="bg-slate-800 text-white px-10 py-4 rounded-full font-bold shadow-lg active:scale-95 w-full mb-4">
              Finalizar Agora
            </button>
          </div>
        )}

        {appState === AppState.PROCESSING && (
          <div className="text-center py-10">
            <div className="w-16 h-16 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-6"></div>
            <h2 className="text-xl font-bold">Processando Prontuário...</h2>
          </div>
        )}

        {appState === AppState.RESULT && summary && (
          <div className="w-full max-w-4xl animate-fadeIn">
            <SummaryCard summary={summary} onReset={resetApp} onCopy={copySummaryText} />
          </div>
        )}

        {appState === AppState.ERROR && (
          <div className="text-center max-w-md bg-white p-8 rounded-3xl shadow-xl border border-red-50">
            <i className="fas fa-exclamation-circle text-red-500 text-5xl mb-4"></i>
            <h2 className="text-lg font-bold mb-4">{errorMsg}</h2>
            <button onClick={resetApp} className="bg-blue-600 text-white px-8 py-3 rounded-xl font-bold w-full">Tentar Novamente</button>
          </div>
        )}
      </main>

      {showSettings && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl shadow-2xl p-8 w-full max-w-md animate-fadeIn">
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-lg font-bold">Configurações</h3>
              <button onClick={() => setShowSettings(false)} className="text-slate-400 hover:text-slate-600 p-2">
                <i className="fas fa-times text-xl"></i>
              </button>
            </div>
            
            <div className="space-y-6">
              <ApiKeySection />

              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-2">Selecionar Microfone</label>
                <select className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-sm" value={settings.selectedDeviceId || ''} onChange={(e) => saveSettings({...settings, selectedDeviceId: e.target.value})}>
                  <option value="">Padrão do Sistema</option>
                  {audioDevices.map(d => <option key={d.deviceId} value={d.deviceId}>{d.label || 'Microfone'}</option>)}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-1">Atalho Iniciar</label>
                  <input className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-center font-bold" readOnly value={settings.startStopKey} onKeyDown={(e) => { e.preventDefault(); saveSettings({...settings, startStopKey: e.key}); }} />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-1">Atalho Copiar</label>
                  <input className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-center font-bold" readOnly value={settings.copyKey} onKeyDown={(e) => { e.preventDefault(); saveSettings({...settings, copyKey: e.key}); }} />
                </div>
              </div>
            </div>

            <button onClick={() => setShowSettings(false)} className="w-full mt-8 bg-slate-800 text-white py-4 rounded-2xl font-bold">Fechar</button>
          </div>
        </div>
      )}

      <footer className="p-6 text-center text-[10px] text-slate-400 font-bold uppercase tracking-[0.2em] bg-white border-t border-slate-100">
        OtoRecord &bull; {new Date().getFullYear()} &bull; IA Médica
      </footer>
    </div>
  );
};

export default App;
