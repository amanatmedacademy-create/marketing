import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Cable, CheckCircle2, LoaderCircle, RefreshCw } from 'lucide-react';
import { marketingApi, type IntegrationStatus } from '../services/api';
import '../integration-catalog.css';

const providers = [
  { id: 'meta', title: 'Meta Ads', description: 'Facebook и Instagram: рекламные кабинеты, кампании и Lead Ads.' },
  { id: 'tiktok', title: 'TikTok Ads', description: 'Кампании, расходы, объявления и лиды TikTok.' },
  { id: 'bitrix', title: 'Bitrix24', description: 'Лиды, сделки, стадии и продажи из CRM.' },
  { id: 'n8n', title: 'n8n', description: 'Webhooks, сценарии и резервный импорт данных.' },
  { id: 'waba', title: 'WhatsApp Business API', description: 'Прямое подключение WABA через Meta Cloud API.' },
  { id: 'wazzup', title: 'Wazzup', description: 'WhatsApp и Instagram с историей сообщений.' },
  { id: 'binotel', title: 'Binotel', description: 'Телефония, записи разговоров и пропущенные звонки.' },
  { id: 'sipuni', title: 'Sipuni', description: 'Виртуальная АТС и аналитика звонков.' },
] as const;

type ProviderId = typeof providers[number]['id'];

function configured(status: IntegrationStatus | null, id: ProviderId): boolean {
  const flags = status?.configured;
  if (!flags) return false;
  if (id === 'meta') return Boolean(flags.meta);
  if (id === 'tiktok') return Boolean(flags.tiktok);
  if (id === 'bitrix') return Boolean(flags.bitrix);
  if (id === 'n8n') return Boolean(flags.n8n);
  return false;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs = 5000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error('Сервер интеграций не ответил за 5 секунд')), timeoutMs);
    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export default function IntegrationManager() {
  const [status, setStatus] = useState<IntegrationStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await withTimeout(marketingApi.integrationStatus());
      setStatus({
        ...result,
        configured: result?.configured || {
          supabase: false,
          bitrix: false,
          bitrixWebhook: false,
          meta: false,
          metaWebhook: false,
          tiktok: false,
          tiktokWebhook: false,
          n8n: false,
          manualSync: false,
        },
        runs: Array.isArray(result?.runs) ? result.runs : [],
      });
    } catch (reason) {
      setStatus(null);
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const connectedCount = providers.filter((provider) => configured(status, provider.id)).length;

  return <div className="stack connections-page">
    <header className="connections-hero">
      <div>
        <span className="connections-eyebrow">INTEGRATIONS</span>
        <h1>Интеграции</h1>
        <p>Безопасный режим. Статусы загружаются без запуска внешних SDK и тяжёлого журнала.</p>
      </div>
      <div className="connections-hero__actions">
        <button className="connections-button connections-button--ghost" type="button" onClick={() => void load()} disabled={loading}>
          {loading ? <LoaderCircle className="spin" size={16}/> : <RefreshCw size={16}/>} Обновить
        </button>
      </div>
    </header>

    <section className="connections-summary">
      <article>
        <div className="connections-summary__icon connections-summary__icon--green"><CheckCircle2 size={19}/></div>
        <div><span>Подключено</span><strong>{connectedCount} из {providers.length}</strong></div>
      </article>
      <article>
        <div className={`connections-summary__icon ${error ? 'connections-summary__icon--amber' : 'connections-summary__icon--green'}`}>
          {error ? <AlertTriangle size={19}/> : <Cable size={19}/>} 
        </div>
        <div><span>API</span><strong>{loading ? 'Проверяем' : error ? 'Недоступен' : 'Работает'}</strong></div>
      </article>
    </section>

    {error && <div className="connections-alert connections-alert--error">
      <AlertTriangle size={18}/><span>{error}. Каталог остаётся доступным.</span>
    </div>}

    <section className="integration-catalog-section">
      <div className="connections-section__head">
        <div><h2>Источники данных</h2><p>Подключения будут включаться по одному после проверки стабильности.</p></div>
      </div>
      <div className="integration-catalog-grid">
        {providers.map((provider) => {
          const isConnected = configured(status, provider.id);
          return <article className={`integration-catalog-card integration-tone-${provider.id} integration-state-${isConnected ? 'connected' : 'disconnected'}`} key={provider.id}>
            <div className="integration-card-top">
              <span className="integration-card-logo">{provider.title.slice(0, 2).toUpperCase()}</span>
              <em>{isConnected ? 'Подключено' : 'Не подключено'}</em>
            </div>
            <strong>{provider.title}</strong>
            <p>{provider.description}</p>
            <button type="button" disabled title="Настройки временно отключены для устранения зависания">
              {isConnected ? 'Подключение активно' : 'Настройка временно отключена'}
            </button>
          </article>;
        })}
      </div>
    </section>
  </div>;
}
