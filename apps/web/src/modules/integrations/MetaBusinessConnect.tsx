import { useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, Facebook, LoaderCircle, Megaphone, MessageCircle, RefreshCw, Unplug } from 'lucide-react';
import { apiFetch } from '../../lib/api-client';
import { useActionFeedback } from '../system/ActionFeedback';

type MetaProduct = 'waba' | 'ads';
type MetaConfig = {
  appId: string | null;
  graphVersion: string;
  configurations: { waba: string | null; ads: string | null };
  configured: { app: boolean; waba: boolean; ads: boolean };
};

type MetaConnection = {
  product: MetaProduct;
  status: string;
  meta_user_id: string | null;
  meta_user_name: string | null;
  business_id: string | null;
  waba_id: string | null;
  phone_number_id: string | null;
  ad_accounts: Array<{ id: string; name?: string; currency?: string }> | null;
  connected_at: string;
  updated_at: string;
};

type EmbeddedSignupData = {
  wabaId?: string;
  phoneNumberId?: string;
  businessId?: string;
};

type FacebookLoginResponse = {
  authResponse?: { code?: string };
  status?: string;
};

type FacebookSdk = {
  init(options: { appId: string; cookie: boolean; xfbml: boolean; version: string }): void;
  login(callback: (response: FacebookLoginResponse) => void, options: Record<string, unknown>): void;
};

declare global {
  interface Window {
    FB?: FacebookSdk;
    fbAsyncInit?: () => void;
  }
}

let sdkPromise: Promise<FacebookSdk> | null = null;

function loadFacebookSdk(config: MetaConfig) {
  if (window.FB) return Promise.resolve(window.FB);
  if (sdkPromise) return sdkPromise;
  if (!config.appId) return Promise.reject(new Error('META_APP_ID не настроен'));

  sdkPromise = new Promise<FacebookSdk>((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error('Meta SDK не загрузился')), 15000);
    window.fbAsyncInit = () => {
      if (!window.FB) return reject(new Error('Meta SDK недоступен'));
      window.clearTimeout(timeout);
      window.FB.init({ appId: config.appId!, cookie: true, xfbml: false, version: config.graphVersion });
      resolve(window.FB);
    };

    const existing = document.getElementById('facebook-jssdk');
    if (existing) return;
    const script = document.createElement('script');
    script.id = 'facebook-jssdk';
    script.async = true;
    script.defer = true;
    script.crossOrigin = 'anonymous';
    script.src = 'https://connect.facebook.net/ru_RU/sdk.js';
    script.onerror = () => reject(new Error('Не удалось загрузить Meta SDK'));
    document.head.appendChild(script);
  });

  return sdkPromise;
}

export function MetaBusinessConnect() {
  const feedback = useActionFeedback();
  const [config, setConfig] = useState<MetaConfig | null>(null);
  const [connections, setConnections] = useState<MetaConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState<MetaProduct | null>(null);
  const embeddedData = useRef<EmbeddedSignupData>({});

  const byProduct = useMemo(() => new Map(connections.map(item => [item.product, item])), [connections]);

  async function refresh() {
    setLoading(true);
    try {
      const [publicConfig, current] = await Promise.all([
        fetch('/api/integrations/meta/config', { cache: 'no-store' }).then(async response => {
          if (!response.ok) throw new Error('Не удалось загрузить Meta configuration');
          return response.json() as Promise<MetaConfig>;
        }),
        apiFetch<{ connections: MetaConnection[] }>('/integrations/meta'),
      ]);
      setConfig(publicConfig);
      setConnections(current.connections ?? []);
    } catch (error) {
      feedback.error('Meta integration недоступна', error instanceof Error ? error.message : 'Ошибка загрузки');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void refresh(); }, []);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== 'https://www.facebook.com' && event.origin !== 'https://web.facebook.com') return;
      let payload: unknown = event.data;
      if (typeof payload === 'string') {
        try { payload = JSON.parse(payload); } catch { return; }
      }
      if (!payload || typeof payload !== 'object') return;
      const record = payload as { type?: string; event?: string; data?: Record<string, unknown> };
      if (record.type !== 'WA_EMBEDDED_SIGNUP' || record.event !== 'FINISH') return;
      embeddedData.current = {
        wabaId: typeof record.data?.waba_id === 'string' ? record.data.waba_id : undefined,
        phoneNumberId: typeof record.data?.phone_number_id === 'string' ? record.data.phone_number_id : undefined,
        businessId: typeof record.data?.business_id === 'string' ? record.data.business_id : undefined,
      };
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  async function connect(product: MetaProduct) {
    if (!config) return;
    const configId = config.configurations[product];
    if (!config.configured.app || !configId) {
      feedback.error('Meta configuration не готова', product === 'waba' ? 'Проверьте META_WABA_CONFIG_ID.' : 'Проверьте META_ADS_CONFIG_ID.');
      return;
    }

    setConnecting(product);
    embeddedData.current = {};
    try {
      const sdk = await loadFacebookSdk(config);
      const response = await new Promise<FacebookLoginResponse>((resolve) => {
        const options: Record<string, unknown> = {
          config_id: configId,
          response_type: 'code',
          override_default_response_type: true,
        };
        if (product === 'waba') {
          options.extras = { feature: 'whatsapp_embedded_signup', sessionInfoVersion: '3' };
        }
        sdk.login(resolve, options);
      });

      const code = response.authResponse?.code;
      if (!code) throw new Error(response.status === 'not_authorized' ? 'Доступ к Meta не предоставлен' : 'Meta не вернула authorization code');

      const result = await apiFetch<{ connection: { product: MetaProduct; adAccounts?: unknown[] } }>('/integrations/meta/exchange', {
        method: 'POST',
        body: JSON.stringify({ code, product, ...embeddedData.current }),
      });
      feedback.success(product === 'waba' ? 'WhatsApp Business подключён' : 'Meta Ads подключён', product === 'ads' ? `Получено рекламных кабинетов: ${result.connection.adAccounts?.length ?? 0}` : 'WABA сохранён для текущей компании.');
      await refresh();
    } catch (error) {
      feedback.error('Подключение Meta не завершено', error instanceof Error ? error.message : 'Неизвестная ошибка');
    } finally {
      setConnecting(null);
    }
  }

  async function disconnect(product: MetaProduct) {
    const accepted = await feedback.confirm({
      title: product === 'waba' ? 'Отключить WhatsApp Business?' : 'Отключить Meta Ads?',
      message: 'Подключение и сохранённый токен будут удалены. CRM-данные останутся.',
      confirmLabel: 'Отключить',
      destructive: true,
    });
    if (!accepted) return;
    try {
      await apiFetch(`/integrations/meta/${product}`, { method: 'DELETE' });
      feedback.info('Meta-подключение удалено', 'Повторное подключение потребует входа через Facebook.');
      await refresh();
    } catch (error) {
      feedback.error('Не удалось отключить Meta', error instanceof Error ? error.message : 'Ошибка отключения');
    }
  }

  const cards: Array<{ product: MetaProduct; title: string; description: string; icon: typeof Facebook }> = [
    { product: 'waba', title: 'WhatsApp Business', description: 'Embedded Signup, WABA, номер телефона, шаблоны и сообщения.', icon: MessageCircle },
    { product: 'ads', title: 'Meta Ads', description: 'Рекламные кабинеты, кампании, расходы, лиды и управление рекламой.', icon: Megaphone },
  ];

  return <section className="meta-business-connect">
    <header className="meta-business-head">
      <div className="meta-business-icon"><Facebook size={21} /></div>
      <div><span>Facebook Login for Business</span><h1>Meta Business</h1><p>Две независимые конфигурации: WhatsApp Business и управление рекламными кабинетами.</p></div>
      <button disabled={loading} onClick={() => void refresh()}>{loading ? <LoaderCircle className="auth-spinner" size={15} /> : <RefreshCw size={15} />} Обновить</button>
    </header>

    <div className="meta-business-grid">{cards.map(({ product, title, description, icon: Icon }) => {
      const connection = byProduct.get(product);
      const ready = Boolean(config?.configured.app && config?.configured[product]);
      const busy = connecting === product;
      return <article className="meta-business-card" key={product}>
        <div className="meta-business-card-top"><span><Icon size={20} /></span><em className={connection ? 'connected' : ready ? 'ready' : 'error'}>{connection ? 'Подключено' : ready ? 'Готово к входу' : 'Нет конфигурации'}</em></div>
        <h2>{title}</h2><p>{description}</p>
        {connection ? <div className="meta-business-details">
          <span><CheckCircle2 size={14} /> {connection.meta_user_name || connection.meta_user_id || 'Meta user'}</span>
          {product === 'waba' && <small>WABA: {connection.waba_id || 'не получен'} · Phone ID: {connection.phone_number_id || 'не получен'}</small>}
          {product === 'ads' && <small>Рекламных кабинетов: {connection.ad_accounts?.length ?? 0}</small>}
        </div> : <div className="meta-business-details"><small>{ready ? 'Нажмите кнопку и выберите бизнес-активы в окне Meta.' : 'Проверьте Cloudflare secrets для этой конфигурации.'}</small></div>}
        <footer>{connection
          ? <button className="danger" onClick={() => void disconnect(product)}><Unplug size={15} /> Отключить</button>
          : <button disabled={!ready || busy} onClick={() => void connect(product)}>{busy ? <LoaderCircle className="auth-spinner" size={15} /> : <Facebook size={15} />} {busy ? 'Подключение…' : 'Войти через Facebook'}</button>}
        </footer>
      </article>;
    })}</div>
  </section>;
}
