import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Facebook, LoaderCircle } from 'lucide-react';

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

    if (document.getElementById('facebook-jssdk')) return;
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
  const [target, setTarget] = useState<Element | null>(null);

  useEffect(() => {
    if (!isIntegrationsRoute()) return;
    let cancelled = false;

    const mountIntoCard = () => {
      const card = document.querySelector('.connection-card--meta');
      const actions = card?.querySelector('.connection-actions');
      if (card && actions) {
        card.classList.add('connection-card--oauth');
        setTarget(actions);
      }
    };

    mountIntoCard();
    const observer = new MutationObserver(mountIntoCard);
    observer.observe(document.body, { childList: true, subtree: true });

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
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, []);

  if (!isIntegrationsRoute() || !target) return null;

  const saveToken = async (accessToken: string) => {
    const response = await fetch('/api/integrations/meta/sdk-connect', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ accessToken }),
    });
    const body = await response.text();
    if (!response.ok) throw new Error(parseError(body || `HTTP ${response.status}`));
    const result = JSON.parse(body) as { accounts?: number };

    setMessage(`Подключено кабинетов: ${result.accounts || 0}. Загружаем историю за 90 дней…`);
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

    setMessage(`Meta подключена. Записано строк: ${metaResult?.written ?? metaResult?.fetched ?? 0}.`);
    window.setTimeout(() => window.location.reload(), 1200);
  };

  const connect = () => {
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
    }, { scope: 'ads_read,business_management', return_scopes: true });
  };

  return createPortal(<>
    <button
      type="button"
      className="connections-button connections-button--facebook"
      onClick={connect}
      disabled={busy || !ready}
    >
      {busy || !ready ? <LoaderCircle size={16} className="spin"/> : <Facebook size={16}/>} {busy ? 'Подключаем Meta…' : ready ? 'Подключить через Facebook' : 'Загружаем Facebook'}
    </button>
    {message && <span className="meta-oauth-message">{message}</span>}
  </>, target);
}
