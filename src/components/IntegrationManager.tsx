import { useEffect, useMemo, useState } from 'react';
import { Cable, CheckCircle2, LoaderCircle, Play, Save, ShieldAlert, Trash2, XCircle } from 'lucide-react';
import { useAuth } from './AuthGate';
import {
  marketingApi,
  type IntegrationConfigResponse,
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
  const { user } = useAuth();
  const isAdmin = user.role === 'administrator';
  const [status, setStatus] = useState<IntegrationStatus | null>(null);
  const [configs, setConfigs] = useState<IntegrationConfigResponse>({ providers: [] });
  const [forms, setForms] = useState<FormState>(emptyForms);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: 'ok' | 'error'; text: string } | null>(null);

  const configMap = useMemo(() => new Map(configs.providers.map((item) => [item.provider, item])), [configs.providers]);

  const applyConfigs = (result: IntegrationConfigResponse) => {
    setConfigs(result);
    setForms((previous) => {
      const next = { ...previous } as FormState;
      for (const config of result.providers) next[config.provider] = { ...previous[config.provider], ...config.values };
      return next;
    });
  };

  const load = async () => {
    setLoading(true);
    setMessage(null);
    try {
      const currentStatus = await marketingApi.integrationStatus();
      setStatus(currentStatus);
      if (isAdmin) applyConfigs(await marketingApi.integrationConfigs());
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

  const saveAndTest = async (definition: ProviderDefinition) => {
    const key = `save:${definition.provider}`;
    setBusy(key);
    setMessage(null);
    try {
      const current = configMap.get(definition.provider);
      const payload = { ...forms[definition.provider] };
      const missing = definition.fields.filter((field) => field.required && !payload[field.name] && !current?.secretFields[field.name]);
      if (missing.length) throw new Error(`Заполните: ${missing.map((field) => field.label).join(', ')}`);
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
      setMessage({ type: 'ok', text: `${definition.title}: подключение сохранено и проверено.` });
    } catch (error) {
      setMessage({ type: 'error', text: errorText(error) });
    } finally {
      setBusy(null);
    }
  };

  const disconnect = async (provider: IntegrationProvider) => {
    setBusy(`delete:${provider}`);
    setMessage(null);
    try {
      await marketingApi.deleteIntegrationConfig(provider);
      setForms((previous) => ({ ...previous, [provider]: {} }));
      const [nextConfigs, nextStatus] = await Promise.all([marketingApi.integrationConfigs(), marketingApi.integrationStatus()]);
      applyConfigs(nextConfigs);
      setStatus(nextStatus);
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
      await marketingApi.syncIntegrations(source, days);
      setStatus(await marketingApi.integrationStatus());
      setMessage({ type: 'ok', text: source === 'all' ? `Импорт за ${days} дней завершён.` : `${source}: синхронизация завершена.` });
    } catch (error) {
      setMessage({ type: 'error', text: errorText(error) });
    } finally {
      setBusy(null);
    }
  };

  if (!isAdmin) return <section className="panel integration-unlock">
    <div className="integration-unlock__icon"><ShieldAlert size={24}/></div>
    <div><h2>Недостаточно прав</h2><p className="note">Подключать и изменять интеграции может только пользователь с ролью «Администратор».</p></div>
  </section>;

  return <div className="stack">
    <div className="integration-heading">
      <div className="heading"><span>Data connections</span><h1>Подключение интеграций</h1><p>Реквизиты шифруются в Cloudflare Worker и не возвращаются в браузер.</p></div>
      <button className="button button--primary" onClick={() => void sync('all', 90)} disabled={Boolean(busy) || loading}><Play size={16}/>{busy === 'sync:all' ? 'Синхронизация…' : 'Загрузить 90 дней'}</button>
    </div>

    {message && <div className={`alert alert--${message.type}`}>{message.type === 'ok' ? <CheckCircle2 size={18}/> : <XCircle size={18}/>}<span>{message.text}</span></div>}

    {loading ? <section className="panel integration-unlock"><LoaderCircle className="spin" size={24}/><div><h2>Загружаем подключения</h2><p className="note">Проверяем сохранённые реквизиты и статусы синхронизации.</p></div></section> : <>
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
                {config && <button className="button button--danger" onClick={() => void disconnect(definition.provider)} disabled={Boolean(busy)}><Trash2 size={15}/>Отключить</button>}
                <button className="button" onClick={() => void sync(definition.provider, 7)} disabled={!config || Boolean(busy)}><Play size={15}/>7 дней</button>
                <button className="button button--primary" onClick={() => void saveAndTest(definition)} disabled={Boolean(busy)}>{busy === `save:${definition.provider}` ? <LoaderCircle className="spin" size={15}/> : <Save size={15}/>}Сохранить и проверить</button>
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
