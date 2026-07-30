import { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clipboard,
  CloudCog,
  DatabaseZap,
  Facebook,
  LoaderCircle,
  LogIn,
  LogOut,
  Play,
  RefreshCw,
  Save,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  Webhook,
  X,
  XCircle,
} from 'lucide-react';
import { useAuth } from './AuthGate';
import {
  marketingApi,
  type IntegrationConfigResponse,
  type IntegrationCredentialSummary,
  type IntegrationProvider,
  type IntegrationRun,
  type IntegrationStatus,
  type TikTokLoginStatus,
} from '../services/api';
import '../integrations.css';

type FormState = Record<IntegrationProvider, Record<string, string>>;
type ProviderState = 'connected' | 'configured' | 'error' | 'disconnected';
type ProviderGroup = 'ADVERTISING' | 'CRM' | 'AUTOMATION';

interface FieldDefinition {
  name: string;
  label: string;
  placeholder: string;
  helper?: string;
  secret?: boolean;
  required?: boolean;
  advanced?: boolean;
}

interface ProviderDefinition {
  provider: IntegrationProvider;
  title: string;
  mark: string;
  description: string;
  capabilities: string[];
  steps: string[];
  webhookPath?: string;
  fields: FieldDefinition[];
  group: ProviderGroup;
  tone: string;
}

const definitions: ProviderDefinition[] = [
  {
    provider: 'meta', title: 'Meta Ads', mark: 'M', group: 'ADVERTISING', tone: 'meta',
    description: 'Facebook и Instagram: кабинеты, кампании, расходы, объявления и Lead Ads.',
    capabilities: ['Расход и ROAS', 'Кампании', 'Lead Ads'],
    steps: ['Нажмите «Подключить через Facebook».', 'Разрешите доступ к рекламным кабинетам.', 'Система автоматически определит кабинеты и загрузит историю.'],
    webhookPath: '/api/webhooks/meta',
    fields: [
      { name: 'accessToken', label: 'System User access token', placeholder: 'Долгоживущий токен Meta', helper: 'Для резервного ручного подключения. При входе через Facebook заполняется автоматически.', secret: true, required: true },
      { name: 'adAccountIds', label: 'ID рекламных кабинетов', placeholder: '123456789,987654321', helper: 'Несколько кабинетов через запятую.', required: true },
      { name: 'graphVersion', label: 'Graph API version', placeholder: 'v23.0', required: true },
      { name: 'webhookVerifyToken', label: 'Webhook verify token', placeholder: 'Секретная строка', secret: true, advanced: true },
      { name: 'appSecret', label: 'Meta App Secret', placeholder: 'App Secret приложения', secret: true, advanced: true },
    ],
  },
  {
    provider: 'tiktok', title: 'TikTok Ads', mark: 'TT', group: 'ADVERTISING', tone: 'tiktok',
    description: 'Рекламная статистика, кампании, объявления и лиды TikTok.',
    capabilities: ['Расход и показы', 'Кампании', 'Lead Generation'],
    steps: ['Для демонстрации Login Kit нажмите «Войти через TikTok».', 'Для рекламных данных создайте приложение TikTok for Business.', 'После одобрения подключите Advertiser ID и Marketing API token.'],
    webhookPath: '/api/integrations/tiktok/webhook',
    fields: [
      { name: 'accessToken', label: 'Access token', placeholder: 'TikTok Business API token', secret: true, required: true },
      { name: 'advertiserIds', label: 'Advertiser IDs', placeholder: '123456789,987654321', required: true },
      { name: 'apiBase', label: 'API base', placeholder: 'https://business-api.tiktok.com/open_api/v1.3', advanced: true },
      { name: 'webhookSecret', label: 'Webhook secret', placeholder: 'Секрет проверки webhook', secret: true, advanced: true },
    ],
  },
  {
    provider: 'bitrix', title: 'Bitrix24', mark: '24', group: 'CRM', tone: 'bitrix',
    description: 'CRM-воронка: лиды, записи, приходы, сделки и оплаты.',
    capabilities: ['Лиды и сделки', 'История стадий', 'Продажи'],
    steps: ['Создайте входящий webhook в Bitrix24.', 'Разрешите доступ к CRM.', 'Вставьте URL и нажмите «Сохранить и проверить».'],
    webhookPath: '/api/webhooks/bitrix',
    fields: [
      { name: 'webhookBaseUrl', label: 'Входящий webhook URL', placeholder: 'https://portal.bitrix24.kz/rest/1/token', required: true },
      { name: 'outboundToken', label: 'Токен исходящего webhook', placeholder: 'Секрет проверки событий', secret: true },
      { name: 'entityTypeId', label: 'Entity type ID', placeholder: '1', advanced: true },
      { name: 'targetStageIds', label: 'Целевые стадии', placeholder: 'UC_QUALIFIED,UC_APPOINTED', advanced: true },
      { name: 'arrivedStageIds', label: 'Стадии прихода', placeholder: 'UC_ARRIVED', advanced: true },
      { name: 'saleStageIds', label: 'Стадии продажи', placeholder: 'WON,UC_PAID', advanced: true },
    ],
  },
  {
    provider: 'n8n', title: 'n8n', mark: 'n8n', group: 'AUTOMATION', tone: 'n8n',
    description: 'Дополнительный шлюз для импорта лидов, рекламы и метрик.',
    capabilities: ['Сценарии', 'Резервный импорт', 'Уведомления'],
    steps: ['Создайте длинный случайный webhook secret.', 'Добавьте его в n8n как Bearer token.', 'Отправляйте данные на указанный endpoint.'],
    webhookPath: '/api/webhooks/n8n',
    fields: [{ name: 'webhookSecret', label: 'Webhook secret', placeholder: 'Минимум 32 случайных символа', secret: true, required: true }],
  },
];

const groups: Array<{ id: ProviderGroup; title: string; description: string }> = [
  { id: 'ADVERTISING', title: 'Рекламные кабинеты', description: 'Расходы, кампании, объявления, лиды и сквозная аналитика' },
  { id: 'CRM', title: 'CRM', description: 'Лиды, контакты, сделки, визиты и оплаты' },
  { id: 'AUTOMATION', title: 'Автоматизация и API', description: 'Webhooks, сценарии и резервный обмен данными' },
];

const emptyForms = (): FormState => ({ bitrix: {}, meta: {}, tiktok: {}, n8n: {} });

function dateTime(value?: string | null): string {
  if (!value) return 'Нет данных';
  return new Date(value).toLocaleString('ru-RU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}
function errorText(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  try { return (JSON.parse(error.message) as { error?: string }).error || error.message; } catch { return error.message; }
}
function providerState(config?: IntegrationCredentialSummary): ProviderState {
  if (!config) return 'disconnected';
  if (config.status === 'connected' && !config.lastError) return 'connected';
  if (config.status === 'error' || config.lastError) return 'error';
  return 'configured';
}
function stateLabel(state: ProviderState): string {
  return { connected: 'Подключено', configured: 'Нужна проверка', error: 'Ошибка', disconnected: 'Не подключено' }[state];
}
function runLabel(status: string): string {
  if (status === 'success') return 'Успешно';
  if (status === 'failed') return 'Ошибка';
  if (status === 'running') return 'Выполняется';
  return status;
}

export default function IntegrationWorkspace() {
  const { user } = useAuth();
  const isAdmin = user.role === 'administrator';
  const [status, setStatus] = useState<IntegrationStatus | null>(null);
  const [configs, setConfigs] = useState<IntegrationConfigResponse>({ providers: [] });
  const [tiktokLogin, setTikTokLogin] = useState<TikTokLoginStatus>({ connected: false, profile: null });
  const [forms, setForms] = useState<FormState>(emptyForms);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: 'ok' | 'error'; text: string } | null>(null);
  const [editor, setEditor] = useState<ProviderDefinition | null>(null);
  const [advanced, setAdvanced] = useState<Record<IntegrationProvider, boolean>>({ bitrix: false, meta: false, tiktok: false, n8n: false });
  const [copied, setCopied] = useState<IntegrationProvider | null>(null);

  const configMap = useMemo(() => new Map(configs.providers.map((item) => [item.provider, item])), [configs.providers]);
  const latestRuns = useMemo(() => {
    const map = new Map<IntegrationProvider, IntegrationRun>();
    for (const run of status?.runs || []) if (['bitrix', 'meta', 'tiktok', 'n8n'].includes(run.source) && !map.has(run.source as IntegrationProvider)) map.set(run.source as IntegrationProvider, run);
    return map;
  }, [status?.runs]);
  const connectedCount = definitions.filter((item) => providerState(configMap.get(item.provider)) === 'connected').length;
  const attentionCount = definitions.filter((item) => ['configured', 'error'].includes(providerState(configMap.get(item.provider)))).length;
  const lastRun = status?.runs?.[0];

  const applyConfigs = (result: IntegrationConfigResponse) => {
    setConfigs(result);
    setForms((previous) => {
      const next = { ...previous } as FormState;
      for (const config of result.providers) next[config.provider] = { ...previous[config.provider], ...config.values };
      return next;
    });
  };
  const load = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const [currentStatus, currentConfigs, loginStatus] = await Promise.all([
        marketingApi.integrationStatus(),
        isAdmin ? marketingApi.integrationConfigs() : Promise.resolve({ providers: [] }),
        marketingApi.tiktokLoginStatus().catch(() => ({ connected: false, profile: null })),
      ]);
      setStatus(currentStatus); applyConfigs(currentConfigs); setTikTokLogin(loginStatus);
    } catch (error) { setMessage({ type: 'error', text: errorText(error) }); }
    finally { setLoading(false); }
  };
  useEffect(() => {
    void load();
    const params = new URLSearchParams(window.location.search);
    const result = params.get('tiktok_login');
    if (result === 'connected') setMessage({ type: 'ok', text: 'TikTok Login Kit: вход выполнен.' });
    if (result === 'error') setMessage({ type: 'error', text: `TikTok Login Kit: ${params.get('reason') || 'ошибка авторизации'}` });
  }, [isAdmin]);

  const updateField = (provider: IntegrationProvider, field: string, value: string) => setForms((previous) => ({ ...previous, [provider]: { ...previous[provider], [field]: value } }));
  const refresh = async () => { setBusy('refresh'); setMessage(null); await load(true); setBusy(null); };
  const disconnectTikTokLogin = async () => {
    setBusy('tiktok-login-disconnect');
    try { await marketingApi.disconnectTikTokLogin(); setTikTokLogin({ connected: false, profile: null }); setMessage({ type: 'ok', text: 'TikTok Login Kit отключён.' }); }
    catch (error) { setMessage({ type: 'error', text: errorText(error) }); }
    finally { setBusy(null); }
  };
  const saveAndTest = async (definition: ProviderDefinition) => {
    setBusy(`save:${definition.provider}`); setMessage(null);
    try {
      const current = configMap.get(definition.provider);
      const payload = { ...forms[definition.provider] };
      const missing = definition.fields.filter((field) => field.required && !payload[field.name] && !current?.secretFields[field.name]);
      if (missing.length) throw new Error(`Заполните обязательные поля: ${missing.map((field) => field.label).join(', ')}`);
      await marketingApi.saveIntegrationConfig(definition.provider, payload);
      await marketingApi.testIntegration(definition.provider);
      const [nextConfigs, nextStatus] = await Promise.all([marketingApi.integrationConfigs(), marketingApi.integrationStatus()]);
      applyConfigs(nextConfigs); setStatus(nextStatus);
      setForms((previous) => ({ ...previous, [definition.provider]: { ...previous[definition.provider], ...Object.fromEntries(definition.fields.filter((field) => field.secret).map((field) => [field.name, ''])) } }));
      setMessage({ type: 'ok', text: `${definition.title}: подключение работает.` });
      setEditor(null);
    } catch (error) { await load(true).catch(() => undefined); setMessage({ type: 'error', text: `${definition.title}: ${errorText(error)}` }); }
    finally { setBusy(null); }
  };
  const disconnect = async (definition: ProviderDefinition) => {
    if (!window.confirm(`Отключить ${definition.title}? Сохранённые реквизиты будут удалены.`)) return;
    setBusy(`delete:${definition.provider}`); setMessage(null);
    try { await marketingApi.deleteIntegrationConfig(definition.provider); setForms((previous) => ({ ...previous, [definition.provider]: {} })); await load(true); setMessage({ type: 'ok', text: `${definition.title}: интеграция отключена.` }); setEditor(null); }
    catch (error) { setMessage({ type: 'error', text: errorText(error) }); }
    finally { setBusy(null); }
  };
  const sync = async (source: IntegrationProvider | 'all', days: number) => {
    setBusy(`sync:${source}:${days}`); setMessage(null);
    try { await marketingApi.syncIntegrations(source, days); setStatus(await marketingApi.integrationStatus()); setMessage({ type: 'ok', text: `${source === 'all' ? 'Все подключения' : definitions.find((item) => item.provider === source)?.title}: данные за ${days} дней загружены.` }); }
    catch (error) { setMessage({ type: 'error', text: errorText(error) }); }
    finally { setBusy(null); }
  };
  const copyWebhook = async (definition: ProviderDefinition) => {
    if (!definition.webhookPath) return;
    await navigator.clipboard.writeText(`${window.location.origin}${definition.webhookPath}`); setCopied(definition.provider); window.setTimeout(() => setCopied(null), 1800);
  };

  if (!isAdmin) return <section className="connections-access-denied"><div><ShieldAlert size={28}/></div><h1>Недостаточно прав</h1><p>Подключать рекламные кабинеты и CRM может только администратор.</p></section>;

  return <div className="connections-page">
    <header className="connections-hero">
      <div><span className="connections-eyebrow">INTEGRATIONS</span><h1>Интеграции</h1><p>Подключайте рекламные кабинеты, CRM и внешние сервисы в одном каталоге.</p></div>
      <div className="connections-hero__actions">
        <button className="connections-button connections-button--ghost" type="button" onClick={() => void refresh()} disabled={Boolean(busy)}>{busy === 'refresh' ? <LoaderCircle className="spin" size={16}/> : <RefreshCw size={16}/>} Обновить</button>
        <button className="connections-button connections-button--primary" type="button" onClick={() => void sync('all', 90)} disabled={Boolean(busy) || connectedCount === 0}>{busy === 'sync:all:90' ? <LoaderCircle className="spin" size={16}/> : <DatabaseZap size={16}/>} Загрузить 90 дней</button>
      </div>
    </header>

    <section className="connections-summary">
      <article><div className="connections-summary__icon connections-summary__icon--green"><CheckCircle2 size={19}/></div><div><span>Подключено</span><strong>{connectedCount} из {definitions.length}</strong></div></article>
      <article><div className={`connections-summary__icon ${attentionCount ? 'connections-summary__icon--amber' : 'connections-summary__icon--green'}`}><AlertTriangle size={19}/></div><div><span>Требуют внимания</span><strong>{attentionCount}</strong></div></article>
      <article><div className="connections-summary__icon"><Activity size={19}/></div><div><span>Последний обмен</span><strong>{lastRun ? dateTime(lastRun.started_at) : 'Не запускался'}</strong></div></article>
      <article><div className="connections-summary__icon"><CloudCog size={19}/></div><div><span>Автосинхронизация</span><strong>Каждый час</strong></div></article>
    </section>

    {message && <div className={`connections-alert connections-alert--${message.type}`}>{message.type === 'ok' ? <CheckCircle2 size={18}/> : <XCircle size={18}/>}<span>{message.text}</span><button type="button" onClick={() => setMessage(null)}>×</button></div>}

    {loading ? <section className="connections-loading"><LoaderCircle className="spin" size={25}/><div><strong>Проверяем подключения</strong><span>Загружаем статусы и настройки.</span></div></section> : groups.map((group) => <section className="integration-catalog-section" key={group.id}>
      <div className="connections-section__head"><div><h2>{group.title}</h2><p>{group.description}</p></div></div>
      <div className="integration-catalog-grid">
        {definitions.filter((item) => item.group === group.id).map((definition) => {
          const config = configMap.get(definition.provider); const state = providerState(config);
          return <article className={`integration-catalog-card integration-tone-${definition.tone} integration-state-${state}`} key={definition.provider}>
            <div className="integration-card-top"><span className="integration-card-logo">{definition.mark}</span>{state !== 'disconnected' && <em>{stateLabel(state)}</em>}</div>
            <strong>{definition.title}</strong><p>{definition.description}</p>
            <div className="integration-card-tags">{definition.capabilities.map((capability) => <span key={capability}>{capability}</span>)}</div>
            <button type="button" onClick={() => setEditor(definition)}>{state === 'connected' ? 'Настроить' : state === 'disconnected' ? 'Подключить' : 'Продолжить настройку'}</button>
          </article>;
        })}
      </div>
    </section>)}

    {!loading && <section className="connections-section connections-runs">
      <div className="connections-section__head"><div><h2>Журнал синхронизаций</h2><p>Последние запуски и результаты загрузки.</p></div></div>
      {!status?.runs.length ? <div className="connections-empty"><Activity size={22}/><span>Синхронизации ещё не запускались.</span></div> : <div className="connections-table-wrap"><table><thead><tr><th>Источник</th><th>Статус</th><th>Период</th><th>Получено</th><th>Записано</th><th>Запущено</th><th>Ошибка</th></tr></thead><tbody>{status.runs.map((run) => <tr key={run.id}><td><strong>{definitions.find((item) => item.provider === run.source)?.title || run.source}</strong></td><td><span className={`connections-run-state connections-run-state--${run.status}`}>{runLabel(run.status)}</span></td><td>{run.date_from || '—'} — {run.date_to || '—'}</td><td>{run.fetched.toLocaleString('ru-RU')}</td><td>{run.written.toLocaleString('ru-RU')}</td><td>{dateTime(run.started_at)}</td><td className={run.error ? 'connections-table-error' : ''}>{run.error || '—'}</td></tr>)}</tbody></table></div>}
    </section>}

    {editor && (() => {
      const definition = editor; const config = configMap.get(definition.provider); const state = providerState(config); const latestRun = latestRuns.get(definition.provider);
      const primaryFields = definition.fields.filter((field) => !field.advanced); const advancedFields = definition.fields.filter((field) => field.advanced);
      return <div className="integration-modal-layer" role="dialog" aria-modal="true" aria-label={`Настройка ${definition.title}`}>
        <button className="integration-modal-overlay" type="button" aria-label="Закрыть" onClick={() => setEditor(null)}/>
        <section className={`integration-modal connection-card--${definition.provider}`}>
          <header><span className={`integration-card-logo integration-tone-${definition.tone}`}>{definition.mark}</span><div><small>{state === 'disconnected' ? 'НОВОЕ ПОДКЛЮЧЕНИЕ' : 'НАСТРОЙКА ПОДКЛЮЧЕНИЯ'}</small><h2>{definition.title}</h2><p>{definition.description}</p></div><button type="button" onClick={() => setEditor(null)}><X size={20}/></button></header>
          <div className="integration-modal-body">
            <main>
              {definition.provider === 'meta' && <section className="meta-fast-connect"><Facebook size={22}/><div><strong>Быстрое подключение через Facebook</strong><small>Войдите в Facebook — рекламные кабинеты определятся автоматически.</small></div></section>}
              {definition.provider === 'tiktok' && <section className="meta-fast-connect">
                {tiktokLogin.profile?.avatarUrl ? <img src={tiktokLogin.profile.avatarUrl} alt="TikTok avatar" width={42} height={42} style={{ borderRadius: '50%' }}/> : <LogIn size={22}/>} 
                <div><strong>{tiktokLogin.connected ? `TikTok: ${tiktokLogin.profile?.displayName || 'подключено'}` : 'Вход через TikTok Login Kit'}</strong><small>{tiktokLogin.connected ? 'Профиль user.info.basic получен. Этот экран можно показать в demo video.' : 'Откроется официальный экран TikTok и вернёт имя и аватар пользователя.'}</small></div>
                {tiktokLogin.connected
                  ? <button className="connections-button" type="button" onClick={() => void disconnectTikTokLogin()} disabled={Boolean(busy)}><LogOut size={15}/> Выйти</button>
                  : <button className="connections-button connections-button--primary" type="button" onClick={() => marketingApi.startTikTokLogin()}><LogIn size={15}/> Войти через TikTok</button>}
              </section>}
              <div className="connection-setup__head"><div><h3>{definition.provider === 'meta' ? 'Ручные и резервные настройки' : definition.provider === 'tiktok' ? 'TikTok Ads — отдельные реквизиты' : 'Реквизиты подключения'}</h3><p>Сохранённые секреты не возвращаются в браузер.</p></div><div className="connection-last-check"><ShieldCheck size={15}/><span>Проверено: {dateTime(config?.lastVerifiedAt)}</span></div></div>
              <div className="connection-fields">{primaryFields.map((field) => <label key={field.name}><span>{field.label}{field.required && <b> *</b>}</span><input type={field.secret ? 'password' : 'text'} value={forms[definition.provider][field.name] || ''} onChange={(event) => updateField(definition.provider, field.name, event.target.value)} placeholder={field.secret && config?.secretFields[field.name] ? 'Секрет уже сохранён' : field.placeholder} autoComplete="off"/>{field.helper && <small>{field.helper}</small>}</label>)}</div>
              {advancedFields.length > 0 && <div className="connection-advanced"><button type="button" onClick={() => setAdvanced((previous) => ({ ...previous, [definition.provider]: !previous[definition.provider] }))}>{advanced[definition.provider] ? <ChevronUp size={15}/> : <ChevronDown size={15}/>} Дополнительные настройки</button>{advanced[definition.provider] && <div className="connection-fields">{advancedFields.map((field) => <label key={field.name}><span>{field.label}</span><input type={field.secret ? 'password' : 'text'} value={forms[definition.provider][field.name] || ''} onChange={(event) => updateField(definition.provider, field.name, event.target.value)} placeholder={field.secret && config?.secretFields[field.name] ? 'Секрет уже сохранён' : field.placeholder}/></label>)}</div>}</div>}
              {config?.lastError && <div className="connection-error"><XCircle size={16}/><div><strong>Ошибка последней проверки</strong><span>{config.lastError}</span></div></div>}
              <div className="connection-actions">
                <button className="connections-button connections-button--primary" type="button" onClick={() => void saveAndTest(definition)} disabled={Boolean(busy)}>{busy === `save:${definition.provider}` ? <LoaderCircle className="spin" size={16}/> : <Save size={16}/>} Сохранить и проверить</button>
                {config && [7, 30, 90].map((days) => <button className="connections-button" type="button" key={days} onClick={() => void sync(definition.provider, days)} disabled={Boolean(busy)}>{busy === `sync:${definition.provider}:${days}` ? <LoaderCircle className="spin" size={14}/> : <Play size={13}/>} {days} дней</button>)}
                {config && <button className="connections-button connections-button--danger" type="button" onClick={() => void disconnect(definition)} disabled={Boolean(busy)}><Trash2 size={15}/>Отключить</button>}
              </div>
            </main>
            <aside className="connection-guide"><h3>Как подключить</h3><ol>{definition.steps.map((step, index) => <li key={step}><span>{index + 1}</span><p>{step}</p></li>)}</ol>{definition.webhookPath && <div className="connection-webhook"><div><Webhook size={16}/><span>Webhook endpoint</span></div><code>{window.location.origin}{definition.webhookPath}</code><button type="button" onClick={() => void copyWebhook(definition)}>{copied === definition.provider ? <Check size={15}/> : <Clipboard size={15}/>} {copied === definition.provider ? 'Скопировано' : 'Копировать'}</button></div>}<div className="connection-run-status"><span>Последняя синхронизация</span><strong>{latestRun ? runLabel(latestRun.status) : 'Ещё не запускалась'}</strong>{latestRun && <small>{dateTime(latestRun.started_at)} · записано {latestRun.written}</small>}</div></aside>
          </div>
        </section>
      </div>;
    })()}
  </div>;
}
