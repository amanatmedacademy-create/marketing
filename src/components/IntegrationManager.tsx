import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Facebook, LoaderCircle, Plug, RefreshCw, Settings, X } from 'lucide-react';
import { useAuth } from './AuthGate';
import { IntegrationCard } from './integrationCards/IntegrationCard';
import type { CardConnectionStatus, CardIntegrationProvider, CardIntegrationSummary } from './integrationCards/types';
import {
  marketingApi,
  type IntegrationConfigResponse,
  type IntegrationCredentialSummary,
  type IntegrationProvider,
  type IntegrationRun,
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
  description: string;
  fields: Field[];
};

type MetaOAuthStartResponse = {
  ok?: boolean;
  authorizationUrl?: string;
  redirectUri?: string;
  error?: string;
};

const supported: ProviderDefinition[] = [
  {
    provider: 'meta',
    title: 'Meta Ads',
    description: 'Facebook и Instagram: кабинеты, кампании, расходы и лиды.',
    fields: [
      { name: 'accessToken', label: 'Access token', placeholder: 'Долгоживущий токен Meta', secret: true },
      { name: 'adAccountIds', label: 'ID рекламных кабинетов', placeholder: '123456789,987654321' },
      { name: 'graphVersion', label: 'Graph API version', placeholder: 'v23.0' },
    ],
  },
  {
    provider: 'tiktok',
    title: 'TikTok Ads',
    description: 'Кампании, расходы, объявления и лиды TikTok.',
    fields: [
      { name: 'accessToken', label: 'Access token', placeholder: 'TikTok Business API token', secret: true, required: true },
      { name: 'advertiserIds', label: 'Advertiser IDs', placeholder: '123456789,987654321', required: true },
    ],
  },
  {
    provider: 'bitrix',
    title: 'Bitrix24',
    description: 'Лиды, сделки, стадии, визиты и продажи из CRM.',
    fields: [
      { name: 'webhookBaseUrl', label: 'Входящий webhook URL', placeholder: 'https://portal.bitrix24.kz/rest/1/token', required: true },
      { name: 'outboundToken', label: 'Токен исходящего webhook', placeholder: 'Секрет проверки событий', secret: true },
    ],
  },
  {
    provider: 'n8n',
    title: 'n8n',
    description: 'Webhooks, сценарии и резервный импорт данных.',
    fields: [
      { name: 'webhookSecret', label: 'Webhook secret', placeholder: 'Минимум 32 случайных символа', secret: true, required: true },
    ],
  },
];

const planned: Array<{ id: CardIntegrationProvider; title: string; description: string }> = [
  { id: 'waba', title: 'WhatsApp Business API', description: 'Прямое подключение WABA через Meta Cloud API.' },
  { id: 'wazzup', title: 'Wazzup', description: 'WhatsApp и Instagram с историей сообщений.' },
  { id: 'binotel', title: 'Binotel', description: 'Телефония, записи разговоров и пропущенные звонки.' },
  { id: 'sipuni', title: 'Sipuni', description: 'Виртуальная АТС и аналитика звонков.' },
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

function cardStatus(config?: IntegrationCredentialSummary, run?: IntegrationRun): CardConnectionStatus {
  if (run?.status === 'running') return 'syncing';
  if (config?.lastError || config?.status === 'error' || run?.status === 'failed') return 'error';
  if (isConnected(config)) return 'connected';
  if (config?.configured) return 'disconnected';
  return 'not_connected';
}

function formatDate(value?: string | null): string {
  if (!value) return 'Нет данных';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Нет данных';
  return date.toLocaleString('ru-RU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs = 8000): Promise<T> {
  let timer = 0;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = window.setTimeout(() => reject(new Error('Сервер интеграций не ответил вовремя')), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) window.clearTimeout(timer);
  }
}

export default function IntegrationManager() {
  const { user } = useAuth();
  const isAdmin = user.role === 'administrator';
  const [status, setStatus] = useState<IntegrationStatus | null>(null);
  const [configs, setConfigs] = useState<IntegrationConfigResponse>({ providers: [] });
  const [forms, setForms] = useState<FormState>(emptyForms);
  const [editor, setEditor] = useState<ProviderDefinition | null>(null);
  const [activeCard, setActiveCard] = useState<CardIntegrationProvider | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: 'ok' | 'error'; text: string } | null>(null);

  const configMap = useMemo(() => new Map(configs.providers.map((item) => [item.provider, item])), [configs.providers]);
  const runMap = useMemo(() => {
    const map = new Map<IntegrationProvider, IntegrationRun>();
    for (const run of status?.runs || []) {
      if (['meta', 'tiktok', 'bitrix', 'n8n'].includes(run.source) && !map.has(run.source as IntegrationProvider)) {
        map.set(run.source as IntegrationProvider, run);
      }
    }
    return map;
  }, [status?.runs]);

  const cards = useMemo<CardIntegrationSummary[]>(() => supported.map((definition) => {
    const config = configMap.get(definition.provider);
    const run = runMap.get(definition.provider);
    return {
      id: definition.provider,
      name: definition.title,
      description: definition.description,
      status: cardStatus(config, run),
      lastSyncedAt: run?.finished_at || run?.started_at || config?.lastVerifiedAt || null,
      stats: [
        { label: 'Последняя синхронизация', value: formatDate(run?.finished_at || run?.started_at || config?.lastVerifiedAt) },
        { label: 'Получено', value: String(run?.fetched ?? 0), tone: run?.status === 'failed' ? 'negative' : 'neutral' },
        { label: 'Записано', value: String(run?.written ?? 0), tone: run?.status === 'success' ? 'positive' : 'neutral' },
      ],
      fields: Object.entries(config?.values || {}).map(([label, value]) => ({ label, value })),
      errorMessage: config?.lastError || run?.error || undefined,
    };
  }), [configMap, runMap]);

  const connectedCount = cards.filter((item) => item.status === 'connected' || item.status === 'syncing').length;

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

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const result = params.get('meta');
    if (!result) return;

    const accounts = params.get('accounts') || '0';
    const oauthMessage = params.get('message') || 'Неизвестная ошибка Meta OAuth';
    const cleanUrl = new URL(window.location.href);
    cleanUrl.searchParams.delete('meta');
    cleanUrl.searchParams.delete('accounts');
    cleanUrl.searchParams.delete('message');
    window.history.replaceState({}, '', `${cleanUrl.pathname}${cleanUrl.search}${cleanUrl.hash}`);

    if (result === 'connected') {
      setMessage({ type: 'ok', text: `Meta Ads подключена. Доступно рекламных кабинетов: ${accounts}.` });
      setEditor(null);
      void load();
    } else {
      setMessage({ type: 'error', text: `Meta OAuth: ${oauthMessage}` });
    }
  }, [load]);

  const updateField = (provider: IntegrationProvider, name: string, value: string) => {
    setForms((previous) => ({ ...previous, [provider]: { ...previous[provider], [name]: value } }));
  };

  const openEditor = (provider: IntegrationProvider) => {
    const definition = supported.find((item) => item.provider === provider);
    if (definition) setEditor(definition);
  };

  const startMetaOAuth = async () => {
    setBusy('oauth:meta');
    setMessage(null);
    try {
      const response = await fetch('/api/integrations/meta/start', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
      const body = await response.text();
      let result: MetaOAuthStartResponse = {};
      try {
        result = body ? JSON.parse(body) as MetaOAuthStartResponse : {};
      } catch {
        throw new Error(body || `Meta OAuth start failed: ${response.status}`);
      }
      if (!response.ok || !result.authorizationUrl) {
        throw new Error(result.error || `Meta OAuth start failed: ${response.status}`);
      }
      window.location.assign(result.authorizationUrl);
    } catch (error) {
      setMessage({ type: 'error', text: `Meta OAuth: ${errorText(error)}` });
      setBusy(null);
    }
  };

  const save = async (definition: ProviderDefinition) => {
    const current = configMap.get(definition.provider);
    const values = forms[definition.provider];
    const missing = definition.fields.filter((field) => field.required && !values[field.name] && !current?.secretFields[field.name]);
    if (missing.length) {
      setMessage({ type: 'error', text: `Заполните: ${missing.map((field) => field.label).join(', ')}` });
      return;
    }

    if (definition.provider === 'meta' && !values.accessToken && !current?.secretFields.accessToken) {
      setMessage({ type: 'error', text: 'Для Meta используйте вход через Facebook или укажите резервный access token.' });
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
        <span>INTEGRATIONS</span>
        <h1>Интеграции</h1>
        <p>Подключения рекламных кабинетов, CRM, автоматизации и коммуникаций.</p>
      </div>
      <button type="button" onClick={() => void load()} disabled={loading || Boolean(busy)}>
        {loading ? <LoaderCircle className="spin" size={16}/> : <RefreshCw size={16}/>} Обновить
      </button>
    </header>

    <section className="iv2-summary">
      <article><CheckCircle2 size={22}/><div><span>Подключено</span><strong>{connectedCount} из {cards.length}</strong></div></article>
      <article><Plug size={22}/><div><span>API</span><strong>{message?.type === 'error' ? 'Ошибка' : loading ? 'Проверка' : 'Работает'}</strong></div></article>
      <article><Settings size={22}/><div><span>Архитектура</span><strong>React без DOM-мутаций</strong></div></article>
    </section>

    {message && <div className={`iv2-message iv2-message--${message.type}`}>{message.text}</div>}

    <section className="iv2-section">
      <div className="iv2-section-head"><div><h2>Доступные подключения</h2><p>Карточки показывают реальные статусы и последние результаты синхронизации.</p></div></div>
      <div className="iv2-grid">
        {cards.map((card) => <IntegrationCard
          key={card.id}
          integration={card}
          active={activeCard === card.id}
          onSelect={() => setActiveCard(card.id)}
          onConfigure={() => openEditor(card.id as IntegrationProvider)}
        />)}
      </div>
    </section>

    <section className="iv2-section">
      <div className="iv2-section-head"><div><h2>Следующий этап</h2><p>Коммуникационные сервисы подключим после проверки основных источников.</p></div></div>
      <div className="iv2-grid">
        {planned.map((item) => <IntegrationCard
          key={item.id}
          integration={{ id: item.id, name: item.title, description: item.description, status: 'not_connected', lastSyncedAt: null, stats: [], fields: [] }}
          active={activeCard === item.id}
          disabled
          onSelect={() => setActiveCard(item.id)}
          onConfigure={() => undefined}
        />)}
      </div>
    </section>

    {editor && <div className="iv2-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setEditor(null); }}>
      <section className="iv2-modal" role="dialog" aria-modal="true" aria-label={`Настройка ${editor.title}`}>
        <header><div><div><h2>{editor.title}</h2><p>{editor.description}</p></div></div><button type="button" onClick={() => setEditor(null)} aria-label="Закрыть"><X size={20}/></button></header>

        {editor.provider === 'meta' && <div className="iv2-oauth">
          <div><strong>Рекомендуемый способ</strong><span>Войдите через Facebook. Токен и доступные рекламные кабинеты сохранятся автоматически.</span></div>
          <button className="iv2-facebook" type="button" onClick={() => void startMetaOAuth()} disabled={Boolean(busy)}>
            {busy === 'oauth:meta' ? <LoaderCircle className="spin" size={17}/> : <Facebook size={17}/>} Войти через Facebook
          </button>
        </div>}

        <div className="iv2-form">
          {editor.provider === 'meta' && <div className="iv2-form-title"><strong>Резервное ручное подключение</strong><span>Используйте только если OAuth недоступен.</span></div>}
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
