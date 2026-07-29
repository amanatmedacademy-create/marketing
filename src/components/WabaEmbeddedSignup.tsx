import { useEffect, useState } from 'react';
import { AlertCircle, Facebook, LoaderCircle, RotateCw } from 'lucide-react';

type FacebookLoginResponse = { status?: string; authResponse?: { code?: string } };
type FacebookSdk = {
  init(options: { appId: string; cookie: boolean; xfbml: boolean; version: string }): void;
  login(callback: (response: FacebookLoginResponse) => void, options: Record<string, unknown>): void;
};
type FacebookWindow = Window & typeof globalThis & { FB?: FacebookSdk; fbAsyncInit?: () => void };
type WabaConfig = { configured?: boolean; appId?: string; version?: string; configId?: string; error?: string };
type SignupData = { wabaId?: string; phoneNumberId?: string };
type LoadState = 'loading' | 'ready' | 'error';

async function loadSdk(config: WabaConfig): Promise<FacebookSdk> {
  if (!config.appId || !config.version) throw new Error('Facebook App для WABA не настроен');

  const target = window as FacebookWindow;
  if (target.FB) {
    target.FB.init({ appId: config.appId, cookie: true, xfbml: false, version: config.version });
    return target.FB;
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      callback();
    };
    const timeout = window.setTimeout(
      () => finish(() => reject(new Error('Facebook SDK не загрузился за 15 секунд. Проверьте блокировщик рекламы, CSP и доступ к connect.facebook.net.'))),
      15000,
    );

    const initialize = () => {
      if (!target.FB) {
        finish(() => reject(new Error('Facebook SDK загрузился, но объект FB недоступен')));
        return;
      }
      target.FB.init({ appId: config.appId as string, cookie: true, xfbml: false, version: config.version as string });
      finish(() => resolve(target.FB as FacebookSdk));
    };

    const previous = target.fbAsyncInit;
    target.fbAsyncInit = () => {
      previous?.();
      initialize();
    };

    const existingScript = document.getElementById('facebook-jssdk') as HTMLScriptElement | null;
    if (existingScript) {
      existingScript.addEventListener('load', initialize, { once: true });
      existingScript.addEventListener('error', () => finish(() => reject(new Error('Не удалось загрузить Facebook SDK'))), { once: true });
      return;
    }

    const script = document.createElement('script');
    script.id = 'facebook-jssdk';
    script.async = true;
    script.defer = true;
    script.crossOrigin = 'anonymous';
    script.src = 'https://connect.facebook.net/ru_RU/sdk.js';
    script.onerror = () => finish(() => reject(new Error('Не удалось загрузить Facebook SDK. Проверьте сеть, CSP или блокировщик рекламы.')));
    document.head.appendChild(script);
  });
}

export default function WabaEmbeddedSignup() {
  const [sdk, setSdk] = useState<FacebookSdk | null>(null);
  const [config, setConfig] = useState<WabaConfig | null>(null);
  const [signup, setSignup] = useState<SignupData>({});
  const [busy, setBusy] = useState(false);
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [message, setMessage] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    let active = true;
    setLoadState('loading');
    setMessage(null);
    setSdk(null);

    const receive = (event: MessageEvent) => {
      if (!event.origin.endsWith('facebook.com')) return;
      try {
        const payload = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
        if (payload?.type !== 'WA_EMBEDDED_SIGNUP') return;
        const data = payload.data || {};
        setSignup({ wabaId: data.waba_id, phoneNumberId: data.phone_number_id });
      } catch { /* unrelated message */ }
    };

    window.addEventListener('message', receive);

    void fetch('/api/integrations/waba/config', { headers: { accept: 'application/json' } })
      .then(async (response) => {
        const body = await response.text();
        let value: WabaConfig = {};
        try { value = body ? JSON.parse(body) as WabaConfig : {}; } catch { throw new Error(`Некорректный ответ конфигурации WABA: HTTP ${response.status}`); }
        if (!response.ok || !value.configured) throw new Error(value.error || 'WABA Embedded Signup не настроен');
        if (!active) return;
        setConfig(value);
        const loaded = await loadSdk(value);
        if (active) {
          setSdk(loaded);
          setLoadState('ready');
        }
      })
      .catch((error) => {
        if (!active) return;
        setLoadState('error');
        setMessage(error instanceof Error ? error.message : String(error));
      });

    return () => {
      active = false;
      window.removeEventListener('message', receive);
    };
  }, [retryKey]);

  const connect = () => {
    if (!sdk || !config?.configId) {
      setMessage('Facebook Embedded Signup не готов. Повторите загрузку.');
      return;
    }

    setBusy(true);
    setMessage(null);
    sdk.login((response) => {
      const code = response.authResponse?.code;
      if (!code) {
        setBusy(false);
        setMessage('Подключение WhatsApp Business не завершено');
        return;
      }

      fetch('/api/integrations/waba/connect', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code, wabaId: signup.wabaId, phoneNumberId: signup.phoneNumberId }),
      })
        .then(async (result) => {
          const body = await result.text();
          if (!result.ok) throw new Error(body ? (JSON.parse(body).error || body) : `HTTP ${result.status}`);
          const value = JSON.parse(body) as { wabaId?: string; phoneNumberId?: string };
          setMessage(`WABA подключена${value.phoneNumberId ? ` · номер ${value.phoneNumberId}` : ''}`);
        })
        .catch((error) => setMessage(error instanceof Error ? error.message : String(error)))
        .finally(() => setBusy(false));
    }, {
      config_id: config.configId,
      response_type: 'code',
      override_default_response_type: true,
      extras: { setup: {}, featureType: 'whatsapp_business_app_onboarding' },
    });
  };

  const retry = () => setRetryKey((value) => value + 1);
  const loading = loadState === 'loading';
  const failed = loadState === 'error';

  return <div className="waba-signup-actions">
    <button
      type="button"
      className="connections-button connections-button--facebook"
      onClick={failed ? retry : connect}
      disabled={busy || loading}
    >
      {busy || loading
        ? <LoaderCircle size={16} className="spin"/>
        : failed
          ? <RotateCw size={16}/>
          : <Facebook size={16}/>} {' '}
      {busy ? 'Подключаем WABA…' : loading ? 'Загружаем Facebook…' : failed ? 'Повторить загрузку' : 'Подключить через Facebook'}
    </button>
    {message && <small className="meta-oauth-message">{failed && <AlertCircle size={14}/>} {message}</small>}
  </div>;
}
