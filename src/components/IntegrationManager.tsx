import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, LoaderCircle, Plug, RefreshCw, Settings, X } from 'lucide-react';
import { useAuth } from './AuthGate';
import {
  marketingApi,
  type IntegrationConfigResponse,
  type IntegrationCredentialSummary,
  type IntegrationProvider,
  type IntegrationStatus,
} from '../services/api';
import '../integrations-v2.css';

type FormState = Record<IntegrationProvider, Record<string, string>>;

type Field = {
  name: string;
  label: string;
  placeholder: string;
  secret?: boolean;
  required?: boolean;
};

type ProviderDefinition = {
  provider: IntegrationProvider;
  title: string;
  mark: string;
  description: string;
  fields: Field[];
};

const supported: ProviderDefinition[] = [
  {
    provider: 'meta',
    title: 'Meta Ads',
    mark: 'ME',
    description: 'Facebook и Instagram: кабинеты, кампании, расходы и лиды.',
    fields: [
      { name: 'accessToken', label: 'Access token', placeholder: 'Долгоживущий токен Meta', secret: true, required: true },
      { name: 'adAccountIds', label: 'ID рекламных кабинетов', placeholder: '123456789,987654321', required: true },
      { name: 'graphVersion', label: 'Graph API version', placeholder: 'v23.0', required: true },
    ],
  },
  {
    provider: 'tiktok',
    title: 'TikTok Ads',
    mark: 'TT',
    description: 'Кампании, расходы, объявления и лиды TikTok.',
    fields: [
      { name: 'accessToken', label: 'Access token', placeholder: 'TikTok Business API token', secret: true, required: true },
      { name: 'advertiserIds', label: 'Advertiser IDs', placeholder: '123456789,987654321', required: true },
    ],
  },
  {
    provider: 'bitrix',
    title: 'Bitrix24',
    mark: '24',
    description: 'Лиды, сделки, стадии, визиты и продажи из CRM.',
    fields: [
      { name: 'webhookBaseUrl', label: 'Входящий webhook URL', placeholder: 'https://portal.bitrix24.kz/rest/1/token', required: true },
      { name: 'outboundToken', label: 'Токен исходящего webhook', placeholder: 'Секрет проверки событий', secret: true },
    ],
  },
  {
    provider: 'n8n',
    title: 'n8n',
    mark: 'N8',
    description: 'Webhooks, сценарии и резервный импорт данных.',
    fields: [
      { name: 'webhookSecret', label: 'Webhook secret', placeholder: 'Минимум 32 случайных символа', secret: true, required: true },
    ],
  },
];

const planned = [
  { title: 'WhatsApp Business API', mark: 'WA', description: 'Прямое подключение WABA через Meta Cloud API.' },
  { title: 'Wazzup', mark: 'WZ', description: 'WhatsApp и Instagram с историей сообщений.' },
  { title: 'Binotel', mark: 'BI', description: 'Телефония, записи разговоров и пропущенные звонки.' },
  { title: 'Sipuni', mark: 'SI', description: 'Виртуальная АТС и аналитика звонков.' },
];

const emptyForms = (): FormState => ({ bitrix: {}, meta: {}, tiktok: {}, n8n: {} });

function errorText(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  try {
    const parsed = JSON.parse(error.message) as { error?: string };
    return parsed.error || error.message;
  } catch {
    return error.message;
  }
}

function isConnected(config?: IntegrationCredentialSummary): boolean {
  return Boolean(config && config.status === 'connected' && !config.lastError);
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs = 8000): Promise<T> {
  return await Promise.race([
    promise,
    new Promise<T>((_, reject) => window.setTimeout(() => reject(new Error('Сервер интеграций не ответил вовремя')), timeoutMs)),
  ]);
}

export default function IntegrationManager() {
  const { user } = useAuth();
  const isAdmin = user.role === 'administrator';
  const [status, setStatus] = useState<IntegrationStatus | null>(null);
  const [configs, setConfigs] = useState<IntegrationConfigResponse>({ providers: [] });
  const [forms, setForms] = useState<FormState>(emptyForms);
  const [editor, setEditor] = useState<ProviderDefinition | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: 'ok' | 'error'; text: string } | null>(null);

  const configMap = useMemo(() => new Map(configs.providers.map((item) => [item.provider, item])), [configs.providers]);
  const connectedCount = supported.filter((item) => isConnected(configMap.get(item.provider))).length;

  const applyConfigs = useCallback((result: IntegrationConfigResponse) => {
    setConfigs(result);
    setForms((previous) => {
      const next = { ...previous } as FormState;
      for (const config of result.providers) next[config.provider] = { ...previous[config.provider], ...config.values };
      return next;
    });
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setMessage(null);
    try {
      const [nextStatus, nextConfigs] = await Promise.all([
        withTimeout(marketingApi.integrationStatus()),
        isAdmin ? withTimeout(marketingApi.integrationConfigs()) : Promise.resolve({ providers: [] }),
      ]);
      setStatus(nextStatus);
      applyConfigs(nextConfigs);
    } catch (error) {
      setMessage({ type: 'error', text: errorText(error) });
    } finally {
      setLoading(false);
    }
  }, [applyConfigs, isAdmin]);

  useEffect(() => {
    void load();
  }, [load]);

  const updateField = (provider: IntegrationProvider, name: string, value: string) => {
    setForms((previous) => ({ ...previous, [provider]: { ...previous[provider], [name]: value } }));
  };

  const save = async (definition: ProviderDefinition) => {
    const current = configMap.get(definition.provider);
    const values = forms[definition.provider];
    const missing = definition.fields.filter((field) => field.required && !values[field.name] && !current?.secretFields[field.name]);
    if (missing.length) {
      setMessage({ type: 'error', text: `Заполните: ${missing.map((field) => field.label).join(', ')}` });
      return;
    }

    setBusy(`save:${definition.provider}`);
    setMessage(null);
    try {
      await withTimeout(marketingApi.saveIntegrationConfig(definition.provider, values), 15000);
      await withTimeout(marketingApi.testIntegration(definition.provider), 20000);
      const [nextStatus, nextConfigs] = await Promise.all([
        marketingApi.integrationStatus(),
        marketingApi.integrationConfigs(),
      ]);
      setStatus(nextStatus);
      applyConfigs(nextConfigs);
      setForms((previous) => ({
        ...previous,
        [definition.provider]: {
          ...previous[definition.provider],
          ...Object.fromEntries(definition.fields.filter((field) => field.secret).map((field) => [field.name, ''])),
        },
      }));
      setEditor(null);
      setMessage({ type: 'ok', text: `${definition.title}: подключение работает.` });
    } catch (error) {
      setMessage({ type: 'error', text: `${definition.title}: ${errorText(error)}` });
    } finally {
      setBusy(null);
    }
  };

  const disconnect = async (definition: ProviderDefinition) => {
    if (!window.confirm(`Отключить ${definition.title}?`)) return;
    setBusy(`delete:${definition.provider}`);
    try {
      await marketingApi.deleteIntegrationConfig(definition.provider);
      setForms((previous) => ({ ...previous, [definition.provider]: {} }));
      setEditor(null);
      await load();
    } catch (error) {
      setMessage({ type: 'error', text: errorText(error) });
    } finally {
      setBusy(null);
    }
  };

  if (!isAdmin) {
    return <section className="iv2-denied"><AlertTriangle size={28}/><h1>Недостаточно прав</h1><p>Настройка интеграций доступна только администратору.</p></section>;
  }

  return <div className="iv2-page">
    <header className="iv2-header">
      <div>
        <span>INTEGRATIONS V2</span>
        <h1>Интеграции</h1>
        <p>Новый модуль без MutationObserver, portals и ручного изменения DOM.</p>
      </div>
      <button type="button" onClick={() => void load()} disabled={loading || Boolean(busy)}>
        {loading ? <LoaderCircle className="spin" size={16}/> : <RefreshCw size={16}/>} Обновить
      </button>
    </header>

    <section className="iv2-summary">
      <article><CheckCircle2 size={22}/><div><span>Подключено</span><strong>{connectedCount} из {supported.length}</strong></div></article>
      <article><Plug size={22}/><div><span>API</span><strong>{message?.type === 'error' ? 'Ошибка' : loading ? 'Проверка' : 'Работает'}</strong></div></article>
      <article><Settings size={22}/><div><span>Режим</span><strong>Чистый React</strong></div></article>
    </section>

    {message && <div className={`iv2-message iv2-message--${message.type}`}>{message.text}</div>}

    <section className="iv2-section">
      <div className="iv2-section-head"><div><h2>Доступные подключения</h2><p>Настройки открываются в обычном React-окне.</p></div></div>
      <div className="iv2-grid">
        {supported.map((definition) => {
          const config = configMap.get(definition.provider);
          const connected = isConnected(config);
          return <article className="iv2-card" key={definition.provider}>
            <div className="iv2-card-top"><span className="iv2-mark">{definition.mark}</span><em className={connected ? 'is-connected' : ''}>{connected ? 'Подключено' : config ? 'Нужна проверка' : 'Не подключено'}</em></div>
            <h3>{definition.title}</h3>
            <p>{definition.description}</p>
            {config?.lastError && <small>{config.lastError}</small>}
            <button type="button" onClick={() => setEditor(definition)} disabled={Boolean(busy)}>{connected ? 'Управление' : 'Настроить'}</button>
          </article>;
        })}
      </div>
    </section>

    <section className="iv2-section">
      <div className="iv2-section-head"><div><h2>Следующий этап</h2><p>Эти сервисы будут добавлены после стабилизации четырёх основных подключений.</p></div></div>
      <div className="iv2-grid iv2-grid--planned">
        {planned.map((item) => <article className="iv2-card iv2-card--planned" key={item.title}>
          <div className="iv2-card-top"><span className="iv2-mark">{item.mark}</span><em>В разработке</em></div>
          <h3>{item.title}</h3><p>{item.description}</p><button type="button" disabled>Скоро</button>
        </article>)}
      </div>
    </section>

    {editor && <div className="iv2-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setEditor(null); }}>
      <section className="iv2-modal" role="dialog" aria-modal="true" aria-label={`Настройка ${editor.title}`}>
        <header><div><span>{editor.mark}</span><div><h2>{editor.title}</h2><p>{editor.description}</p></div></div><button type="button" onClick={() => setEditor(null)} aria-label="Закрыть"><X size={20}/></button></header>
        <div className="iv2-form">
          {editor.fields.map((field) => {
            const config = configMap.get(editor.provider);
            const savedSecret = field.secret && config?.secretFields[field.name];
            return <label key={field.name}><span>{field.label}{field.required ? ' *' : ''}</span><input type={field.secret ? 'password' : 'text'} value={forms[editor.provider][field.name] || ''} onChange={(event) => updateField(editor.provider, field.name, event.target.value)} placeholder={savedSecret ? 'Секрет уже сохранён. Оставьте пустым, чтобы не менять.' : field.placeholder}/></label>;
          })}
        </div>
        <footer>
          {configMap.get(editor.provider) && <button className="iv2-danger" type="button" onClick={() => void disconnect(editor)} disabled={Boolean(busy)}>Отключить</button>}
          <div><button type="button" onClick={() => setEditor(null)}>Отмена</button><button className="iv2-primary" type="button" onClick={() => void save(editor)} disabled={Boolean(busy)}>{busy === `save:${editor.provider}` ? <LoaderCircle className="spin" size={16}/> : null} Сохранить и проверить</button></div>
        </footer>
      </section>
    </div>}
  </div>;
}
