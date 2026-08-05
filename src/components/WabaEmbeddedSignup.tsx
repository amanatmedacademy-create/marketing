import { useState } from 'react';
import { AlertCircle, Facebook, LoaderCircle, RotateCw } from 'lucide-react';

type FacebookLoginResponse = { status?: string; authResponse?: { code?: string } };
type FacebookSdk = {
  init(options: { appId: string; cookie: boolean; xfbml: boolean; version: string }): void;
  login(callback: (response: FacebookLoginResponse) => void, options: Record<string, unknown>): void;
};
type FacebookWindow = Window & typeof globalThis & { FB?: FacebookSdk; fbAsyncInit?: () => void };
type WabaConfig = { configured?: boolean; appId?: string; version?: string; configId?: string; error?: string };
type SignupData = { wabaId?: string; phoneNumberId?: string };

async function loadSdk(config: WabaConfig): Promise<FacebookSdk> {
  if (!config.appId || !config.version) throw new Error('Facebook App для WABA не настроен');
  const target = window as FacebookWindow;

  const initialize = (): FacebookSdk => {
    if (!target.FB) throw new Error('Facebook SDK недоступен');
    target.FB.init({ appId: config.appId as string, cookie: true, xfbml: false, version: config.version as string });
    return target.FB;
  };

  if (target.FB) return initialize();

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      callback();
    };
    const timeout = window.setTimeout(() => finish(() => reject(new Error('Facebook SDK не загрузился за 15 секунд'))), 15000);
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

export default function WabaEmbeddedSignup() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [signup, setSignup] = useState<SignupData>({});

  const connect = async () => {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    setMessage(null);

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
    try {
      const response = await fetch('/api/integrations/waba/config', { headers: { accept: 'application/json' } });
      const body = await response.text();
      let config: WabaConfig = {};
      try { config = body ? JSON.parse(body) as WabaConfig : {}; } catch { throw new Error(`Некорректный ответ конфигурации WABA: HTTP ${response.status}`); }
      if (!response.ok || !config.configured || !config.configId) throw new Error(config.error || 'WABA Embedded Signup не настроен');

      const sdk = await loadSdk(config);
      sdk.login((loginResponse) => {
        const code = loginResponse.authResponse?.code;
        if (!code) {
          setBusy(false);
          setMessage('Подключение WhatsApp Business не завершено');
          window.removeEventListener('message', receive);
          return;
        }

        fetch('/api/integrations/waba/connect', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ code, wabaId: signup.wabaId, phoneNumberId: signup.phoneNumberId }),
        })
          .then(async (result) => {
            const resultBody = await result.text();
            if (!result.ok) throw new Error(resultBody ? (JSON.parse(resultBody).error || resultBody) : `HTTP ${result.status}`);
            const value = JSON.parse(resultBody) as { phoneNumberId?: string };
            setMessage(`WABA подключена${value.phoneNumberId ? ` · номер ${value.phoneNumberId}` : ''}`);
          })
          .catch((error) => {
            setFailed(true);
            setMessage(error instanceof Error ? error.message : String(error));
          })
          .finally(() => {
            setBusy(false);
            window.removeEventListener('message', receive);
          });
      }, {
        config_id: config.configId,
        response_type: 'code',
        override_default_response_type: true,
        extras: { setup: {} },
      });
    } catch (error) {
      setFailed(true);
      setMessage(error instanceof Error ? error.message : String(error));
      setBusy(false);
      window.removeEventListener('message', receive);
    }
  };

  return <div className="waba-signup-actions">
    <button type="button" className="connections-button connections-button--facebook" onClick={() => void connect()} disabled={busy}>
      {busy ? <LoaderCircle size={16} className="spin"/> : failed ? <RotateCw size={16}/> : <Facebook size={16}/>} {' '}
      {busy ? 'Загружаем Facebook…' : failed ? 'Повторить подключение' : 'Подключить через Facebook'}
    </button>
    {message && <small className="meta-oauth-message">{failed && <AlertCircle size={14}/>} {message}</small>}
  </div>;
}
