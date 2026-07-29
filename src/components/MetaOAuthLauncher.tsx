import { useEffect, useState } from 'react';
import { Facebook, LoaderCircle, X } from 'lucide-react';

interface SdkConfig {
  configured?: boolean;
  appId?: string;
  version?: string;
  error?: string;
}

interface FacebookAuthResponse {
  accessToken?: string;
  expiresIn?: number;
  signedRequest?: string;
  userID?: string;
}

interface FacebookLoginResponse {
  status?: string;
  authResponse?: FacebookAuthResponse;
}

interface FacebookSdk {
  init(options: { appId: string; cookie: boolean; xfbml: boolean; version: string }): void;
  login(callback: (response: FacebookLoginResponse) => void, options?: { scope?: string; return_scopes?: boolean }): void;
  getLoginStatus(callback: (response: FacebookLoginResponse) => void): void;
  AppEvents?: { logPageView(): void };
}

type FacebookWindow = Window & typeof globalThis & { FB?: FacebookSdk; fbAsyncInit?: () => void };

function isIntegrationsRoute(): boolean {
  const normalized = window.location.pathname.replace(/\/+$/, '') || '/';
  return normalized === '/integrations';
}

function parseError(message: string): string {
  try {
    const parsed = JSON.parse(message) as { error?: string };
    return parsed.error || message;
  } catch {
    return message;
  }
}

async function loadFacebookSdk(config: SdkConfig): Promise<FacebookSdk> {
  if (!config.appId || !config.version) throw new Error('META_APP_ID или версия Graph API не настроены');
  const target = window as FacebookWindow;
  if (target.FB) return target.FB;

  return new Promise<FacebookSdk>((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error('Facebook SDK не загрузился')), 15000);
    target.fbAsyncInit = () => {
      if (!target.FB) {
        window.clearTimeout(timeout);
        reject(new Error('Facebook SDK недоступен'));
        return;
      }
      target.FB.init({ appId: config.appId as string, cookie: true, xfbml: false, version: config.version as string });
      target.FB.AppEvents?.logPageView();
      window.clearTimeout(timeout);
      resolve(target.FB);
    };

    const existing = document.getElementById('facebook-jssdk');
    if (existing) return;
    const script = document.createElement('script');
    script.id = 'facebook-jssdk';
    script.async = true;
    script.defer = true;
    script.crossOrigin = 'anonymous';
    script.src = 'https://connect.facebook.net/ru_RU/sdk.js';
    script.onerror = () => {
      window.clearTimeout(timeout);
      reject(new Error('Не удалось загрузить Facebook SDK'));
    };
    document.head.appendChild(script);
  });
}

export default function MetaOAuthLauncher() {
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [sdk, setSdk] = useState<FacebookSdk | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!isIntegrationsRoute()) return;
    let cancelled = false;

    const initialize = async () => {
      try {
        const response = await fetch('/api/integrations/meta/sdk-config', { headers: { accept: 'application/json' } });
        const body = await response.text();
        const config = body ? JSON.parse(body) as SdkConfig : {};
        if (!response.ok || !config.configured) throw new Error(config.error || 'Meta App не настроено в Cloudflare');
        const loaded = await loadFacebookSdk(config);
        if (!cancelled) {
          setSdk(loaded);
          setReady(true);
        }
      } catch (error) {
        if (!cancelled) setMessage(error instanceof Error ? error.message : String(error));
      }
    };

    void initialize();
    return () => { cancelled = true; };
  }, []);

  if (!isIntegrationsRoute()) return null;

  const saveToken = async (accessToken: string) => {
    const response = await fetch('/api/integrations/meta/sdk-connect', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ accessToken }),
    });
    const body = await response.text();
    if (!response.ok) throw new Error(parseError(body || `HTTP ${response.status}`));
    const result = JSON.parse(body) as { accounts?: number };

    setMessage(`Meta подключена. Загружаем данные из ${result.accounts || 0} рекламных кабинетов…`);
    const syncResponse = await fetch('/api/integrations/sync', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ source: 'meta', days: 90 }),
    });
    const syncBody = await syncResponse.text();
    if (!syncResponse.ok) throw new Error(parseError(syncBody || `HTTP ${syncResponse.status}`));
    const syncResult = JSON.parse(syncBody) as { results?: Array<{ fetched?: number; written?: number; skipped?: boolean; reason?: string }> };
    const metaResult = syncResult.results?.[0];
    if (metaResult?.skipped || metaResult?.reason) throw new Error(metaResult.reason || 'Meta синхронизация пропущена');

    setMessage(`Meta подключена. Загружено строк: ${metaResult?.written ?? metaResult?.fetched ?? 0}.`);
    window.setTimeout(() => window.location.assign('/'), 1500);
  };

  const connect = async () => {
    if (!sdk) {
      setMessage('Facebook SDK ещё загружается');
      return;
    }
    setBusy(true);
    setMessage(null);

    sdk.login((response) => {
      const accessToken = response.authResponse?.accessToken;
      if (response.status !== 'connected' || !accessToken) {
        setBusy(false);
        setMessage('Вход в Facebook не завершён или доступ не предоставлен');
        return;
      }
      void saveToken(accessToken)
        .catch((error) => setMessage(error instanceof Error ? error.message : String(error)))
        .finally(() => setBusy(false));
    }, {
      scope: 'ads_read,business_management',
      return_scopes: true,
    });
  };

  return <div style={{
    position: 'fixed',
    right: 24,
    bottom: 24,
    zIndex: 10000,
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    maxWidth: 560,
    padding: 12,
    borderRadius: 14,
    background: '#111827',
    boxShadow: '0 18px 48px rgba(0,0,0,.32)',
    color: '#fff',
  }}>
    <button
      type="button"
      onClick={() => void connect()}
      disabled={busy || !ready}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        border: 0,
        borderRadius: 10,
        padding: '10px 14px',
        fontWeight: 700,
        cursor: busy || !ready ? 'wait' : 'pointer',
        opacity: ready ? 1 : 0.72,
        background: '#1877f2',
        color: '#fff',
      }}
    >
      {busy || !ready ? <LoaderCircle size={18} className="spin"/> : <Facebook size={18}/>} {ready ? 'Войти через Facebook' : 'Загружаем Facebook'}
    </button>
    {message && <span style={{ fontSize: 13, lineHeight: 1.35 }}>{message}</span>}
    {message && <button type="button" aria-label="Закрыть" onClick={() => setMessage(null)} style={{ border: 0, background: 'transparent', color: '#fff', cursor: 'pointer', padding: 4 }}><X size={16}/></button>}
  </div>;
}
