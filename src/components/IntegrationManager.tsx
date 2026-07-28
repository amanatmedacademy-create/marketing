import { useEffect, useMemo, useState } from 'react';
import { Cable, CheckCircle2, KeyRound, LoaderCircle, Play, Save, Trash2, XCircle } from 'lucide-react';
import {
  marketingApi,
  type IntegrationConfigResponse,
  type IntegrationCredentialSummary,
  type IntegrationProvider,
  type IntegrationStatus,
} from '../services/api';

type FormState = Record<IntegrationProvider, Record<string, string>>;

interface FieldDefinition {
  name: string;
  label: string;
  placeholder: string;
  secret?: boolean;
  required?: boolean;
}

interface ProviderDefinition {
  provider: IntegrationProvider;
  title: string;
  description: string;
  fields: FieldDefinition[];
}

const definitions: ProviderDefinition[] = [
  {
    provider: 'bitrix',
    title: 'Bitrix24',
    description: 'Лиды, сделки, стадии, приходы и продажи.',
    fields: [
      { name: 'webhookBaseUrl', label: 'Входящий webhook URL', placeholder: 'https://portal.bitrix24.kz/rest/1/token', required: true },
      { name: 'outboundToken', label: 'Токен исходящего webhook', placeholder: 'Токен проверки событий', secret: true },
      { name: 'entityTypeId', label: 'Entity type ID', placeholder: '1' },
      { name: 'targetStageIds', label: 'Целевые стадии', placeholder: 'UC_QUALIFIED,UC_APPOINTED' },
      { name: 'arrivedStageIds', label: 'Стадии прихода', placeholder: 'UC_ARRIVED' },
      { name: 'saleStageIds', label: 'Стадии продажи', placeholder: 'WON,UC_PAID' },
    ],
  },
  {
    provider: 'meta',
    title: 'Meta Ads',
    description: 'Кампании, расходы, клики, лиды и Lead Ads.',
    fields: [
      { name: 'accessToken', label: 'System User access token', placeholder: 'Долгоживущий токен', secret: true, required: true },
      { name: 'adAccountIds', label: 'ID рекламных кабинетов', placeholder: '123456789,987654321', required: true },
      { name: 'graphVersion', label: 'Graph API version', placeholder: 'v23.0', required: true },
      { name: 'webhookVerifyToken', label: 'Webhook verify token', placeholder: 'Произвольная секретная строка', secret: true },
      { name: 'appSecret', label: 'Meta App Secret', placeholder: 'App secret для проверки подписи', secret: true },
    ],
  },
  {
    provider: 'tiktok',
    title: 'TikTok Ads',
    description: 'Рекламная статистика и лиды TikTok.',
    fields: [
      { name: 'accessToken', label: 'Access token', placeholder: 'TikTok Business API token', secret: true, required: true },
      { name: 'advertiserIds', label: 'Advertiser IDs', placeholder: '123456789,987654321', required: true },
      { name: 'apiBase', label: 'API base', placeholder: 'https://business-api.tiktok.com/open_api/v1.3' },
      { name: 'webhookSecret', label: 'Webhook secret', placeholder: 'Секрет проверки webhook', secret: true },
    ],
  },
  {
    provider: 'n8n',
    title: 'n8n',
    description: 'Универсальный импорт лидов, рекламы и ежедневных метрик.',
    fields: [
      { name: 'webhookSecret', label: 'Webhook secret', placeholder: 'Секрет для запросов n8n', secret: true, required: true },
    ],
  },
];

const emptyForms = (): FormState => ({ bitrix: {}, meta: {}, tiktok: {}, n8n: {} });
const dateTime = (value?: string | null) => value ? new Date(value).toLocaleString('ru-RU') : '—';

function errorText(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  try {
    const parsed = JSON.parse(error.message) as { error?: string };
    return parsed.error || error.message;
  } catch {
    return error.message;
  }
}

export default function IntegrationManager() {
  const [status, setStatus] = useState<IntegrationStatus | null>(null);
  const [configs, setConfigs] = useState<IntegrationConfigResponse>({ providers: [] });
  const [forms, setForms] = useState<FormState>(emptyForms);
  const [adminKey, setAdminKey] = useState(() => sessionStorage.getItem('marketing-admin-key') || '');
  const [unlocked, setUnlocked] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: 'ok' | 'error'; text: string } | null>(null);

  const configMap = useMemo(() => new Map(configs.providers.map((item) => [item.provider, item])), [configs.providers]);

  const loadStatus = async () => setStatus(await marketingApi.integrationStatus());

  const loadConfigs = async (key: string) => {
    const result = await marketingApi.integrationConfigs(key);
    setConfigs(result);
    setForms((previous) => {
      const next = { ...previous } as FormState;
      for (const config of result.providers) next[config.provider] = { ...previous[config.provider], ...config.values };
      return next;
    });
    setUnlocked(true);
    sessionStorage.setItem('marketing-admin-key', key);
  };

  useEffect(() => {
    loadStatus().catch((error) => setMessage({ type: 'error', text: errorText(error) }));
    if (adminKey) loadConfigs(adminKey).catch(() => {
      sessionStorage.removeItem('marketing-admin-key');
      setUnlocked(false);
    });
  }, []);

  const unlock = async () => {
    setBusy('unlock');
    setMessage(null);
    try {
      await loadConfigs(adminKey);
      setMessage({ type: 'ok', text: 'Панель подключения открыта.' });
    } catch (error) {
      setUnlocked(false);
      setMessage({ type: 'error', text: errorText(error) });
    } finally {
      setBusy(null);
    }
  };

  const updateField = (provider: IntegrationProvider, field: string, value: string) => {
    setForms((previous) => ({ ...previous, [provider]: { ...previous[provider], [field]: value } }));
  };

  const saveAndTest = async (definition: ProviderDefinition) => {
    const key = `save:${definition.provider}`;
    setBusy(key);
    setMessage(null);
    try {
      const current = configMap.get(definition.provider);
      const payload = { ...forms[definition.provider] };
      const missing = definition.fields.filter((field) => field.required && !payload[field.name] && !current?.secretFields[field.name]);
      if (missing.length) throw new Error(`Заполните: ${missing.map((field) => field.label).join(', ')}`);
      for (const field of definition.fields) {
        if (field.secret && !payload[field.name] && current?.secretFields[field.name]) {
          throw new Error(`Для изменения подключения повторно вставьте секрет: ${field.label}`);
        }
      }
      await marketingApi.saveIntegrationConfig(definition.provider, payload, adminKey);
      await marketingApi.testIntegration(definition.provider, adminKey);
      await Promise.all([loadConfigs(adminKey), loadStatus()]);
      setForms((previous) => ({ ...previous, [definition.provider]: { ...previous[definition.provider], ...Object.fromEntries(definition.fields.filter((field) => field.secret).map((field) => [field.name, ''])) } }));
      setMessage({ type: 'ok', text: `${definition.title}: подключение сохранено и проверено.` });
    } catch (error) {
      await loadConfigs(adminKey).catch(() => undefined);
      setMessage({ type: 'error', text: errorText(error) });
    } finally {
      setBusy(null);
    }
  };

  const disconnect = async (provider: IntegrationProvider) => {
    setBusy(`delete:${provider}`);
    setMessage(null);
    try {
      await marketingApi.deleteIntegrationConfig(provider, adminKey);
      setForms((previous) => ({ ...previous, [provider]: {} }));
      await Promise.all([loadConfigs(adminKey), loadStatus()]);
      setMessage({ type: 'ok', text: 'Интеграция отключена.' });
    } catch (error) {
      setMessage({ type: 'error', text: errorText(error) });
    } finally {
      setBusy(null);
    }
  };

  const sync = async (source: IntegrationProvider | 'all', days: number) => {
    setBusy(`sync:${source}`);
    setMessage(null);
    try {
      await marketingApi.syncIntegrations(source, days, adminKey);
      await loadStatus();
      setMessage({ type: 'ok', text: source === 'all' ? `Импорт за ${days} дней завершён.` : `${source}: синхронизация завершена.` });
    } catch (error) {
      setMessage({ type: 'error', text: errorText(error) });
    } finally {
      setBusy(null);
    }
  };

  return <div className="stack">
    <div className="integration-heading">
      <div className="heading"><span>Data connections</span><h1>Подключение интеграций</h1><p>Реквизиты вводятся через интерфейс, шифруются в Cloudflare Worker и не возвращаются в браузер.</p></div>
      {unlocked && <button className="button button--primary" onClick={() => sync('all', 90)} disabled={Boolean(busy)}><Play size={16}/>{busy === 'sync:all' ? 'Синхронизация…' : 'Загрузить 90 дней'}</button>}
    </div>

    {message && <div className={`alert alert--${message.type}`}>{message.type === 'ok' ? <CheckCircle2 size={18}/> : <XCircle size={18}/>}<span>{message.text}</span></div>}

    {!unlocked && <section className="panel integration-unlock">
      <div className="integration-unlock__icon"><KeyRound size={24}/></div>
      <div><h2>Административный доступ</h2><p className="note">Введите FRONTEND_ADMIN_KEY. Ключ хранится только в текущей вкладке браузера.</p></div>
      <input type="password" value={adminKey} onChange={(event) => setAdminKey(event.target.value)} placeholder="Административный ключ" onKeyDown={(event) => { if (event.key === 'Enter') unlock(); }}/>
      <button className="button button--primary" onClick={unlock} disabled={!adminKey || busy === 'unlock'}>{busy === 'unlock' ? <LoaderCircle className="spin" size={16}/> : <KeyRound size={16}/>}Открыть</button>
    </section>}

    {unlocked && <>
      <div className="integration-grid">
        {definitions.map((definition) => {
          const config = configMap.get(definition.provider);
          const connected = config?.status === 'connected';
          return <section className="integration-config" key={definition.provider}>
            <header>
              <div className="integration-config__icon"><Cable size={20}/></div>
              <div><h2>{definition.title}</h2><p>{definition.description}</p></div>
              <span className={`badge ${connected ? 'badge--green' : config ? 'badge--amber' : ''}`}>{connected ? 'Подключено' : config ? config.status : 'Не подключено'}</span>
            </header>
            <div className="integration-form">
              {definition.fields.map((field) => <label key={field.name}>
                <span>{field.label}{field.required ? ' *' : ''}</span>
                <input
                  type={field.secret ? 'password' : 'text'}
                  value={forms[definition.provider][field.name] || ''}
                  onChange={(event) => updateField(definition.provider, field.name, event.target.value)}
                  placeholder={field.secret && config?.secretFields[field.name] ? 'Секрет сохранён — вставьте новый для замены' : field.placeholder}
                  autoComplete="off"
                />
              </label>)}
            </div>
            {config?.lastError && <p className="integration-error">{config.lastError}</p>}
            <footer>
              <small>Проверено: {dateTime(config?.lastVerifiedAt)}</small>
              <div>
                {config && <button className="button button--danger" onClick={() => disconnect(definition.provider)} disabled={Boolean(busy)}><Trash2 size={15}/>Отключить</button>}
                <button className="button" onClick={() => sync(definition.provider, 7)} disabled={!config || Boolean(busy)}><Play size={15}/>7 дней</button>
                <button className="button button--primary" onClick={() => saveAndTest(definition)} disabled={Boolean(busy)}>{busy === `save:${definition.provider}` ? <LoaderCircle className="spin" size={15}/> : <Save size={15}/>}Сохранить и проверить</button>
              </div>
            </footer>
          </section>;
        })}
      </div>

      <section className="panel">
        <h2>Webhook endpoints</h2>
        <div className="endpoint-list">
          <code>{location.origin}/api/webhooks/bitrix</code>
          <code>{location.origin}/api/webhooks/meta</code>
          <code>{location.origin}/api/webhooks/tiktok</code>
          <code>{location.origin}/api/webhooks/n8n</code>
        </div>
      </section>

      <section className="panel">
        <h2>Последние синхронизации</h2>
        {!status?.runs.length ? <p className="note">Синхронизации ещё не запускались.</p> : <div className="table-wrap"><table><thead><tr><th>Источник</th><th>Статус</th><th>Период</th><th>Получено</th><th>Записано</th><th>Запуск</th><th>Ошибка</th></tr></thead><tbody>{status.runs.map((run) => <tr key={run.id}><td><b>{run.source}</b></td><td><span className={`badge ${run.status === 'success' ? 'badge--green' : ''}`}>{run.status}</span></td><td>{run.date_from || '—'} — {run.date_to || '—'}</td><td>{run.fetched}</td><td>{run.written}</td><td>{dateTime(run.started_at)}</td><td>{run.error || '—'}</td></tr>)}</tbody></table></div>}
      </section>
    </>}
  </div>;
}
