
import React, { useState, useRef, useEffect } from 'react';
import { processConsultationAudio } from './services/geminiService';
import { AppState, ConsultationSummary } from './types';
import SummaryCard from './components/SummaryCard';

const App: React.FC = () => {
  const [appState, setAppState] = useState<AppState>(AppState.IDLE);
  const [summary, setSummary] = useState<ConsultationSummary | null>(null);
  const [timer, setTimer] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerIntervalRef = useRef<number | null>(null);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const options = { mimeType: 'audio/webm' };
      
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
    if (mediaRecorderRef.current && appState === AppState.RECORDING) {
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
            <h1 className="text-xl font-bold text-slate-800">OtoRecord</h1>
          </div>
          <div className="hidden md:block text-slate-500 text-sm font-medium">
            Assistente de Anamnese Otorrinolaringológica
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
              Clique no botão abaixo para iniciar a gravação da consulta. O OtoRecord organizará automaticamente os sintomas, histórico e conduta.
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
            <p className="text-red-500 font-semibold mb-8 uppercase tracking-widest text-sm">Gravando Consulta...</p>
            <button 
              onClick={stopRecording}
              className="bg-slate-800 hover:bg-slate-900 text-white px-10 py-4 rounded-full font-bold shadow-lg transition-all flex items-center gap-3 mx-auto text-lg"
            >
              <i className="fas fa-stop text-white"></i> Finalizar e Analisar
            </button>
          </div>
        )}

        {appState === AppState.PROCESSING && (
          <div className="text-center max-w-md animate-fadeIn">
            <div className="mb-8">
              <div className="w-20 h-20 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto"></div>
            </div>
            <h2 className="text-2xl font-bold text-slate-800 mb-4">Processando Informações</h2>
            <p className="text-slate-600">
              O Gemini está analisando o áudio e organizando os dados da consulta para o prontuário. Isso levará apenas alguns segundos...
            </p>
            <div className="mt-8 space-y-3">
              <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                <div className="h-full bg-blue-600 w-2/3 animate-[progress_2s_infinite]"></div>
              </div>
              <p className="text-xs text-slate-400">Transcrevendo áudio e extraindo queixas principais...</p>
            </div>
          </div>
        )}

        {appState === AppState.RESULT && summary && (
          <SummaryCard summary={summary} onReset={resetApp} />
        )}

        {appState === AppState.ERROR && (
          <div className="text-center max-w-md animate-fadeIn">
            <div className="w-20 h-20 bg-red-100 text-red-600 rounded-full flex items-center justify-center mx-auto mb-6 text-3xl">
              <i className="fas fa-exclamation-triangle"></i>
            </div>
            <h2 className="text-2xl font-bold text-slate-800 mb-4">Ocorreu um Erro</h2>
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

      {/* Footer */}
      <footer className="bg-white border-t border-slate-200 p-4">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-center gap-4">
          <p className="text-slate-500 text-sm">
            &copy; 2024 OtoRecord - Inteligência Artificial para Otorrinolaringologia
          </p>
          <div className="flex gap-4 text-slate-400 text-sm">
            <span className="flex items-center gap-1"><i className="fas fa-shield-alt"></i> HIPAA Compliant Interface</span>
            <span className="flex items-center gap-1"><i className="fas fa-lock"></i> Dados Criptografados</span>
          </div>
        </div>
      </footer>

      <style>{`
        @keyframes progress {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(100%); }
        }
        .animate-fadeIn {
          animation: fadeIn 0.5s ease-out forwards;
        }
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
};

export default App;
