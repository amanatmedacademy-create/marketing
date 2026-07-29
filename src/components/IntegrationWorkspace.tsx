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
  LoaderCircle,
  Play,
  RefreshCw,
  Save,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  Webhook,
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
} from '../services/api';
import '../integrations.css';

type FormState = Record<IntegrationProvider, Record<string, string>>;
type ProviderState = 'connected' | 'configured' | 'error' | 'disconnected';

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
}

const definitions: ProviderDefinition[] = [
  {
    provider: 'bitrix',
    title: 'Bitrix24',
    mark: 'B24',
    description: 'CRM-воронка: лиды, записи, приходы, сделки и оплаты.',
    capabilities: ['Лиды и сделки', 'История стадий', 'Приходы и продажи'],
    steps: [
      'Создайте входящий webhook в Bitrix24 с правами CRM.',
      'Вставьте полный URL webhook и укажите ID стадий вашей воронки.',
      'Сохраните подключение и запустите проверку за один день.',
    ],
    webhookPath: '/api/webhooks/bitrix',
    fields: [
      { name: 'webhookBaseUrl', label: 'Входящий webhook URL', placeholder: 'https://portal.bitrix24.kz/rest/1/token', helper: 'Полный адрес из Bitrix24 → Разработчикам → Входящий webhook.', required: true },
      { name: 'outboundToken', label: 'Токен исходящего webhook', placeholder: 'Секрет проверки событий', helper: 'Нужен для проверки событий, которые Bitrix отправляет в AMANAT MED.', secret: true },
      { name: 'entityTypeId', label: 'Entity type ID', placeholder: '1', helper: '1 — лиды, 2 — сделки. Для смарт-процесса укажите его ID.', advanced: true },
      { name: 'targetStageIds', label: 'Целевые стадии', placeholder: 'UC_QUALIFIED,UC_APPOINTED', helper: 'Через запятую, без пробелов.', advanced: true },
      { name: 'arrivedStageIds', label: 'Стадии прихода', placeholder: 'UC_ARRIVED', helper: 'Стадии фактического визита пациента.', advanced: true },
      { name: 'saleStageIds', label: 'Стадии продажи', placeholder: 'WON,UC_PAID', helper: 'Стадии оплаченного курса.', advanced: true },
    ],
  },
  {
    provider: 'meta',
    title: 'Meta Ads',
    mark: 'M',
    description: 'Расходы, показы, клики, кампании, объявления и Lead Ads.',
    capabilities: ['Расход и ROAS', 'Кампании и объявления', 'Lead Ads'],
    steps: [
      'Создайте System User в Meta Business Manager.',
      'Выдайте доступ к рекламным кабинетам и создайте долгоживущий токен.',
      'Вставьте ID кабинетов без префикса act_ и сохраните подключение.',
    ],
    webhookPath: '/api/webhooks/meta',
    fields: [
      { name: 'accessToken', label: 'System User access token', placeholder: 'Долгоживущий токен Meta', helper: 'Токен хранится зашифрованно и не возвращается в браузер.', secret: true, required: true },
      { name: 'adAccountIds', label: 'ID рекламных кабинетов', placeholder: '123456789,987654321', helper: 'Несколько кабинетов указываются через запятую.', required: true },
      { name: 'graphVersion', label: 'Graph API version', placeholder: 'v23.0', helper: 'Версия Marketing API, разрешённая вашему приложению.', required: true },
      { name: 'webhookVerifyToken', label: 'Webhook verify token', placeholder: 'Произвольная секретная строка', helper: 'Используется при подключении Meta Webhooks.', secret: true, advanced: true },
      { name: 'appSecret', label: 'Meta App Secret', placeholder: 'App Secret приложения', helper: 'Нужен для проверки подписи входящих webhook-событий.', secret: true, advanced: true },
    ],
  },
  {
    provider: 'tiktok',
    title: 'TikTok Ads',
    mark: 'TT',
    description: 'Рекламная статистика, кампании, объявления и лиды TikTok.',
    capabilities: ['Расход и показы', 'Кампании и объявления', 'Lead Generation'],
    steps: [
      'Создайте приложение в TikTok for Business и получите Marketing API access token.',
      'Скопируйте Advertiser ID каждого рекламного кабинета.',
      'Сохраните подключение и проверьте загрузку статистики.',
    ],
    webhookPath: '/api/webhooks/tiktok',
    fields: [
      { name: 'accessToken', label: 'Access token', placeholder: 'TikTok Business API token', helper: 'Токен приложения с доступом к Reporting API.', secret: true, required: true },
      { name: 'advertiserIds', label: 'Advertiser IDs', placeholder: '123456789,987654321', helper: 'Несколько кабинетов указываются через запятую.', required: true },
      { name: 'apiBase', label: 'API base', placeholder: 'https://business-api.tiktok.com/open_api/v1.3', helper: 'Оставьте стандартное значение, если TikTok не выдал другой endpoint.', advanced: true },
      { name: 'webhookSecret', label: 'Webhook secret', placeholder: 'Секрет проверки webhook', helper: 'Передавайте его в заголовке x-webhook-secret.', secret: true, advanced: true },
    ],
  },
  {
    provider: 'n8n',
    title: 'n8n',
    mark: 'n8n',
    description: 'Дополнительный шлюз для импорта лидов, рекламы и метрик.',
    capabilities: ['Ручные сценарии', 'Резервный импорт', 'Служебные уведомления'],
    steps: [
      'Придумайте длинный случайный webhook secret.',
      'Добавьте его в n8n как Bearer token или заголовок x-webhook-secret.',
      'Отправляйте данные на показанный webhook endpoint.',
    ],
    webhookPath: '/api/webhooks/n8n',
    fields: [
      { name: 'webhookSecret', label: 'Webhook secret', placeholder: 'Минимум 32 случайных символа', helper: 'Один и тот же секрет должен использоваться в n8n и AMANAT MED.', secret: true, required: true },
    ],
  },
];

const emptyForms = (): FormState => ({ bitrix: {}, meta: {}, tiktok: {}, n8n: {} });

function dateTime(value?: string | null): string {
  if (!value) return 'Нет данных';
  return new Date(value).toLocaleString('ru-RU', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function errorText(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  try {
    const parsed = JSON.parse(error.message) as { error?: string };
    return parsed.error || error.message;
  } catch {
    return error.message;
  }
}

function providerState(config?: IntegrationCredentialSummary): ProviderState {
  if (!config) return 'disconnected';
  if (config.status === 'connected' && !config.lastError) return 'connected';
  if (config.status === 'error' || config.lastError) return 'error';
  return 'configured';
}

function stateLabel(state: ProviderState): string {
  return {
    connected: 'Подключено',
    configured: 'Нужна проверка',
    error: 'Ошибка',
    disconnected: 'Не подключено',
  }[state];
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
  const [forms, setForms] = useState<FormState>(emptyForms);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: 'ok' | 'error'; text: string } | null>(null);
  const [expanded, setExpanded] = useState<IntegrationProvider | null>(null);
  const [advanced, setAdvanced] = useState<Record<IntegrationProvider, boolean>>({ bitrix: false, meta: false, tiktok: false, n8n: false });
  const [copied, setCopied] = useState<IntegrationProvider | null>(null);

  const configMap = useMemo(() => new Map(configs.providers.map((item) => [item.provider, item])), [configs.providers]);
  const latestRuns = useMemo(() => {
    const map = new Map<IntegrationProvider, IntegrationRun>();
    for (const run of status?.runs || []) {
      if (['bitrix', 'meta', 'tiktok', 'n8n'].includes(run.source) && !map.has(run.source as IntegrationProvider)) {
        map.set(run.source as IntegrationProvider, run);
      }
    }
    return map;
  }, [status?.runs]);

  const connectedCount = definitions.filter((definition) => providerState(configMap.get(definition.provider)) === 'connected').length;
  const attentionCount = definitions.filter((definition) => ['configured', 'error'].includes(providerState(configMap.get(definition.provider)))).length;
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
      const [currentStatus, currentConfigs] = await Promise.all([
        marketingApi.integrationStatus(),
        isAdmin ? marketingApi.integrationConfigs() : Promise.resolve({ providers: [] }),
      ]);
      setStatus(currentStatus);
      applyConfigs(currentConfigs);
      setExpanded((current) => {
        if (current) return current;
        const map = new Map(currentConfigs.providers.map((item) => [item.provider, item]));
        return definitions.find((definition) => providerState(map.get(definition.provider)) !== 'connected')?.provider || null;
      });
    } catch (error) {
      setMessage({ type: 'error', text: errorText(error) });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [isAdmin]);

  const updateField = (provider: IntegrationProvider, field: string, value: string) => {
    setForms((previous) => ({ ...previous, [provider]: { ...previous[provider], [field]: value } }));
  };

  const refresh = async () => {
    setBusy('refresh');
    setMessage(null);
    await load(true);
    setBusy(null);
  };

  const saveAndTest = async (definition: ProviderDefinition) => {
    const key = `save:${definition.provider}`;
    setBusy(key);
    setMessage(null);
    try {
      const current = configMap.get(definition.provider);
      const payload = { ...forms[definition.provider] };
      const missing = definition.fields.filter((field) => field.required && !payload[field.name] && !current?.secretFields[field.name]);
      if (missing.length) throw new Error(`Заполните обязательные поля: ${missing.map((field) => field.label).join(', ')}`);

      await marketingApi.saveIntegrationConfig(definition.provider, payload);
      await marketingApi.testIntegration(definition.provider);
      const [nextConfigs, nextStatus] = await Promise.all([marketingApi.integrationConfigs(), marketingApi.integrationStatus()]);
      applyConfigs(nextConfigs);
      setStatus(nextStatus);
      setForms((previous) => ({
        ...previous,
        [definition.provider]: {
          ...previous[definition.provider],
          ...Object.fromEntries(definition.fields.filter((field) => field.secret).map((field) => [field.name, ''])),
        },
      }));
      setMessage({ type: 'ok', text: `${definition.title}: доступ подтверждён, подключение работает.` });
    } catch (error) {
      await load(true).catch(() => undefined);
      setMessage({ type: 'error', text: `${definition.title}: ${errorText(error)}` });
    } finally {
      setBusy(null);
    }
  };

  const disconnect = async (definition: ProviderDefinition) => {
    if (!window.confirm(`Отключить ${definition.title}? Сохранённые реквизиты будут удалены.`)) return;
    setBusy(`delete:${definition.provider}`);
    setMessage(null);
    try {
      await marketingApi.deleteIntegrationConfig(definition.provider);
      setForms((previous) => ({ ...previous, [definition.provider]: {} }));
      await load(true);
      setMessage({ type: 'ok', text: `${definition.title}: интеграция отключена.` });
    } catch (error) {
      setMessage({ type: 'error', text: errorText(error) });
    } finally {
      setBusy(null);
    }
  };

  const sync = async (source: IntegrationProvider | 'all', days: number) => {
    setBusy(`sync:${source}:${days}`);
    setMessage(null);
    try {
      await marketingApi.syncIntegrations(source, days);
      setStatus(await marketingApi.integrationStatus());
      const sourceName = source === 'all' ? 'Все подключения' : definitions.find((definition) => definition.provider === source)?.title || source;
      setMessage({ type: 'ok', text: `${sourceName}: данные за ${days} дней загружены.` });
    } catch (error) {
      setMessage({ type: 'error', text: errorText(error) });
    } finally {
      setBusy(null);
    }
  };

  const copyWebhook = async (definition: ProviderDefinition) => {
    if (!definition.webhookPath) return;
    await navigator.clipboard.writeText(`${window.location.origin}${definition.webhookPath}`);
    setCopied(definition.provider);
    window.setTimeout(() => setCopied(null), 1800);
  };

  if (!isAdmin) return <section className="connections-access-denied">
    <div><ShieldAlert size={28}/></div>
    <h1>Недостаточно прав</h1>
    <p>Подключать рекламные кабинеты и CRM может только пользователь с ролью «Администратор».</p>
  </section>;

  return <div className="connections-page">
    <header className="connections-hero">
      <div>
        <span className="connections-eyebrow">Data connections</span>
        <h1>Интеграции</h1>
        <p>Подключите CRM и рекламные кабинеты. Система проверит доступ, загрузит историю и будет обновлять данные автоматически.</p>
      </div>
      <div className="connections-hero__actions">
        <button type="button" className="connections-button connections-button--ghost" onClick={() => void refresh()} disabled={Boolean(busy)}>
          {busy === 'refresh' ? <LoaderCircle className="spin" size={16}/> : <RefreshCw size={16}/>} Обновить
        </button>
        <button type="button" className="connections-button connections-button--primary" onClick={() => void sync('all', 90)} disabled={Boolean(busy) || connectedCount === 0}>
          {busy === 'sync:all:90' ? <LoaderCircle className="spin" size={16}/> : <DatabaseZap size={16}/>} Загрузить 90 дней
        </button>
      </div>
    </header>

    <section className="connections-summary" aria-label="Состояние интеграций">
      <article><div className="connections-summary__icon connections-summary__icon--green"><CheckCircle2 size={19}/></div><div><span>Подключено</span><strong>{connectedCount} из {definitions.length}</strong></div></article>
      <article><div className={`connections-summary__icon ${attentionCount ? 'connections-summary__icon--amber' : 'connections-summary__icon--green'}`}><AlertTriangle size={19}/></div><div><span>Требуют внимания</span><strong>{attentionCount}</strong></div></article>
      <article><div className="connections-summary__icon"><Activity size={19}/></div><div><span>Последний обмен</span><strong>{lastRun ? dateTime(lastRun.started_at) : 'Не запускался'}</strong></div></article>
      <article><div className="connections-summary__icon"><CloudCog size={19}/></div><div><span>Автосинхронизация</span><strong>Каждый час</strong></div></article>
    </section>

    {message && <div className={`connections-alert connections-alert--${message.type}`}>
      {message.type === 'ok' ? <CheckCircle2 size={18}/> : <XCircle size={18}/>}<span>{message.text}</span>
    </div>}

    {loading ? <section className="connections-loading"><LoaderCircle className="spin" size={25}/><div><strong>Проверяем подключения</strong><span>Загружаем сохранённые реквизиты и последние синхронизации.</span></div></section> : <>
      <section className="connections-section">
        <div className="connections-section__head"><div><h2>Источники данных</h2><p>Откройте нужный источник, заполните обязательные поля и нажмите «Сохранить и проверить».</p></div></div>

        <div className="connections-list">
          {definitions.map((definition) => {
            const config = configMap.get(definition.provider);
            const state = providerState(config);
            const isOpen = expanded === definition.provider;
            const latestRun = latestRuns.get(definition.provider);
            const primaryFields = definition.fields.filter((field) => !field.advanced);
            const advancedFields = definition.fields.filter((field) => field.advanced);

            return <article className={`connection-card connection-card--${definition.provider} ${isOpen ? 'connection-card--open' : ''}`} key={definition.provider}>
              <button type="button" className="connection-card__summary" onClick={() => setExpanded(isOpen ? null : definition.provider)} aria-expanded={isOpen}>
                <span className="connection-card__mark">{definition.mark}</span>
                <span className="connection-card__identity"><strong>{definition.title}</strong><small>{definition.description}</small></span>
                <span className="connection-card__capabilities">{definition.capabilities.map((item) => <i key={item}>{item}</i>)}</span>
                <span className={`connection-status connection-status--${state}`}><i/>{stateLabel(state)}</span>
                <span className="connection-card__toggle">{isOpen ? <ChevronUp size={18}/> : <ChevronDown size={18}/>}</span>
              </button>

              {isOpen && <div className="connection-card__body">
                <div className="connection-setup">
                  <div className="connection-setup__head">
                    <div><h3>Реквизиты подключения</h3><p>Обязательные поля отмечены звёздочкой. Сохранённые секреты отображаются только как факт наличия.</p></div>
                    <div className="connection-last-check"><ShieldCheck size={15}/><span>Проверено: {dateTime(config?.lastVerifiedAt)}</span></div>
                  </div>

                  <div className="connection-fields">
                    {primaryFields.map((field) => <label key={field.name}>
                      <span>{field.label}{field.required ? <b> *</b> : null}</span>
                      <input
                        type={field.secret ? 'password' : 'text'}
                        value={forms[definition.provider][field.name] || ''}
                        onChange={(event) => updateField(definition.provider, field.name, event.target.value)}
                        placeholder={field.secret && config?.secretFields[field.name] ? 'Секрет уже сохранён — оставьте пустым' : field.placeholder}
                        autoComplete="off"
                      />
                      {field.helper && <small>{field.helper}</small>}
                    </label>)}
                  </div>

                  {advancedFields.length > 0 && <div className="connection-advanced">
                    <button type="button" onClick={() => setAdvanced((previous) => ({ ...previous, [definition.provider]: !previous[definition.provider] }))}>
                      {advanced[definition.provider] ? <ChevronUp size={15}/> : <ChevronDown size={15}/>} Дополнительные настройки
                    </button>
                    {advanced[definition.provider] && <div className="connection-fields connection-fields--advanced">
                      {advancedFields.map((field) => <label key={field.name}>
                        <span>{field.label}</span>
                        <input
                          type={field.secret ? 'password' : 'text'}
                          value={forms[definition.provider][field.name] || ''}
                          onChange={(event) => updateField(definition.provider, field.name, event.target.value)}
                          placeholder={field.secret && config?.secretFields[field.name] ? 'Секрет уже сохранён — оставьте пустым' : field.placeholder}
                          autoComplete="off"
                        />
                        {field.helper && <small>{field.helper}</small>}
                      </label>)}
                    </div>}
                  </div>}

                  {config?.lastError && <div className="connection-error"><XCircle size={16}/><div><strong>Последняя проверка завершилась ошибкой</strong><span>{config.lastError}</span></div></div>}

                  <div className="connection-actions">
                    <button type="button" className="connections-button connections-button--primary" onClick={() => void saveAndTest(definition)} disabled={Boolean(busy)}>
                      {busy === `save:${definition.provider}` ? <LoaderCircle className="spin" size={16}/> : <Save size={16}/>} Сохранить и проверить
                    </button>
                    <div className="connection-sync-buttons">
                      <span>Загрузить историю:</span>
                      {[7, 30, 90].map((days) => <button type="button" key={days} onClick={() => void sync(definition.provider, days)} disabled={!config || Boolean(busy)}>{busy === `sync:${definition.provider}:${days}` ? <LoaderCircle className="spin" size={14}/> : <Play size={13}/>} {days} дней</button>)}
                    </div>
                    {config && <button type="button" className="connections-button connections-button--danger" onClick={() => void disconnect(definition)} disabled={Boolean(busy)}><Trash2 size={15}/>Отключить</button>}
                  </div>
                </div>

                <aside className="connection-guide">
                  <h3>Как подключить</h3>
                  <ol>{definition.steps.map((step, index) => <li key={step}><span>{index + 1}</span><p>{step}</p></li>)}</ol>
                  {definition.webhookPath && <div className="connection-webhook">
                    <div><Webhook size={16}/><span>Webhook endpoint</span></div>
                    <code>{window.location.origin}{definition.webhookPath}</code>
                    <button type="button" onClick={() => void copyWebhook(definition)}>{copied === definition.provider ? <Check size={15}/> : <Clipboard size={15}/>} {copied === definition.provider ? 'Скопировано' : 'Копировать'}</button>
                  </div>}
                  <div className="connection-run-status">
                    <span>Последняя синхронизация</span>
                    <strong>{latestRun ? runLabel(latestRun.status) : 'Ещё не запускалась'}</strong>
                    {latestRun && <small>{dateTime(latestRun.started_at)} · записано {latestRun.written}</small>}
                  </div>
                </aside>
              </div>}
            </article>;
          })}
        </div>
      </section>

      <section className="connections-section connections-runs">
        <div className="connections-section__head"><div><h2>Журнал синхронизаций</h2><p>Последние запуски, объём полученных данных и точная причина ошибки.</p></div></div>
        {!status?.runs.length ? <div className="connections-empty"><Activity size={22}/><span>Синхронизации ещё не запускались.</span></div> : <div className="connections-table-wrap">
          <table>
            <thead><tr><th>Источник</th><th>Статус</th><th>Период данных</th><th>Получено</th><th>Записано</th><th>Запущено</th><th>Ошибка</th></tr></thead>
            <tbody>{status.runs.map((run) => <tr key={run.id}>
              <td><strong>{definitions.find((definition) => definition.provider === run.source)?.title || run.source}</strong></td>
              <td><span className={`connections-run-state connections-run-state--${run.status}`}>{runLabel(run.status)}</span></td>
              <td>{run.date_from || '—'} — {run.date_to || '—'}</td>
              <td>{run.fetched.toLocaleString('ru-RU')}</td>
              <td>{run.written.toLocaleString('ru-RU')}</td>
              <td>{dateTime(run.started_at)}</td>
              <td className={run.error ? 'connections-table-error' : ''}>{run.error || '—'}</td>
            </tr>)}</tbody>
          </table>
        </div>}
      </section>
    </>}
  </div>;
}
