import { useEffect, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, Facebook, LoaderCircle, RotateCw } from 'lucide-react';

type FacebookLoginResponse = { status?: string; authResponse?: { code?: string } };
type FacebookSdk = {
  init(options: { appId: string; cookie: boolean; xfbml: boolean; version: string }): void;
  login(callback: (response: FacebookLoginResponse) => void, options: Record<string, unknown>): void;
};
type FacebookWindow = Window & typeof globalThis & { FB?: FacebookSdk; fbAsyncInit?: () => void };
type SignupData = { wabaId?: string; phoneNumberId?: string };
type WabaConnection = {
  status?: string;
  values?: SignupData;
  lastVerifiedAt?: string | null;
  lastError?: string | null;
};
type WabaConfig = {
  configured?: boolean;
  appId?: string;
  version?: string;
  configId?: string;
  connected?: boolean;
  connection?: WabaConnection | null;
  error?: string;
};

async function readJson<T>(response: Response): Promise<T> {
  const body = await response.text();
  try {
    return (body ? JSON.parse(body) : {}) as T;
  } catch {
    throw new Error(`Некорректный ответ WABA: HTTP ${response.status}`);
  }
}

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
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [connected, setConnected] = useState(false);
  const [signup, setSignup] = useState<SignupData>({});
  const signupRef = useRef<SignupData>({});
  const codeRef = useRef('');
  const submittingRef = useRef(false);

  useEffect(() => {
    let active = true;
    fetch('/api/integrations/waba/config', { headers: { accept: 'application/json' } })
      .then(async (response) => {
        const config = await readJson<WabaConfig>(response);
        if (!active) return;
        const values = config.connection?.values || {};
        signupRef.current = values;
        setSignup(values);
        setConnected(Boolean(config.connected));
        if (config.connected) {
          setMessage(`WABA подключена${values.phoneNumberId ? ` · номер ${values.phoneNumberId}` : ''}`);
        } else if (!config.configured) {
          setFailed(true);
          setMessage(config.error || 'WABA Embedded Signup не настроен');
        }
      })
      .catch((error) => {
        if (!active) return;
        setFailed(true);
        setMessage(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, []);

  const connect = async () => {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    setMessage(null);
    signupRef.current = {};
    codeRef.current = '';
    submittingRef.current = false;
    setSignup({});

    let missingSessionTimeout: number | undefined;

    const cleanup = () => {
      window.removeEventListener('message', receive);
      if (missingSessionTimeout !== undefined) {
        window.clearTimeout(missingSessionTimeout);
        missingSessionTimeout = undefined;
      }
    };

    const finishConnection = async () => {
      const code = codeRef.current;
      const identifiers = signupRef.current;
      if (!code || !identifiers.wabaId || submittingRef.current) return;

      submittingRef.current = true;
      if (missingSessionTimeout !== undefined) {
        window.clearTimeout(missingSessionTimeout);
        missingSessionTimeout = undefined;
      }
      setMessage(identifiers.phoneNumberId
        ? 'Завершаем подключение WhatsApp Business…'
        : 'WABA получена. Определяем Phone Number ID через Meta…');

      try {
        const result = await fetch('/api/integrations/waba/connect', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            code,
            wabaId: identifiers.wabaId,
            phoneNumberId: identifiers.phoneNumberId,
          }),
        });
        const value = await readJson<{ phoneNumberId?: string; error?: string }>(result);
        if (!result.ok) throw new Error(value.error || `HTTP ${result.status}`);
        const phoneNumberId = value.phoneNumberId || identifiers.phoneNumberId;
        const next = { ...identifiers, phoneNumberId };
        signupRef.current = next;
        setSignup(next);
        setConnected(true);
        setMessage(`WABA подключена${phoneNumberId ? ` · номер ${phoneNumberId}` : ''}`);
      } catch (error) {
        setFailed(true);
        setMessage(error instanceof Error ? error.message : String(error));
      } finally {
        submittingRef.current = false;
        setBusy(false);
        cleanup();
      }
    };

    const scheduleMissingSessionCheck = () => {
      if (missingSessionTimeout !== undefined) window.clearTimeout(missingSessionTimeout);
      missingSessionTimeout = window.setTimeout(() => {
        const identifiers = signupRef.current;
        if (!submittingRef.current && codeRef.current && !identifiers.wabaId) {
          setFailed(true);
          setBusy(false);
          setMessage('Meta завершила авторизацию, но не передала WABA ID. Повторите подключение через Facebook.');
          cleanup();
        }
      }, 15000);
    };

    function receive(event: MessageEvent) {
      if (!event.origin.endsWith('facebook.com')) return;
      try {
        const payload = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
        if (payload?.type !== 'WA_EMBEDDED_SIGNUP') return;
        const data = payload.data || {};
        const wabaId = data.waba_id == null ? '' : String(data.waba_id).trim();
        const phoneNumberId = data.phone_number_id == null ? '' : String(data.phone_number_id).trim();
        if (!wabaId) return;

        const next = { wabaId, ...(phoneNumberId ? { phoneNumberId } : {}) };
        signupRef.current = next;
        setSignup(next);
        if (!codeRef.current) setMessage('Данные WABA получены. Завершаем авторизацию Facebook…');
        void finishConnection();
      } catch { /* unrelated message */ }
    }

    window.addEventListener('message', receive);
    try {
      const response = await fetch('/api/integrations/waba/config', { headers: { accept: 'application/json' } });
      const config = await readJson<WabaConfig>(response);
      if (!response.ok || !config.configured || !config.configId) throw new Error(config.error || 'WABA Embedded Signup не настроен');

      const sdk = await loadSdk(config);
      sdk.login((loginResponse) => {
        const code = loginResponse.authResponse?.code;
        if (!code) {
          setBusy(false);
          setMessage('Подключение WhatsApp Business не завершено');
          cleanup();
          return;
        }

        codeRef.current = code;
        if (!signupRef.current.wabaId) {
          setMessage('Facebook авторизован. Получаем данные WhatsApp Business…');
          scheduleMissingSessionCheck();
        }
        void finishConnection();
      }, {
        config_id: config.configId,
        response_type: 'code',
        override_default_response_type: true,
        extras: {
          setup: {},
          sessionInfoVersion: '3',
        },
      });
    } catch (error) {
      setFailed(true);
      setMessage(error instanceof Error ? error.message : String(error));
      setBusy(false);
      cleanup();
    }
  };

  return <div className="waba-signup-actions">
    <button type="button" className="connections-button connections-button--facebook" onClick={() => void connect()} disabled={busy || loading}>
      {busy || loading ? <LoaderCircle size={16} className="spin"/> : connected ? <CheckCircle2 size={16}/> : failed ? <RotateCw size={16}/> : <Facebook size={16}/>} {' '}
      {loading ? 'Проверяем подключение…' : busy ? 'Загружаем Facebook…' : connected ? 'Переподключить WABA' : failed ? 'Повторить подключение' : 'Подключить через Facebook'}
    </button>
    {message && <small className="meta-oauth-message">{failed && <AlertCircle size={14}/>} {message}</small>}
    {connected && signup.phoneNumberId && <small className="meta-oauth-message">Webhook и сообщения активируются автоматически после подключения.</small>}
  </div>;
}
