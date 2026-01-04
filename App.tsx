
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
const FAREWELL_WORDS = [...IMMEDIATE_STOP_WORDS, 'até mais', 'obrigado doutor', 'finalizar consulta'];
const SILENCE_THRESHOLD = 15; 
const SILENCE_DELAY_MS = 3000; 

const safeGetItem = (key: string): string | null => {
  try { return localStorage.getItem(key); } catch (e) { return null; }
};

const safeSetItem = (key: string, value: string) => {
  try { localStorage.setItem(key, value); } catch (e) {}
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
  
  const [settings, setSettings] = useState<AppSettings>(() => {
    try {
      const saved = safeGetItem('otoRecordSettings');
      return saved ? JSON.parse(saved) : DEFAULT_SETTINGS;
    } catch { return DEFAULT_SETTINGS; }
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
    if (showSettings) getAudioDevices();
  }, [showSettings]);

  useEffect(() => {
    if (gainNodeRef.current) {
      gainNodeRef.current.gain.setTargetAtTime(settings.inputGain || 1.0, audioContextRef.current?.currentTime || 0, 0.1);
    }
  }, [settings.inputGain]);

  const showToast = (msg: string) => {
    const toast = document.createElement('div');
    toast.className = 'fixed bottom-8 left-1/2 -translate-x-1/2 bg-blue-600 text-white px-6 py-3 rounded-full shadow-2xl z-[200] text-sm font-bold animate-bounce';
    toast.innerText = msg;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 2000);
  };

  const getAudioDevices = async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      setAudioDevices(devices.filter(device => device.kind === 'audioinput'));
    } catch (err) { console.error(err); }
  };

  const getSupportedMimeType = () => {
    const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
    for (const type of types) if (MediaRecorder.isTypeSupported(type)) return type;
    return '';
  };

  const stopRecording = useCallback(() => {
    if (appStateRef.current !== AppState.RECORDING) return;
    if (recognitionRef.current) { recognitionRef.current.onend = null; recognitionRef.current.stop(); }
    if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    if (audioContextRef.current) audioContextRef.current.close().catch(() => {});
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') mediaRecorderRef.current.stop();
    if (autoStopTimeoutRef.current) window.clearTimeout(autoStopTimeoutRef.current);
    stopTimer();
    setIsPausedBySilence(false);
    setCurrentLevel(0);
  }, []);

  const analyzeAudio = () => {
    if (!analyserRef.current) return;
    const dataArray = new Uint8Array(analyserRef.current.fftSize);
    analyserRef.current.getByteTimeDomainData(dataArray);
    let maxDev = 0;
    for (let i = 0; i < dataArray.length; i++) {
      const dev = Math.abs(dataArray[i] - 128);
      if (dev > maxDev) maxDev = dev;
    }
    setCurrentLevel(Math.min(100, (maxDev / 128) * 150));

    const freqData = new Uint8Array(analyserRef.current.frequencyBinCount);
    analyserRef.current.getByteFrequencyData(freqData);
    let sum = 0;
    for (let i = 0; i < freqData.length; i++) sum += freqData[i];
    const avg = sum / freqData.length;

    if (avg < SILENCE_THRESHOLD) {
      if (!silenceStartRef.current) silenceStartRef.current = Date.now();
      else if (Date.now() - silenceStartRef.current > SILENCE_DELAY_MS) {
        if (mediaRecorderRef.current?.state === 'recording') {
          mediaRecorderRef.current.pause();
          setIsPausedBySilence(true);
        }
      }
    } else {
      silenceStartRef.current = null;
      if (mediaRecorderRef.current?.state === 'paused') {
        mediaRecorderRef.current.resume();
        setIsPausedBySilence(false);
      }
    }
    animationFrameRef.current = requestAnimationFrame(analyzeAudio);
  };

  const startRecording = async () => {
    // Check key selection via official window.aistudio API
    const hasKey = await (window as any).aistudio.hasSelectedApiKey();
    if (!hasKey) {
      await (window as any).aistudio.openSelectKey();
      // Proceed even if we can't confirm success immediately to avoid race condition
    }

    try {
      const constraints = { audio: settingsRef.current.selectedDeviceId ? { deviceId: { exact: settingsRef.current.selectedDeviceId } } : true };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const source = audioCtx.createMediaStreamSource(stream);
      const gain = audioCtx.createGain();
      const analyser = audioCtx.createAnalyser();
      const dest = audioCtx.createMediaStreamDestination();
      
      gain.gain.value = settingsRef.current.inputGain || 1.0;
      source.connect(gain); gain.connect(analyser); analyser.connect(dest);
      
      audioContextRef.current = audioCtx;
      gainNodeRef.current = gain;
      analyserRef.current = analyser;

      const mime = getSupportedMimeType();
      mimeTypeRef.current = mime;
      const recorder = new MediaRecorder(dest.stream, mime ? { mimeType: mime } : undefined);
      mediaRecorderRef.current = recorder;
      audioChunksRef.current = [];

      recorder.ondataavailable = (e) => e.data.size > 0 && audioChunksRef.current.push(e.data);
      recorder.onstop = () => {
        const blob = new Blob(audioChunksRef.current, { type: mime || 'audio/webm' });
        handleAudioProcessing(blob);
        stream.getTracks().forEach(t => t.stop());
      };

      recorder.start();
      setAppState(AppState.RECORDING);
      startTimer();
      analyzeAudio();
      initRecognition();
    } catch (err) {
      setErrorMsg("Erro ao acessar microfone. Verifique as permissões.");
      setAppState(AppState.ERROR);
    }
  };

  const initRecognition = () => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) return;
    const rec = new SR();
    rec.lang = 'pt-BR'; rec.continuous = true; rec.interimResults = true;
    rec.onresult = (e: any) => {
      let transcript = "";
      for (let i = e.resultIndex; i < e.results.length; i++) transcript += e.results[i][0].transcript;
      const text = transcript.toLowerCase();
      
      if (text.trim().length > 0 && mediaRecorderRef.current?.state === 'paused') {
        mediaRecorderRef.current.resume();
        setIsPausedBySilence(false);
      }

      if (autoStopTimeoutRef.current) clearTimeout(autoStopTimeoutRef.current);
      if (FAREWELL_WORDS.some(w => text.includes(w))) {
        autoStopTimeoutRef.current = window.setTimeout(() => {
          if (appStateRef.current === AppState.RECORDING) stopRecording();
        }, 3000);
      }
    };
    rec.onend = () => appStateRef.current === AppState.RECORDING && rec.start();
    rec.start();
    recognitionRef.current = rec;
  };

  const handleAudioProcessing = async (blob: Blob) => {
    setAppState(AppState.PROCESSING);
    const reader = new FileReader();
    reader.readAsDataURL(blob);
    reader.onloadend = async () => {
      try {
        const base64 = (reader.result as string).split(',')[1];
        const res = await processConsultationAudio(base64, mimeTypeRef.current || 'audio/webm');
        setSummary(res);
        setAppState(AppState.RESULT);
      } catch (e: any) {
        setErrorMsg(e.message || "Erro no processamento.");
        setAppState(AppState.ERROR);
      }
    };
  };

  const resetApp = () => { setAppState(AppState.IDLE); setSummary(null); setTimer(0); setErrorMsg(null); setCurrentLevel(0); };
  const startTimer = () => { setTimer(0); timerIntervalRef.current = window.setInterval(() => !isPausedBySilence && setTimer(v => v + 1), 1000); };
  const stopTimer = () => timerIntervalRef.current && clearInterval(timerIntervalRef.current);
  const saveSettings = (s: AppSettings) => { setSettings(s); safeSetItem('otoRecordSettings', JSON.stringify(s)); };

  const toggleRecording = useCallback(() => {
    if (appStateRef.current === AppState.RECORDING) stopRecording();
    else if (appStateRef.current === AppState.IDLE || appStateRef.current === AppState.RESULT || appStateRef.current === AppState.ERROR) {
      resetApp();
      startRecording();
    }
  }, [stopRecording]);

  const copyResult = useCallback(() => {
    if (summary) {
      const text = `PACIENTE: ${summary.pacienteInfo}\nQUEIXA: ${summary.queixaPrincipal}\nHDA: ${summary.hda}\nEXAME: ${summary.exameFisico}\nDIAGNÓSTICO: ${summary.hipoteseDiagnostica}\nCONDUTA: ${summary.conduta}`;
      navigator.clipboard.writeText(text).then(() => showToast("Copiado!"));
    }
  }, [summary]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === settingsRef.current.startStopKey) { e.preventDefault(); toggleRecording(); }
      if (e.key === settingsRef.current.copyKey && appStateRef.current === AppState.RESULT) { e.preventDefault(); copyResult(); }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [toggleRecording, copyResult]);

  return (
    <div className="min-h-screen flex flex-col bg-slate-50">
      <header className="bg-white border-b border-slate-200 px-6 py-4 sticky top-0 z-40">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-blue-600 p-2 rounded-lg text-white"><i className="fas fa-ear-listen text-xl"></i></div>
            <div>
              <h1 className="text-xl font-bold text-slate-800">OtoRecord</h1>
              <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Anamnese Inteligente</p>
            </div>
          </div>
          <button onClick={() => setShowSettings(true)} className="p-2 text-slate-400 hover:text-blue-600 transition-colors"><i className="fas fa-cog text-xl"></i></button>
        </div>
      </header>

      <main className="flex-1 p-6 flex flex-col items-center justify-center">
        {appState === AppState.IDLE && (
          <div className="text-center animate-fadeIn">
            <div className="w-24 h-24 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center mx-auto mb-6 text-3xl"><i className="fas fa-microphone"></i></div>
            <h2 className="text-2xl font-bold text-slate-800 mb-8">Pronto para a Consulta</h2>
            <button onClick={startRecording} className="bg-blue-600 text-white px-10 py-5 rounded-full font-bold shadow-xl flex items-center gap-3 mx-auto active:scale-95 text-lg hover:bg-blue-700 transition-all">
              <i className="fas fa-play"></i> Iniciar Gravação
            </button>
            <p className="mt-4 text-xs text-slate-400">Pressione <strong>{settings.startStopKey}</strong> no teclado</p>
          </div>
        )}

        {appState === AppState.RECORDING && (
          <div className="w-full max-w-md text-center">
            <div className={`text-7xl font-mono font-bold mb-8 tabular-nums ${isPausedBySilence ? 'text-amber-500' : 'text-slate-800'}`}>
              {Math.floor(timer / 60)}:{(timer % 60).toString().padStart(2, '0')}
            </div>
            <div className="mb-8 bg-white p-8 rounded-3xl shadow-xl border border-slate-100">
              <div className="h-10 w-full bg-slate-100 rounded-2xl overflow-hidden flex gap-1 p-1">
                {Array.from({ length: 20 }).map((_, i) => (
                  <div key={i} className={`flex-1 rounded-sm transition-all duration-75 ${currentLevel >= (i + 1) * 5 ? (i > 15 ? 'bg-red-500' : 'bg-green-500') : 'bg-slate-200'}`} />
                ))}
              </div>
              <p className="mt-4 text-sm text-slate-500 font-medium">
                {isPausedBySilence ? "Pausado por silêncio..." : "Capturando consulta..."}
              </p>
            </div>
            <button onClick={stopRecording} className="bg-slate-800 text-white px-10 py-5 rounded-full font-bold w-full active:scale-95 shadow-lg text-lg">
              Finalizar Anamnese
            </button>
          </div>
        )}

        {appState === AppState.PROCESSING && (
          <div className="text-center py-10 bg-white p-12 rounded-3xl shadow-xl border border-blue-50">
            <div className="w-16 h-16 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-6"></div>
            <h2 className="text-xl font-bold text-slate-800">Gerando Prontuário...</h2>
            <p className="text-slate-500 text-sm mt-2">Isso pode levar alguns segundos.</p>
          </div>
        )}

        {appState === AppState.RESULT && summary && (
          <div className="w-full max-w-4xl">
            <SummaryCard summary={summary} onReset={resetApp} onCopy={copyResult} />
            <div className="mt-4 text-center">
               <p className="text-[10px] text-slate-400 font-bold uppercase">Atalhos: {settings.startStopKey} (Novo) | {settings.copyKey} (Copiar)</p>
            </div>
          </div>
        )}

        {appState === AppState.ERROR && (
          <div className="text-center max-w-md bg-white p-10 rounded-3xl shadow-xl border border-red-50">
            <i className="fas fa-exclamation-circle text-red-500 text-5xl mb-4"></i>
            <h2 className="text-lg font-bold mb-4 text-slate-800">{errorMsg}</h2>
            <button onClick={resetApp} className="bg-blue-600 text-white px-8 py-3 rounded-xl font-bold w-full">Voltar</button>
          </div>
        )}
      </main>

      {showSettings && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-md z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-[2rem] shadow-2xl p-8 w-full max-w-md animate-fadeIn">
            <div className="flex justify-between items-center mb-8">
              <h3 className="text-xl font-bold">Configurações</h3>
              <button onClick={() => setShowSettings(false)} className="text-slate-400 p-2 hover:text-slate-600 transition-colors"><i className="fas fa-times text-xl"></i></button>
            </div>
            
            <div className="space-y-8">
              <div className="bg-blue-50/50 p-6 rounded-2xl border border-blue-100">
                <label className="text-[10px] font-bold text-blue-600 uppercase tracking-widest block mb-4">Chave de API Gemini</label>
                <button 
                  onClick={async () => {
                    await (window as any).aistudio.openSelectKey();
                    showToast("Chave Selecionada!");
                  }}
                  className="w-full bg-white border border-blue-200 p-4 rounded-xl text-sm font-bold text-blue-700 flex items-center justify-between hover:bg-blue-100 transition-all"
                >
                  <span>Alterar Chave API</span>
                  <i className="fas fa-key"></i>
                </button>
                <p className="mt-2 text-[9px] text-slate-400 italic">Dica: Use uma chave de um projeto com faturamento ativado para melhores limites.</p>
              </div>

              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-4">Teclas de Atalho</label>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <span className="text-[9px] text-slate-500 font-bold uppercase">Gravar/Parar</span>
                    <input 
                      type="text" className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-center font-bold outline-none focus:ring-2 focus:ring-blue-500"
                      readOnly value={settings.startStopKey} onKeyDown={(e) => { e.preventDefault(); saveSettings({...settings, startStopKey: e.key}); }}
                    />
                  </div>
                  <div className="space-y-1">
                    <span className="text-[9px] text-slate-500 font-bold uppercase">Copiar Texto</span>
                    <input 
                      type="text" className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-center font-bold outline-none focus:ring-2 focus:ring-blue-500"
                      readOnly value={settings.copyKey} onKeyDown={(e) => { e.preventDefault(); saveSettings({...settings, copyKey: e.key}); }}
                    />
                  </div>
                </div>
              </div>

              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-2">Microfone</label>
                <select 
                  className="w-full p-4 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium appearance-none" 
                  value={settings.selectedDeviceId || ''} 
                  onChange={(e) => saveSettings({...settings, selectedDeviceId: e.target.value})}
                >
                  <option value="">Padrão do Sistema</option>
                  {audioDevices.map(d => <option key={d.deviceId} value={d.deviceId}>{d.label || 'Microfone Externo'}</option>)}
                </select>
              </div>
            </div>

            <button onClick={() => setShowSettings(false)} className="w-full mt-10 bg-slate-800 text-white py-5 rounded-2xl font-bold shadow-lg active:scale-95">Salvar Configurações</button>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
