
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

// Força a limpeza de Service Workers antigos de forma segura
const cleanupServiceWorkers = async () => {
  if ('serviceWorker' in navigator) {
    try {
      // Usamos getRegistrations para limpar workers de versões anteriores ou conflitos
      const registrations = await navigator.serviceWorker.getRegistrations();
      for (const registration of registrations) {
        await registration.unregister();
      }
    } catch (err) {
      // Silenciosamente ignora erros de "invalid state" que podem ocorrer em iframes ou ambientes de preview
      if (!(err instanceof Error && (err.message.includes('invalid state') || err.message.includes('Document is in an invalid state')))) {
        console.error('Erro ao limpar SW:', err);
      }
    }
  }
};

// Executa limpeza quando a janela estiver totalmente carregada para evitar erros de estado do documento
if (document.readyState === 'complete') {
  cleanupServiceWorkers();
} else {
  window.addEventListener('load', cleanupServiceWorkers);
}

// Interface for ErrorBoundary props
interface ErrorBoundaryProps {
  children?: React.ReactNode;
}

// Interface for ErrorBoundary state
interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

// Componente simples de Error Boundary para capturar falhas globais
class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  // Explicitly declare state and props to resolve TS errors
  public state: ErrorBoundaryState = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("Uncaught error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: '20px', fontFamily: 'sans-serif', color: '#333', textAlign: 'center', marginTop: '50px' }}>
          <h1 style={{color: '#e11d48'}}>Ocorreu um erro inesperado</h1>
          <p>Se você está usando o Google AI Studio Preview, recarregue a página.</p>
          <pre style={{ background: '#f1f5f9', padding: '15px', borderRadius: '8px', overflowX: 'auto', textAlign: 'left', maxWidth: '600px', margin: '20px auto', fontSize: '12px' }}>
            {this.state.error?.toString()}
          </pre>
          <button 
            onClick={() => window.location.reload()}
            style={{ padding: '10px 20px', background: '#2563eb', color: 'white', border: 'none', borderRadius: '5px', cursor: 'pointer', fontWeight: 'bold' }}
          >
            Recarregar Página
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
