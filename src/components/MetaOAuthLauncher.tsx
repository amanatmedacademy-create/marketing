import { useEffect, useState } from 'react';
import { Facebook, LoaderCircle, X } from 'lucide-react';

interface StartResponse {
  ok?: boolean;
  authorizationUrl?: string;
  redirectUri?: string;
  error?: string;
}

export default function MetaOAuthLauncher() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (window.location.pathname !== '/integrations') return;
    const params = new URLSearchParams(window.location.search);
    const status = params.get('meta');
    if (status === 'connected') {
      const accounts = params.get('accounts') || '0';
      setMessage(`Meta подключена. Найдено рекламных кабинетов: ${accounts}.`);
    } else if (status === 'error') {
      setMessage(`Ошибка Meta: ${params.get('message') || 'подключение не завершено'}`);
    }
    if (status) {
      params.delete('meta');
      params.delete('accounts');
      params.delete('message');
      const query = params.toString();
      window.history.replaceState({}, '', `${window.location.pathname}${query ? `?${query}` : ''}`);
    }
  }, []);

  if (window.location.pathname !== '/integrations') return null;

  const connect = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch('/api/integrations/meta/start', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
      const payload = await response.json() as StartResponse;
      if (!response.ok || !payload.authorizationUrl) throw new Error(payload.error || 'Не удалось начать вход через Facebook');
      window.location.assign(payload.authorizationUrl);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
      setBusy(false);
    }
  };

  return <div style={{
    position: 'fixed',
    right: 24,
    bottom: 24,
    zIndex: 1000,
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    maxWidth: 520,
    padding: 12,
    borderRadius: 14,
    background: '#111827',
    boxShadow: '0 18px 48px rgba(0,0,0,.32)',
    color: '#fff',
  }}>
    <button
      type="button"
      onClick={() => void connect()}
      disabled={busy}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        border: 0,
        borderRadius: 10,
        padding: '10px 14px',
        fontWeight: 700,
        cursor: busy ? 'wait' : 'pointer',
        background: '#1877f2',
        color: '#fff',
      }}
    >
      {busy ? <LoaderCircle size={18} className="spin"/> : <Facebook size={18}/>} Войти через Facebook
    </button>
    {message && <span style={{ fontSize: 13, lineHeight: 1.35 }}>{message}</span>}
    {message && <button type="button" aria-label="Закрыть" onClick={() => setMessage(null)} style={{ border: 0, background: 'transparent', color: '#fff', cursor: 'pointer', padding: 4 }}><X size={16}/></button>}
  </div>;
}
