import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, Database, Facebook, LoaderCircle, Plug, RefreshCw, Settings, X } from 'lucide-react';
import { useAuth } from './AuthGate';
import { IntegrationCard } from './integrationCards/IntegrationCard';
import { MetaSelectionPanel } from './MetaSelectionPanel';
import WabaEmbeddedSignup from './WabaEmbeddedSignup';
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

type GoogleProvider = 'google_ads' | 'ga4';
type FormState = Record<IntegrationProvider, Record<string, string>>;
type GoogleFormState = Record<GoogleProvider, Record<string, string>>;
type Field = { name: string; label: string; placeholder: string; secret?: boolean; required?: boolean };
type ProviderDefinition = { provider: IntegrationProvider; title: string; description: string; fields: Field[] };
type GoogleProviderDefinition = { provider: GoogleProvider; title: string; description: string; fields: Field[] };
type GoogleConfig = { provider: GoogleProvider; configured: boolean; status: string; values: Record<string, string>; secretFields: Record<string, boolean>; updatedAt?: string | null; lastVerifiedAt?: string | null; lastError?: string | null };
type MetaOAuthStartResponse = { ok?: boolean; authorizationUrl?: string; redirectUri?: string; error?: string };
type WabaSignupData = { wabaId?: string; phoneNumberId?: string };
type WabaConfigResponse = {
  configured?: boolean;
  connected?: boolean;
  connection?: {
    status?: string;
    values?: WabaSignupData;
    lastVerifiedAt?: string | null;
    lastError?: string | null;
  } | null;
  error?: string;
};

type IntegrationManagerProps = {
  children?: ReactNode;
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

const googleSupported: GoogleProviderDefinition[] = [
  {
    provider: 'google_ads',
    title: 'Google Ads',
    description: 'Кампании, расходы, клики, показы, конверсии и conversion value.',
    fields: [
      { name: 'clientId', label: 'OAuth Client ID', placeholder: 'Google OAuth Client ID', required: true },
      { name: 'clientSecret', label: 'OAuth Client Secret', placeholder: 'Обязательное поле', secret: true, required: true },
      { name: 'refreshToken', label: 'Refresh token', placeholder: 'Обязательное поле', secret: true, required: true },
      { name: 'developerToken', label: 'Developer token', placeholder: 'Google Ads developer token', secret: true, required: true },
      { name: 'customerIds', label: 'Customer IDs', placeholder: '1234567890, 9876543210', required: true },
      { name: 'loginCustomerId', label: 'Manager / Login Customer ID', placeholder: 'Необязательно' },
      { name: 'apiVersion', label: 'API version', placeholder: 'v25' },
    ],
  },
  {
    provider: 'ga4',
    title: 'Google Analytics 4',
    description: 'Traffic acquisition, users, sessions, key events и revenue.',
    fields: [
      { name: 'clientId', label: 'OAuth Client ID', placeholder: 'Google OAuth Client ID', required: true },
      { name: 'clientSecret', label: 'OAuth Client Secret', placeholder: 'Обязательное поле', secret: true, required: true },
      { name: 'refreshToken', label: 'Refresh token', placeholder: 'Обязательное поле', secret: true, required: true },
      { name: 'propertyIds', label: 'Property IDs', placeholder: '123456789, 987654321', required: true },
    ],
  },
];

const historyPeriods = [7, 30, 90, 180, 365] as const;
const googlePeriods = [7, 30, 90, 365] as const;
const emptyForms = (): FormState => ({ bitrix: {}, meta: {}, tiktok: {}, n8n: {} });
const emptyGoogleForms = (): GoogleFormState => ({ google_ads: { apiVersion: 'v25' }, ga4: {} });

function errorText(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  try {
    return (JSON.parse(error.message) as { error?: string }).error || error.message;
  } catch {
    return error.message;
  }
}

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...init, headers: { 'content-type': 'application/json', ...init?.headers } });
  const body = await response.text();
  let payload: unknown = {};
  try { payload = body ? JSON.parse(body) : {}; } catch { payload = { error: body }; }
  if (!response.ok) throw new Error((payload as { error?: string }).error || `HTTP ${response.status}`);
  return payload as T;
}

function isConnected(config?: IntegrationCredentialSummary): boolean {
  return Boolean(config && config.status === 'connected' && !config.lastError);
}

function standardCardStatus(config?: IntegrationCredentialSummary, run?: IntegrationRun): CardConnectionStatus {
  if (run?.status === 'running') return 'syncing';
  if (config?.lastError || config?.status === 'error' || run?.status === 'failed') return 'error';
  if (isConnected(config)) return 'connected';
  if (config?.configured) return 'disconnected';
  return 'not_connected';
}

function googleCardStatus(config?: GoogleConfig, run?: IntegrationRun): CardConnectionStatus {
  if (run?.status === 'running') return 'syncing';
  if (config?.lastError || config?.status === 'error' || run?.status === 'failed') return 'error';
  if (config?.status === 'connected') return 'connected';
  if (config?.configured) return 'disconnected';
  return 'not_connected';
}

function formatDate(value?: string | null): string {
  if (!value) return 'Нет данных';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? 'Нет данных'
    : date.toLocaleString('ru-RU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
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

export default function IntegrationManager({ children }: IntegrationManagerProps) {
  const { user } = useAuth();
  const isAdmin = user.role === 'administrator';
  const [status, setStatus] = useState<IntegrationStatus | null>(null);
  const [configs, setConfigs] = useState<IntegrationConfigResponse>({ providers: [] });
  const [googleConfigs, setGoogleConfigs] = useState<GoogleConfig[]>([]);
  const [forms, setForms] = useState<FormState>(emptyForms);
  const [googleForms, setGoogleForms] = useState<GoogleFormState>(emptyGoogleForms);
  const [editor, setEditor] = useState<ProviderDefinition | null>(null);
  const [googleEditor, setGoogleEditor] = useState<GoogleProviderDefinition | null>(null);
  const [wabaEditorOpen, setWabaEditorOpen] = useState(false);
  const [wabaConfig, setWabaConfig] = useState<WabaConfigResponse | null>(null);
  const [activeCard, setActiveCard] = useState<CardIntegrationProvider | null>(null);
  const [historyDays, setHistoryDays] = useState<number>(90);
  const [googleDays, setGoogleDays] = useState<number>(30);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: 'ok' | 'error'; text: string } | null>(null);

  const configMap = useMemo(
    () => new Map(configs.providers.map((item) => [item.provider, item])),
    [configs.providers],
  );
  const googleConfigMap = useMemo(
    () => new Map(googleConfigs.map((item) => [item.provider, item])),
    [googleConfigs],
  );

  const runMap = useMemo(() => {
    const map = new Map<string, IntegrationRun>();
    for (const run of status?.runs || []) {
      if (!map.has(run.source)) map.set(run.source, run);
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
      status: standardCardStatus(config, run),
      lastSyncedAt: run?.finished_at || run?.started_at || config?.lastVerifiedAt || null,
      stats: [
        { label: 'Последняя синхронизация', value: formatDate(run?.finished_at || run?.started_at || config?.lastVerifiedAt) },
        { label: 'Получено', value: String(run?.fetched ?? 0), tone: run?.status === 'failed' ? 'negative' : 'neutral' },
        { label: 'Записано', value: String(run?.written ?? 0), tone: run?.status === 'success' ? 'positive' : 'neutral' },
      ],
      fields: Object.entries(config?.values || {})
        .filter(([label]) => label !== 'selectedAdIds')
        .map(([label, value]) => ({ label, value })),
      errorMessage: config?.lastError || run?.error || undefined,
    };
  }), [configMap, runMap]);

  const googleCards = useMemo<CardIntegrationSummary[]>(() => googleSupported.map((definition) => {
    const config = googleConfigMap.get(definition.provider);
    const run = runMap.get(definition.provider);
    return {
      id: definition.provider,
      name: definition.title,
      description: definition.description,
      status: googleCardStatus(config, run),
      lastSyncedAt: run?.finished_at || run?.started_at || config?.lastVerifiedAt || null,
      stats: [
        { label: 'Последняя синхронизация', value: formatDate(run?.finished_at || run?.started_at || config?.lastVerifiedAt) },
        { label: 'Получено', value: String(run?.fetched ?? 0), tone: run?.status === 'failed' ? 'negative' : 'neutral' },
        { label: 'Записано', value: String(run?.written ?? 0), tone: run?.status === 'success' ? 'positive' : 'neutral' },
      ],
      fields: Object.entries(config?.values || {}).map(([label, value]) => ({ label, value })),
      errorMessage: config?.lastError || run?.error || undefined,
    };
  }), [googleConfigMap, runMap]);

  const wabaCard = useMemo<CardIntegrationSummary>(() => {
    const connection = wabaConfig?.connection;
    const values = connection?.values || {};
    const error = connection?.lastError || (wabaConfig && !wabaConfig.configured ? wabaConfig.error : undefined);
    const connected = Boolean(wabaConfig?.connected);
    return {
      id: 'waba',
      name: 'WhatsApp Business API',
      description: 'Прямое подключение WABA через Meta Cloud API.',
      status: error ? 'error' : connected ? 'connected' : 'not_connected',
      lastSyncedAt: connection?.lastVerifiedAt || null,
      stats: connected ? [
        { label: 'Phone Number ID', value: values.phoneNumberId || 'Подключён' },
        { label: 'Последняя проверка', value: formatDate(connection?.lastVerifiedAt) },
      ] : [],
      fields: [
        ...(values.wabaId ? [{ label: 'WABA ID', value: values.wabaId }] : []),
        ...(values.phoneNumberId ? [{ label: 'Phone Number ID', value: values.phoneNumberId }] : []),
      ],
      errorMessage: error,
    };
  }, [wabaConfig]);

  const availableCards = useMemo(() => [...cards, ...googleCards, wabaCard], [cards, googleCards, wabaCard]);
  const connectedCount = availableCards.filter((item) => item.status === 'connected' || item.status === 'syncing').length;

  const applyConfigs = useCallback((result: IntegrationConfigResponse) => {
    setConfigs(result);
    setForms((previous) => {
      const next = { ...previous } as FormState;
      for (const config of result.providers) next[config.provider] = { ...previous[config.provider], ...config.values };
      return next;
    });
  }, []);

  const applyGoogleConfigs = useCallback((providers: GoogleConfig[]) => {
    setGoogleConfigs(providers);
    setGoogleForms((previous) => {
      const next: GoogleFormState = {
        google_ads: { ...previous.google_ads },
        ga4: { ...previous.ga4 },
      };
      for (const config of providers) next[config.provider] = { ...next[config.provider], ...config.values };
      return next;
    });
  }, []);

  const loadWaba = useCallback(async () => {
    if (!isAdmin) return;
    try {
      const response = await fetch('/api/integrations/waba/config', { headers: { accept: 'application/json' } });
      const body = await response.text();
      let result: WabaConfigResponse = {};
      try { result = body ? JSON.parse(body) as WabaConfigResponse : {}; }
      catch { throw new Error(body || `WABA status failed: ${response.status}`); }
      if (!response.ok && response.status !== 503) throw new Error(result.error || `WABA status failed: ${response.status}`);
      setWabaConfig(result);
    } catch (error) {
      setWabaConfig({ configured: false, connected: false, error: errorText(error) });
    }
  }, [isAdmin]);

  const loadGoogle = useCallback(async () => {
    if (!isAdmin) return;
    try {
      const result = await withTimeout(fetchJson<{ providers: GoogleConfig[] }>('/api/integrations/google/config'));
      applyGoogleConfigs(result.providers || []);
    } catch (error) {
      setMessage({ type: 'error', text: `Google: ${errorText(error)}` });
    }
  }, [applyGoogleConfigs, isAdmin]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [nextStatus, nextConfigs, nextGoogle] = await Promise.all([
        withTimeout(marketingApi.integrationStatus()),
        isAdmin ? withTimeout(marketingApi.integrationConfigs()) : Promise.resolve({ providers: [] }),
        isAdmin ? withTimeout(fetchJson<{ providers: GoogleConfig[] }>('/api/integrations/google/config')) : Promise.resolve({ providers: [] as GoogleConfig[] }),
      ]);
      setStatus(nextStatus);
      applyConfigs(nextConfigs);
      applyGoogleConfigs(nextGoogle.providers || []);
      void loadWaba();
    } catch (error) {
      setMessage({ type: 'error', text: errorText(error) });
    } finally {
      setLoading(false);
    }
  }, [applyConfigs, applyGoogleConfigs, isAdmin, loadWaba]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const result = params.get('meta');
    if (!result) return;
    const accounts = params.get('accounts') || '0';
    const oauthMessage = params.get('message') || 'Неизвестная ошибка Meta OAuth';
    const cleanUrl = new URL(window.location.href);
    ['meta', 'accounts', 'message'].forEach((key) => cleanUrl.searchParams.delete(key));
    window.history.replaceState({}, '', `${cleanUrl.pathname}${cleanUrl.search}${cleanUrl.hash}`);

    if (result === 'connected') {
      setMessage({ type: 'ok', text: `Meta Ads подключена. Доступно кабинетов: ${accounts}. Выберите кабинеты, креативы и период загрузки.` });
      const definition = supported.find((item) => item.provider === 'meta');
      if (definition) setEditor(definition);
      void load();
    } else {
      setMessage({ type: 'error', text: `Meta OAuth: ${oauthMessage}` });
    }
  }, [load]);

  const updateField = (provider: IntegrationProvider, name: string, value: string) => {
    setForms((previous) => ({ ...previous, [provider]: { ...previous[provider], [name]: value } }));
  };

  const updateGoogleField = (provider: GoogleProvider, name: string, value: string) => {
    setGoogleForms((previous) => ({ ...previous, [provider]: { ...previous[provider], [name]: value } }));
  };

  const openEditor = (provider: IntegrationProvider) => {
    const definition = supported.find((item) => item.provider === provider);
    if (definition) setEditor(definition);
  };

  const openGoogleEditor = (provider: GoogleProvider) => {
    const definition = googleSupported.find((item) => item.provider === provider);
    if (definition) setGoogleEditor(definition);
  };

  const closeWabaEditor = () => {
    setWabaEditorOpen(false);
    void loadWaba();
  };

  const startMetaOAuth = async () => {
    setBusy('oauth:meta');
    setMessage(null);
    try {
      const response = await fetch('/api/integrations/meta/start', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
      const body = await response.text();
      let result: MetaOAuthStartResponse = {};
      try { result = body ? JSON.parse(body) as MetaOAuthStartResponse : {}; }
      catch { throw new Error(body || `Meta OAuth start failed: ${response.status}`); }
      if (!response.ok || !result.authorizationUrl) throw new Error(result.error || `Meta OAuth start failed: ${response.status}`);
      window.location.assign(result.authorizationUrl);
    } catch (error) {
      setMessage({ type: 'error', text: `Meta OAuth: ${errorText(error)}` });
      setBusy(null);
    }
  };

  const loadMetaHistory = async () => {
    setBusy('history:meta');
    setMessage(null);
    try {
      const result = await withTimeout(marketingApi.metaBackfill(historyDays), 300000);
      await load();
      setMessage({ type: 'ok', text: `Meta Ads: загружено ${result.fetched}, записано ${result.written}. Кабинетов: ${result.accounts}; режим креативов: ${result.creativeSelectionMode === 'all' ? 'все' : result.selectedCreatives}.` });
    } catch (error) {
      setMessage({ type: 'error', text: `Загрузка истории: ${errorText(error)}` });
    } finally { setBusy(null); }
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
      await withTimeout(marketingApi.testIntegration(definition.provider), 30000);
      const [nextStatus, nextConfigs] = await Promise.all([marketingApi.integrationStatus(), marketingApi.integrationConfigs()]);
      setStatus(nextStatus);
      applyConfigs(nextConfigs);
      setForms((previous) => ({
        ...previous,
        [definition.provider]: {
          ...previous[definition.provider],
          ...Object.fromEntries(definition.fields.filter((field) => field.secret).map((field) => [field.name, ''])),
        },
      }));
      setMessage({ type: 'ok', text: `${definition.title}: подключение работает.` });
    } catch (error) {
      setMessage({ type: 'error', text: `${definition.title}: ${errorText(error)}` });
    } finally { setBusy(null); }
  };

  const saveGoogle = async (definition: GoogleProviderDefinition) => {
    const current = googleConfigMap.get(definition.provider);
    const values = googleForms[definition.provider];
    const missing = definition.fields.filter((field) => field.required && !values[field.name] && !current?.secretFields[field.name]);
    if (missing.length) {
      setMessage({ type: 'error', text: `Заполните: ${missing.map((field) => field.label).join(', ')}` });
      return;
    }
    setBusy(`save:${definition.provider}`);
    setMessage(null);
    try {
      await withTimeout(fetchJson(`/api/integrations/google/config/${definition.provider}`, { method: 'PUT', body: JSON.stringify(values) }), 15000);
      await loadGoogle();
      setGoogleForms((previous) => ({
        ...previous,
        [definition.provider]: {
          ...previous[definition.provider],
          ...Object.fromEntries(definition.fields.filter((field) => field.secret).map((field) => [field.name, ''])),
        },
      }));
      setMessage({ type: 'ok', text: `${definition.title}: настройки сохранены.` });
    } catch (error) {
      setMessage({ type: 'error', text: `${definition.title}: ${errorText(error)}` });
    } finally { setBusy(null); }
  };

  const syncGoogle = async (provider: GoogleProvider) => {
    setBusy(`sync:${provider}`);
    setMessage(null);
    try {
      const result = await withTimeout(fetchJson<{ fetched: number; written: number }>(`/api/integrations/google/sync/${provider}`, { method: 'POST', body: JSON.stringify({ days: googleDays }) }), 300000);
      await load();
      setMessage({ type: 'ok', text: `${provider === 'google_ads' ? 'Google Ads' : 'Google Analytics 4'}: получено ${result.fetched}, записано ${result.written}.` });
    } catch (error) {
      setMessage({ type: 'error', text: `${provider === 'google_ads' ? 'Google Ads' : 'Google Analytics 4'}: ${errorText(error)}` });
    } finally { setBusy(null); }
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
    } finally { setBusy(null); }
  };

  const disconnectGoogle = async (definition: GoogleProviderDefinition) => {
    if (!window.confirm(`Отключить ${definition.title}?`)) return;
    setBusy(`delete:${definition.provider}`);
    try {
      await fetchJson(`/api/integrations/google/config/${definition.provider}`, { method: 'DELETE' });
      setGoogleForms((previous) => ({ ...previous, [definition.provider]: definition.provider === 'google_ads' ? { apiVersion: 'v25' } : {} }));
      setGoogleEditor(null);
      await load();
    } catch (error) {
      setMessage({ type: 'error', text: errorText(error) });
    } finally { setBusy(null); }
  };

  if (!isAdmin) {
    return <section className="iv2-denied">
      <AlertTriangle size={28}/>
      <h1>Недостаточно прав</h1>
      <p>Настройка интеграций доступна только администратору.</p>
    </section>;
  }

  const metaConnected = isConnected(configMap.get('meta'));

  return <div className="iv2-page">
    <header className="iv2-header">
      <div>
        <span>INTEGRATIONS</span>
        <h1>Интеграции</h1>
        <p>Подключения рекламных кабинетов, аналитики, CRM, автоматизации и коммуникаций.</p>
      </div>
      <button type="button" onClick={() => void load()} disabled={loading || Boolean(busy)}>
        {loading ? <LoaderCircle className="spin" size={16}/> : <RefreshCw size={16}/>} Обновить
      </button>
    </header>

    <section className="iv2-summary">
      <article><CheckCircle2 size={22}/><div><span>Подключено</span><strong>{connectedCount} активных</strong></div></article>
      <article><Plug size={22}/><div><span>API</span><strong>{message?.type === 'error' ? 'Ошибка' : loading ? 'Проверка' : 'Работает'}</strong></div></article>
      <article><Settings size={22}/><div><span>Архитектура</span><strong>Единый каталог интеграций</strong></div></article>
    </section>

    {message && <div className={`iv2-message iv2-message--${message.type}`}>{message.text}</div>}

    <section className="iv2-section">
      <div className="iv2-section-head"><div><h2>Доступные подключения</h2><p>Реклама, аналитика, CRM, коммуникации, телефония и клинические системы управляются из одного каталога.</p></div></div>
      <div className="iv2-grid">
        {availableCards.map((card) => <IntegrationCard
          key={card.id}
          integration={card}
          active={activeCard === card.id}
          onSelect={() => setActiveCard(card.id)}
          onConfigure={() => {
            if (card.id === 'waba') { setWabaEditorOpen(true); return; }
            if (card.id === 'google_ads' || card.id === 'ga4') { openGoogleEditor(card.id); return; }
            openEditor(card.id as IntegrationProvider);
          }}
        />)}
        {children}
      </div>
    </section>

    {wabaEditorOpen && <div className="iv2-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeWabaEditor(); }}>
      <section className="iv2-modal" role="dialog" aria-modal="true" aria-label="Настройка WhatsApp Business API">
        <header>
          <div><h2>WhatsApp Business API</h2><p>Прямое подключение через Meta Embedded Signup без сторонних посредников.</p></div>
          <button type="button" onClick={closeWabaEditor} aria-label="Закрыть"><X size={20}/></button>
        </header>
        <div className="iv2-form">
          <div className="iv2-form-title"><strong>Подключение WABA</strong><span>Авторизуйтесь через Facebook, выберите бизнес-аккаунт и номер WhatsApp. Webhook подключается автоматически.</span></div>
          <WabaEmbeddedSignup />
        </div>
        <footer><div><button type="button" onClick={closeWabaEditor}>Закрыть</button></div></footer>
      </section>
    </div>}

    {googleEditor && <div className="iv2-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setGoogleEditor(null); }}>
      <section className="iv2-modal iv2-modal--wide" role="dialog" aria-modal="true" aria-label={`Настройка ${googleEditor.title}`}>
        <header>
          <div><h2>{googleEditor.title}</h2><p>{googleEditor.description}</p></div>
          <button type="button" onClick={() => setGoogleEditor(null)} aria-label="Закрыть"><X size={20}/></button>
        </header>
        <div className="iv2-history">
          <div className="iv2-history-head">
            <div><strong>Синхронизация данных</strong><span>После сохранения credentials выберите период и загрузите данные в общий контур BELES.</span></div>
            <Database size={20}/>
          </div>
          <div className="iv2-history-periods">
            {googlePeriods.map((days) => <button key={days} type="button" className={googleDays === days ? 'is-active' : ''} onClick={() => setGoogleDays(days)} disabled={Boolean(busy)}>{days} дней</button>)}
          </div>
          <button className="iv2-primary iv2-history-action" type="button" onClick={() => void syncGoogle(googleEditor.provider)} disabled={Boolean(busy) || !googleConfigMap.get(googleEditor.provider)?.configured}>
            {busy === `sync:${googleEditor.provider}` ? <LoaderCircle className="spin" size={16}/> : <RefreshCw size={16}/>} Синхронизировать за {googleDays} дней
          </button>
        </div>
        <div className="iv2-form">
          {googleEditor.fields.map((field) => {
            const config = googleConfigMap.get(googleEditor.provider);
            const savedSecret = field.secret && config?.secretFields[field.name];
            return <label key={field.name}>
              <span>{field.label}{field.required ? ' *' : ''}</span>
              <input
                type={field.secret ? 'password' : 'text'}
                value={googleForms[googleEditor.provider][field.name] || ''}
                onChange={(event) => updateGoogleField(googleEditor.provider, field.name, event.target.value)}
                placeholder={savedSecret ? 'Секрет уже сохранён. Оставьте пустым, чтобы не менять.' : field.placeholder}
              />
            </label>;
          })}
        </div>
        <footer>
          {googleConfigMap.get(googleEditor.provider)?.configured && <button className="iv2-danger" type="button" onClick={() => void disconnectGoogle(googleEditor)} disabled={Boolean(busy)}>Отключить</button>}
          <div>
            <button type="button" onClick={() => setGoogleEditor(null)}>Закрыть</button>
            <button className="iv2-primary" type="button" onClick={() => void saveGoogle(googleEditor)} disabled={Boolean(busy)}>
              {busy === `save:${googleEditor.provider}` ? <LoaderCircle className="spin" size={16}/> : null} Сохранить настройки
            </button>
          </div>
        </footer>
      </section>
    </div>}

    {editor && <div className="iv2-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setEditor(null); }}>
      <section className={`iv2-modal${editor.provider === 'meta' ? ' iv2-modal--wide' : ''}`} role="dialog" aria-modal="true" aria-label={`Настройка ${editor.title}`}>
        <header>
          <div><h2>{editor.title}</h2><p>{editor.description}</p></div>
          <button type="button" onClick={() => setEditor(null)} aria-label="Закрыть"><X size={20}/></button>
        </header>

        {editor.provider === 'meta' && <div className="iv2-oauth">
          <div><strong>Подключение Facebook</strong><span>OAuth получает доступные рекламные кабинеты. После входа выберите только те кабинеты и объявления, которые нужны в аналитике.</span></div>
          <button className="iv2-facebook" type="button" onClick={() => void startMetaOAuth()} disabled={Boolean(busy)}>
            {busy === 'oauth:meta' ? <LoaderCircle className="spin" size={17}/> : <Facebook size={17}/>} {metaConnected ? 'Переподключить Facebook' : 'Войти через Facebook'}
          </button>
        </div>}

        {editor.provider === 'meta' && metaConnected && <MetaSelectionPanel disabled={Boolean(busy)} onMessage={(type, text) => setMessage({ type, text })} onSaved={() => void load()} />}

        {editor.provider === 'meta' && metaConnected && <div className="iv2-history">
          <div className="iv2-history-head"><div><strong>Загрузка исторических данных</strong><span>Импорт учитывает сохранённый выбор кабинетов и креативов. Ничего не выбрано среди креативов — загружаются все.</span></div><Database size={20}/></div>
          <div className="iv2-history-periods">
            {historyPeriods.map((days) => <button key={days} type="button" className={historyDays === days ? 'is-active' : ''} onClick={() => setHistoryDays(days)} disabled={Boolean(busy)}>{days} дней</button>)}
          </div>
          <button className="iv2-primary iv2-history-action" type="button" onClick={() => void loadMetaHistory()} disabled={Boolean(busy)}>
            {busy === 'history:meta' ? <LoaderCircle className="spin" size={16}/> : <Database size={16}/>} Загрузить историю за {historyDays} дней
          </button>
        </div>}

        <div className="iv2-form">
          {editor.provider === 'meta' && <div className="iv2-form-title"><strong>Резервное ручное подключение</strong><span>Используйте только при недоступном OAuth.</span></div>}
          {editor.fields.map((field) => {
            const config = configMap.get(editor.provider);
            const savedSecret = field.secret && config?.secretFields[field.name];
            return <label key={field.name}>
              <span>{field.label}{field.required ? ' *' : ''}</span>
              <input type={field.secret ? 'password' : 'text'} value={forms[editor.provider][field.name] || ''} onChange={(event) => updateField(editor.provider, field.name, event.target.value)} placeholder={savedSecret ? 'Секрет уже сохранён. Оставьте пустым, чтобы не менять.' : field.placeholder} />
            </label>;
          })}
        </div>

        <footer>
          {configMap.get(editor.provider) && <button className="iv2-danger" type="button" onClick={() => void disconnect(editor)} disabled={Boolean(busy)}>Отключить</button>}
          <div>
            <button type="button" onClick={() => setEditor(null)}>Закрыть</button>
            <button className="iv2-primary" type="button" onClick={() => void save(editor)} disabled={Boolean(busy)}>
              {busy === `save:${editor.provider}` ? <LoaderCircle className="spin" size={16}/> : null} Сохранить ручные настройки
            </button>
          </div>
        </footer>
      </section>
    </div>}
  </div>;
}
