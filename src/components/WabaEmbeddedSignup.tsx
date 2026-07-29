import { useEffect, useState } from 'react';
import { Facebook, LoaderCircle } from 'lucide-react';

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
  if (target.FB) return target.FB;
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error('Facebook SDK не загрузился')), 15000);
    const previous = target.fbAsyncInit;
    target.fbAsyncInit = () => {
      previous?.();
      if (!target.FB) return reject(new Error('Facebook SDK недоступен'));
      target.FB.init({ appId: config.appId as string, cookie: true, xfbml: false, version: config.version as string });
      window.clearTimeout(timeout);
      resolve(target.FB);
    };
    if (!document.getElementById('facebook-jssdk')) {
      const script = document.createElement('script');
      script.id = 'facebook-jssdk';
      script.async = true;
      script.defer = true;
      script.crossOrigin = 'anonymous';
      script.src = 'https://connect.facebook.net/ru_RU/sdk.js';
      script.onerror = () => reject(new Error('Не удалось загрузить Facebook SDK'));
      document.head.appendChild(script);
    }
  });
}

export default function WabaEmbeddedSignup() {
  const [sdk, setSdk] = useState<FacebookSdk | null>(null);
  const [config, setConfig] = useState<WabaConfig | null>(null);
  const [signup, setSignup] = useState<SignupData>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
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
    fetch('/api/integrations/waba/config')
      .then(async (response) => {
        const body = await response.text();
        const value = body ? JSON.parse(body) as WabaConfig : {};
        if (!response.ok || !value.configured) throw new Error(value.error || 'WABA Embedded Signup не настроен');
        setConfig(value);
        const loaded = await loadSdk(value);
        if (active) setSdk(loaded);
      })
      .catch((error) => active && setMessage(error instanceof Error ? error.message : String(error)));
    return () => { active = false; window.removeEventListener('message', receive); };
  }, []);

  const connect = () => {
    if (!sdk || !config?.configId) return setMessage('Facebook Embedded Signup ещё загружается');
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

  return <div className="waba-signup-actions">
    <button type="button" className="connections-button connections-button--facebook" onClick={connect} disabled={busy || !sdk}>
      {busy || !sdk ? <LoaderCircle size={16} className="spin"/> : <Facebook size={16}/>} {busy ? 'Подключаем WABA…' : sdk ? 'Подключить через Facebook' : 'Загружаем Facebook'}
    </button>
    {message && <small className="meta-oauth-message">{message}</small>}
  </div>;
}
