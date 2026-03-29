import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Root element #root was not found in index.html');
}

const root = createRoot(rootElement);

root.render(
  <div
    style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: 'Segoe UI, system-ui, sans-serif',
      background: '#f5f5f5',
      color: '#111'
    }}
  >
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontSize: 22, fontWeight: 700 }}>KingKush Sale</div>
      <div style={{ marginTop: 8, fontSize: 14, opacity: 0.75 }}>Bootstrapping application...</div>
    </div>
  </div>
);

const renderStartupError = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  root.render(
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#fff5f5',
        color: '#111',
        padding: 24,
        fontFamily: 'Segoe UI, system-ui, sans-serif'
      }}
    >
      <div style={{ maxWidth: 900, width: '100%', background: '#fff', border: '1px solid #fecaca', borderRadius: 16, padding: 24 }}>
        <h1 style={{ fontSize: 28, fontWeight: 700, color: '#b91c1c', margin: 0 }}>Application Failed To Start</h1>
        <p style={{ marginTop: 12, marginBottom: 0, color: '#374151' }}>A runtime error occurred during startup. Open browser DevTools Console for full details.</p>
        <pre style={{ marginTop: 16, padding: 16, background: '#f9fafb', color: '#b91c1c', borderRadius: 12, overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{message}</pre>
      </div>
    </div>
  );
};

window.addEventListener('error', (event) => {
  if (process.env.NODE_ENV === 'development') {
    console.error('Global runtime error:', event.error || event.message);
  }
});

window.addEventListener('unhandledrejection', (event) => {
  if (process.env.NODE_ENV === 'development') {
    console.error('Unhandled promise rejection:', event.reason);
  }
});

void import('./App.tsx')
  .then(({ default: App }) => {
    root.render(
      <StrictMode>
        <App />
      </StrictMode>
    );
  })
  .catch((error) => {
    if (process.env.NODE_ENV === 'development') {
      console.error('Fatal startup import error:', error);
    }
    renderStartupError(error);
  });
