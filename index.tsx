
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

// Força a limpeza de Service Workers antigos
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then((registrations) => {
    for (const registration of registrations) {
      registration.unregister();
    }
  }).catch((err) => {
    console.error('Erro ao limpar SW:', err);
  });
}

// Componente simples de Error Boundary para capturar falhas globais
class ErrorBoundary extends React.Component<{children: React.ReactNode}, {hasError: boolean, error: Error | null}> {
  constructor(props: {children: React.ReactNode}) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
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
