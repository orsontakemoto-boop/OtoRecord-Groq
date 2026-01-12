
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { processConsultationAudio } from './services/geminiService';
import { AppState, ConsultationSummary, AppSettings } from './types';
import SummaryCard from './components/SummaryCard';

const DEFAULT_SETTINGS: AppSettings = {
  startStopKey: 'F5',
  copyKey: 'F6',
  selectedDeviceId: ''
};

// Função para normalizar texto (remove acentos e pontuação para facilitar o match)
const normalizeText = (text: string) => {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // Remove acentos
    .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, "") // Remove pontuação
    .trim();
};

const IMMEDIATE_STOP_WORDS = [
  'tchau', 'xau', 'ciao', // Variações fonéticas do tchau
  'encerrar', 'encerrar consulta', 'encerrar atendimento',
  'finalizar', 'finalizar consulta',
  'terminar', 'terminar consulta',
  'parar gravacao'
];

const FAREWELL_WORDS = [
  ...IMMEDIATE_STOP_WORDS,
  'ate mais', 'ate logo', 'ate amanha', // Sem acentos devido à normalização
  'quando precisar',
  'me ligue', 'me liga',
  'bom descanso',
  'obrigado doutor', 'obrigada doutor',
  'pode ir',
  'ta bom entao', 'ta certo doutor', // Sem acentos
  'muito obrigado'
];

// Configurações do VAD
const SILENCE_THRESHOLD = 15; // Sensibilidade (0-255). Ajuste se o ambiente for ruidoso.
const SILENCE_DELAY_MS = 3000; // 3 segundos de silêncio para pausar

// Helper seguro para localStorage (evita crash em iframes bloqueados)
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

const safeRemoveItem = (key: string) => {
  try {
    localStorage.removeItem(key);
  } catch (e) {
    console.warn('LocalStorage remove denied:', e);
  }
};

const App: React.FC = () => {
  const [appState, setAppState] = useState<AppState>(AppState.IDLE);
  const [summary, setSummary] = useState<ConsultationSummary | null>(null);
  const [timer, setTimer] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [isAutoStopping, setIsAutoStopping] = useState(false);
  const [isPausedBySilence, setIsPausedBySilence] = useState(false);
  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([]);

  const [apiKey, setApiKey] = useState<string>(() => safeGetItem('otoRecordApiKey') || '');
  const [tempApiKey, setTempApiKey] = useState('');

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
  const mimeTypeRef = useRef<string>(''); // Para guardar o tipo de áudio real usado
  const timerIntervalRef = useRef<number | null>(null);
  const recognitionRef = useRef<any>(null);
  const autoStopTimeoutRef = useRef<number | null>(null);

  // Refs para VAD (Voice Activity Detection)
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const silenceStartRef = useRef<number | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  const appStateRef = useRef(appState);
  const settingsRef = useRef(settings);
  const apiKeyRef = useRef(apiKey);

  useEffect(() => { appStateRef.current = appState; }, [appState]);
  useEffect(() => { settingsRef.current = settings; }, [settings]);
  useEffect(() => { apiKeyRef.current = apiKey; }, [apiKey]);

  // Carrega lista de dispositivos quando abre configurações
  useEffect(() => {
    if (showSettings) {
      getAudioDevices();
    }
  }, [showSettings]);

  const getAudioDevices = async () => {
    try {
      // Pede permissão temporária se necessário para listar os labels
      await navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
        stream.getTracks().forEach(track => track.stop());
      }).catch(() => { }); // Ignora erro se usuário negar, apenas lista o que der

      const devices = await navigator.mediaDevices.enumerateDevices();
      const audioInputs = devices.filter(device => device.kind === 'audioinput');
      setAudioDevices(audioInputs);
    } catch (err) {
      console.error("Erro ao listar dispositivos:", err);
    }
  };

  const saveApiKey = (key: string) => {
    const cleanKey = key.trim();
    setApiKey(cleanKey);
    safeSetItem('otoRecordApiKey', cleanKey);
    if (cleanKey) setShowSettings(false);
  };

  const getSupportedMimeType = () => {
    const types = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/mp4', // Safari
      'audio/ogg;codecs=opus'
    ];
    for (const type of types) {
      if (MediaRecorder.isTypeSupported(type)) return type;
    }
    return ''; // Fallback do navegador
  };

  const stopRecording = useCallback(() => {
    if (appStateRef.current !== AppState.RECORDING) return;

    console.log("Parando gravação...");

    // Parar reconhecimento de fala
    if (recognitionRef.current) {
      recognitionRef.current.onend = null;
      recognitionRef.current.stop();
    }

    // Parar análise de áudio (VAD)
    if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      audioContextRef.current.close().catch(console.error);
    }

    // Parar gravador
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }

    if (autoStopTimeoutRef.current) window.clearTimeout(autoStopTimeoutRef.current);
    stopTimer();
    setIsAutoStopping(false);
    setIsPausedBySilence(false);
  }, []);

  // Loop de Análise de Áudio (VAD)
  const analyzeAudio = () => {
    if (!analyserRef.current || appStateRef.current !== AppState.RECORDING) return;

    const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
    analyserRef.current.getByteFrequencyData(dataArray);

    // Calcular volume médio
    let sum = 0;
    for (let i = 0; i < dataArray.length; i++) {
      sum += dataArray[i];
    }
    const average = sum / dataArray.length;

    const isSilent = average < SILENCE_THRESHOLD;
    const now = Date.now();

    if (isSilent) {
      if (!silenceStartRef.current) {
        silenceStartRef.current = now;
      } else if (now - silenceStartRef.current > SILENCE_DELAY_MS) {
        // Silêncio longo -> Pausar Recorder
        if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
          console.log("Silêncio detectado (VAD). Pausando...");
          mediaRecorderRef.current.pause();
          setIsPausedBySilence(true);
        }
      }
    } else {
      // Som detectado
      silenceStartRef.current = null;
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'paused') {
        console.log("Voz detectada (VAD). Retomando...");
        mediaRecorderRef.current.resume();
        setIsPausedBySilence(false);
      }
    }

    animationFrameRef.current = requestAnimationFrame(analyzeAudio);
  };

  const startRecording = async () => {
    if (!apiKeyRef.current) {
      setShowSettings(true);
      setErrorMsg("Configure sua Chave de API antes de iniciar.");
      return;
    }

    try {
      // Configuração de constraint para escolher o microfone
      const constraints: MediaStreamConstraints = {
        audio: settingsRef.current.selectedDeviceId
          ? { deviceId: { exact: settingsRef.current.selectedDeviceId } }
          : true
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      const mimeType = getSupportedMimeType();
      mimeTypeRef.current = mimeType;

      const options = mimeType ? { mimeType } : undefined;
      const recorder = new MediaRecorder(stream, options);

      mediaRecorderRef.current = recorder;
      audioChunksRef.current = [];

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) audioChunksRef.current.push(event.data);
      };

      recorder.onstop = async () => {
        // Blob final com o tipo correto
        const audioBlob = new Blob(audioChunksRef.current, { type: mimeType || 'audio/webm' });
        handleAudioProcessing(audioBlob);
        stream.getTracks().forEach(track => track.stop());
      };

      // Configuração do VAD
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      const analyser = audioContext.createAnalyser();
      const source = audioContext.createMediaStreamSource(stream);

      analyser.fftSize = 256;
      source.connect(analyser);

      audioContextRef.current = audioContext;
      analyserRef.current = analyser;
      sourceRef.current = source;
      silenceStartRef.current = null;

      recorder.start();
      setAppState(AppState.RECORDING);
      startTimer();
      initSpeechRecognition();

      // Inicia loop VAD
      analyzeAudio();

    } catch (err) {
      console.error(err);
      setErrorMsg("Erro ao acessar o microfone. Verifique permissões ou se o dispositivo está em uso.");
      setAppState(AppState.ERROR);
    }
  };

  const initSpeechRecognition = () => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      console.warn("SpeechRecognition não suportado neste navegador.");
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = 'pt-BR';
    recognition.continuous = true;
    recognition.interimResults = true;

    recognition.onresult = (event: any) => {
      let latestTranscript = "";
      for (let i = event.resultIndex; i < event.results.length; ++i) {
        latestTranscript += event.results[i][0].transcript;
      }

      // Normalização: remove acentos e pontuação para garantir o match
      const text = normalizeText(latestTranscript);

      // Failsafe: Se reconheceu texto, retoma gravação se estiver pausada
      if (text.length > 0 && mediaRecorderRef.current && mediaRecorderRef.current.state === 'paused') {
        mediaRecorderRef.current.resume();
        setIsPausedBySilence(false);
      }

      if (autoStopTimeoutRef.current) {
        window.clearTimeout(autoStopTimeoutRef.current);
        autoStopTimeoutRef.current = null;
        setIsAutoStopping(false);
      }

      // Verifica palavras de parada imediata
      const hasImmediateTrigger = IMMEDIATE_STOP_WORDS.some(word => text.includes(word));

      if (hasImmediateTrigger) {
        setIsAutoStopping(true);
        console.log(`Comando de parada detectado no texto: "${text}"`);
        autoStopTimeoutRef.current = window.setTimeout(() => {
          if (appStateRef.current === AppState.RECORDING) {
            stopRecording();
            showToast("Encerrado por comando de voz.");
          }
        }, 1200);
        return;
      }

      // Verifica despedidas contextuais
      const hasGeneralFarewell = FAREWELL_WORDS.some(word => text.includes(word));
      if (hasGeneralFarewell) {
        setIsAutoStopping(true);
        autoStopTimeoutRef.current = window.setTimeout(() => {
          if (appStateRef.current === AppState.RECORDING) {
            stopRecording();
            showToast("Encerrado por despedida.");
          }
        }, 3500);
      }
    };

    recognition.onend = () => {
      if (appStateRef.current === AppState.RECORDING) {
        try { recognition.start(); } catch (e) { }
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
          // Usa o mimeType real detectado na gravação
          const mimeType = mimeTypeRef.current || 'audio/webm';

          const result = await processConsultationAudio(base64Audio, mimeType, apiKeyRef.current);
          setSummary(result);
          setAppState(AppState.RESULT);
        } catch (innerError: any) {
          console.error("Erro processamento:", innerError);
          // Se for erro de chave inválida, limpa para pedir de novo
          if (innerError.message && (innerError.message.includes("Chave de API inválida") || innerError.message.includes("400"))) {
            safeRemoveItem('otoRecordApiKey');
            setApiKey('');
            setErrorMsg("Sua Chave de API parece inválida ou expirou. Por favor, configure-a novamente.");
          } else {
            setErrorMsg(innerError.message || "Erro ao processar resumo.");
          }
          setAppState(AppState.ERROR);
        }
      };
    } catch (err) {
      setErrorMsg("Erro na leitura do arquivo de áudio.");
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
ANTECEDENTES: ${s.antecedentes || 'Não relatado'}
EXAME FÍSICO: ${s.exameFisico || 'Não registrado'}
HIPÓTESE DIAGNÓSTICA: ${s.hipoteseDiagnostica || 'A investigar'}
CONDUTA: ${s.conduta}
    `.trim();

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => {
        showToast("Prontuário copiado!");
      }).catch(err => {
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
    // Só avança o timer se não estiver pausado por silêncio
    timerIntervalRef.current = window.setInterval(() => {
      if (!isPausedBySilence) {
        setTimer(v => v + 1);
      }
    }, 1000);
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
    setIsPausedBySilence(false);
  };

  const saveSettings = (newSettings: AppSettings) => {
    setSettings(newSettings);
    safeSetItem('otoRecordSettings', JSON.stringify(newSettings));
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
          <button onClick={() => setShowSettings(true)} className="p-2 text-slate-400 hover:text-blue-600 transition-colors">
            <i className="fas fa-cog text-xl"></i>
          </button>
        </div>
      </header>

      <main className="flex-1 p-6 flex flex-col items-center justify-center">
        {(!apiKey && !showSettings) && (
          <div className="fixed inset-0 bg-white z-50 flex flex-col items-center justify-center p-8 text-center animate-fadeIn">
            <div className="w-24 h-24 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center mb-6 text-3xl">
              <i className="fas fa-key"></i>
            </div>
            <h2 className="text-2xl font-bold text-slate-800 mb-2">Bem-vindo ao OtoRecord</h2>
            <p className="text-slate-500 mb-8 max-w-md">
              Para garantir privacidade e desempenho, este aplicativo requer sua própria <strong>Chave de API do Google Gemini</strong>.
            </p>
            <button
              onClick={() => setShowSettings(true)}
              className="bg-blue-600 hover:bg-blue-700 text-white px-8 py-3 rounded-full font-bold shadow-lg flex items-center gap-2 transition-transform active:scale-95"
            >
              Configurar Minha Chave <i className="fas fa-arrow-right"></i>
            </button>
            <a
              href="https://aistudio.google.com/app/apikey"
              target="_blank"
              rel="noreferrer"
              className="mt-6 text-sm text-blue-500 hover:underline"
            >
              Não tem uma chave? Crie uma aqui gratuitamente.
            </a>
          </div>
        )}

        {appState === AppState.IDLE && apiKey && (
          <div className="text-center max-w-lg animate-fadeIn">
            <div className="w-24 h-24 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center mx-auto mb-6 text-3xl shadow-inner">
              <i className="fas fa-microphone"></i>
            </div>
            <h2 className="text-2xl font-bold text-slate-800 mb-2">Nova Consulta</h2>
            <p className="text-slate-500 mb-8">
              Fale <span className="font-bold text-blue-600">"Encerrar"</span> ou <span className="font-bold text-blue-600">"Tchau"</span> para finalizar.
            </p>
            <button
              onClick={startRecording}
              className="bg-blue-600 hover:bg-blue-700 text-white px-8 py-4 rounded-full font-bold shadow-lg flex items-center gap-3 mx-auto transition-all active:scale-95"
            >
              <i className="fas fa-play"></i> Iniciar ({settings.startStopKey})
            </button>
          </div>
        )}

        {appState === AppState.RECORDING && (
          <div className="text-center">

            {/* Indicador Visual do Estado (Gravando vs Pausado por Silêncio) */}
            <div className={`w-32 h-32 rounded-full flex items-center justify-center mx-auto mb-6 relative shadow-inner transition-colors duration-500 ${isPausedBySilence ? 'bg-amber-100' : 'bg-red-100'}`}>
              <i className={`fas text-4xl transition-colors duration-500 ${isPausedBySilence ? 'fa-microphone-slash text-amber-500' : 'fa-microphone text-red-500 animate-pulse'}`}></i>
              {!isPausedBySilence && (
                <div className="absolute inset-0 border-4 border-red-500 rounded-full animate-ping opacity-20"></div>
              )}
            </div>

            <div className={`text-5xl font-mono font-bold mb-4 tabular-nums transition-colors duration-300 ${isPausedBySilence ? 'text-amber-500' : 'text-slate-800'}`}>
              {Math.floor(timer / 60)}:{(timer % 60).toString().padStart(2, '0')}
            </div>

            {isAutoStopping ? (
              <div className="mb-6 px-4 py-2 bg-blue-100 text-blue-700 rounded-full text-sm font-bold animate-bounce inline-block border border-blue-200">
                <i className="fas fa-check mr-2"></i> Encerrando consulta...
              </div>
            ) : isPausedBySilence ? (
              <div className="mb-6 px-4 py-2 bg-amber-50 text-amber-600 rounded-full text-xs font-bold inline-block border border-amber-100 uppercase tracking-wide shadow-sm animate-pulse">
                <i className="fas fa-pause mr-2"></i> Pausa Inteligente (Silêncio)
              </div>
            ) : (
              <div className="mb-6 text-slate-400 text-xs font-medium uppercase tracking-widest flex items-center justify-center gap-2">
                <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse"></span>
                Gravando áudio...
              </div>
            )}

            <div>
              <button
                onClick={stopRecording}
                className="bg-slate-800 hover:bg-slate-900 text-white px-10 py-4 rounded-full font-bold shadow-lg active:scale-95 transition-all"
              >
                Parar Manual ({settings.startStopKey})
              </button>
            </div>
          </div>
        )}

        {appState === AppState.PROCESSING && (
          <div className="text-center max-w-sm animate-pulse">
            <div className="w-16 h-16 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-6"></div>
            <h2 className="text-xl font-bold text-slate-800">Processando...</h2>
            <p className="text-slate-500 mt-2">
              Aguarde. Graças à Pausa Inteligente, o envio será mais rápido.
            </p>
          </div>
        )}

        {appState === AppState.RESULT && summary && (
          <div className="w-full max-w-4xl animate-fadeIn">
            <div className="mb-4 flex justify-between items-center px-2">
              <span className="text-xs text-slate-400 font-medium">Copiar: <b className="text-slate-600">{settings.copyKey}</b></span>
              <button onClick={resetApp} className="text-xs text-blue-600 font-bold hover:text-blue-800 transition-colors">NOVA CONSULTA</button>
            </div>
            <SummaryCard summary={summary} onReset={resetApp} onCopy={copySummaryText} />
          </div>
        )}

        {appState === AppState.ERROR && (
          <div className="text-center max-w-md animate-fadeIn bg-white p-6 rounded-xl shadow-lg border border-red-100">
            <div className="text-red-500 text-5xl mb-4">
              <i className="fas fa-exclamation-triangle"></i>
            </div>
            <h2 className="text-lg font-bold text-slate-800 mb-2">Ops! Algo deu errado.</h2>
            <p className="text-slate-600 text-sm mb-6 bg-red-50 p-3 rounded-lg border border-red-100">{errorMsg}</p>
            <button onClick={resetApp} className="bg-blue-600 hover:bg-blue-700 text-white px-8 py-3 rounded-lg font-bold transition-colors w-full">
              Tentar Novamente
            </button>
          </div>
        )}
      </main>

      {showSettings && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl shadow-2xl p-8 w-full max-w-md animate-fadeIn max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-lg font-bold text-slate-800">Configurações</h3>
              {apiKey && (
                <button onClick={() => setShowSettings(false)} className="text-slate-400 hover:text-slate-600">
                  <i className="fas fa-times"></i>
                </button>
              )}
            </div>

            <div className="space-y-8">
              {/* Seção API Key */}
              <div className="bg-blue-50 p-4 rounded-2xl border border-blue-100">
                <label className="text-xs font-bold text-blue-600 uppercase tracking-widest block mb-2">
                  <i className="fas fa-key mr-1"></i> Chave de API Gemini
                </label>
                <p className="text-xs text-slate-500 mb-3">
                  Sua chave é armazenada localmente no seu navegador.
                </p>
                <div className="flex gap-2">
                  <input
                    type="password"
                    className="flex-1 bg-white border border-blue-200 p-3 rounded-xl text-sm font-mono outline-none focus:ring-2 ring-blue-500"
                    placeholder="Cole sua chave aqui (AIza...)"
                    defaultValue={apiKey}
                    onChange={(e) => setTempApiKey(e.target.value)}
                  />
                  <button
                    onClick={() => saveApiKey(tempApiKey || apiKey)}
                    className="bg-blue-600 text-white px-4 rounded-xl font-bold hover:bg-blue-700"
                  >
                    Salvar
                  </button>
                </div>
                <div className="mt-2 text-right">
                  <a href="https://aistudio.google.com/app/apikey" target="_blank" className="text-xs text-blue-500 underline hover:text-blue-700">Obter chave grátis</a>
                </div>
              </div>

              {/* Seção Seleção de Microfone (NOVO) */}
              {apiKey && (
                <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100">
                  <h4 className="text-sm font-bold text-slate-700 mb-3 flex items-center gap-2">
                    <i className="fas fa-microphone-lines"></i> Microfone
                  </h4>
                  <select
                    className="w-full p-3 bg-white border border-slate-200 rounded-xl text-sm text-slate-700 outline-none focus:ring-2 ring-blue-500"
                    value={settings.selectedDeviceId || ''}
                    onChange={(e) => saveSettings({ ...settings, selectedDeviceId: e.target.value })}
                  >
                    <option value="">Padrão do Sistema</option>
                    {audioDevices.map((device) => (
                      <option key={device.deviceId} value={device.deviceId}>
                        {device.label || `Microfone ${device.deviceId.slice(0, 5)}...`}
                      </option>
                    ))}
                  </select>
                  <p className="text-[10px] text-slate-400 mt-2">
                    Use microfones diferentes para rodar dois apps ao mesmo tempo.
                  </p>
                </div>
              )}

              {/* Seção Atalhos */}
              {apiKey && (
                <div>
                  <h4 className="text-sm font-bold text-slate-700 mb-4 border-b pb-2">Atalhos de Teclado</h4>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Gravar / Parar</label>
                      <div className="relative mt-1">
                        <input
                          className="w-full bg-slate-50 border-2 border-slate-100 p-3 rounded-xl text-center font-mono font-bold text-slate-600 focus:border-blue-500 outline-none transition-all cursor-pointer text-sm"
                          readOnly value={settings.startStopKey}
                          onKeyDown={(e) => { e.preventDefault(); saveSettings({ ...settings, startStopKey: e.key }); }}
                        />
                      </div>
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Copiar Resumo</label>
                      <div className="relative mt-1">
                        <input
                          className="w-full bg-slate-50 border-2 border-slate-100 p-3 rounded-xl text-center font-mono font-bold text-slate-600 focus:border-blue-500 outline-none transition-all cursor-pointer text-sm"
                          readOnly value={settings.copyKey}
                          onKeyDown={(e) => { e.preventDefault(); saveSettings({ ...settings, copyKey: e.key }); }}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {apiKey && (
              <button onClick={() => setShowSettings(false)} className="w-full mt-8 bg-slate-800 hover:bg-slate-900 text-white py-4 rounded-2xl font-bold shadow-lg transition-all active:scale-95">
                Fechar
              </button>
            )}
          </div>
        </div>
      )}

      <footer className="p-6 text-center text-[10px] text-slate-400 font-bold uppercase tracking-[0.2em] border-t border-slate-100 bg-white">
        OtoRecord &bull; {new Date().getFullYear()} &bull; IA Médica
      </footer>

      <style>{`
        @keyframes fadeIn { from { opacity: 0; transform: translateY(15px); } to { opacity: 1; transform: translateY(0); } }
        .animate-fadeIn { animation: fadeIn 0.3s cubic-bezier(0.4, 0, 0.2, 1) forwards; }
      `}</style>
    </div>
  );
};

export default App;
