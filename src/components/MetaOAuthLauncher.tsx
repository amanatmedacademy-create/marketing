import { useEffect, useLayoutEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Facebook, LoaderCircle, Settings2, X } from 'lucide-react';

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

  const initialize = (): FacebookSdk => {
    if (!target.FB) throw new Error('Facebook SDK недоступен');
    target.FB.init({ appId: config.appId as string, cookie: true, xfbml: false, version: config.version as string });
    target.FB.AppEvents?.logPageView();
    return target.FB;
  };

  if (target.FB) return initialize();

  return new Promise<FacebookSdk>((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      callback();
    };
    const timeout = window.setTimeout(
      () => finish(() => reject(new Error('Facebook SDK не загрузился'))),
      15000,
    );
    const ready = () => finish(() => {
      try { resolve(initialize()); } catch (error) { reject(error); }
    });

    const previous = target.fbAsyncInit;
    target.fbAsyncInit = () => {
      previous?.();
      ready();
    };

    const existing = document.getElementById('facebook-jssdk') as HTMLScriptElement | null;
    if (existing) {
      existing.addEventListener('load', ready, { once: true });
      existing.addEventListener('error', () => finish(() => reject(new Error('Не удалось загрузить Facebook SDK'))), { once: true });
      return;
    }

    const script = document.createElement('script');
    script.id = 'facebook-jssdk';
    script.async = true;
    script.defer = true;
    script.crossOrigin = 'anonymous';
    script.src = 'https://connect.facebook.net/ru_RU/sdk.js';
    script.addEventListener('load', ready, { once: true });
    script.addEventListener('error', () => finish(() => reject(new Error('Не удалось загрузить Facebook SDK'))), { once: true });
    document.head.appendChild(script);
  });
}

export default function MetaOAuthLauncher() {
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [sdk, setSdk] = useState<FacebookSdk | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [target, setTarget] = useState<Element | null>(null);
  const [card, setCard] = useState<Element | null>(null);
  const [manualMode, setManualMode] = useState(false);

  useEffect(() => {
    if (!isIntegrationsRoute()) return;

    const locateTarget = () => {
      const nextCard = document.querySelector('.connection-card--meta');
      const nextTarget = nextCard?.querySelector('.connection-actions') || null;
      setCard((current) => current === nextCard ? current : nextCard);
      setTarget((current) => current === nextTarget ? current : nextTarget);
    };

    locateTarget();
    const interval = window.setInterval(locateTarget, 300);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!target) {
      setReady(false);
      setSdk(null);
      return;
    }

    let cancelled = false;
    const initialize = async () => {
      setReady(false);
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
  }, [target]);

  useLayoutEffect(() => {
    if (!card) return;
    card.classList.toggle('connection-card--oauth', !manualMode);
    return () => card.classList.remove('connection-card--oauth');
  }, [card, manualMode]);

  if (!isIntegrationsRoute() || !target) return null;

  const saveToken = async (accessToken: string) => {
    const response = await fetch('/api/integrations/meta/sdk-connect', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ accessToken }),
    });
    const body = await response.text();
    if (!response.ok) throw new Error(parseError(body || `HTTP ${response.status}`));
    const result = JSON.parse(body) as { accounts?: number; written?: number };

    setMessage(`Meta подключена. Кабинетов: ${result.accounts || 0}. Записано строк: ${result.written || 0}.`);
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
    <button
      type="button"
      className="connections-button"
      onClick={() => setManualMode((value) => !value)}
      disabled={busy}
    >
      {manualMode ? <X size={16}/> : <Settings2 size={16}/>} {manualMode ? 'Скрыть ручные настройки' : 'Подключить вручную'}
    </button>
    {message && <span className="meta-oauth-message">{message}</span>}
  </>, target);
}
