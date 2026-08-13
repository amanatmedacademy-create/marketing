import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Check, ChevronRight, CircleDot, ExternalLink, KeyRound, LoaderCircle, Plug, RefreshCw, Settings2, ShieldCheck, Trash2, X } from 'lucide-react';
import { useAuth } from './AuthGate';
import { authFetch } from '../services/auth';
import '../advertising-accounts-center.css';

type ProviderId = 'meta' | 'tiktok' | 'google_ads' | 'yandex';
type ConnectionStatus = 'connected' | 'configured' | 'error' | 'not_connected' | 'planned';
type JsonRecord = Record<string, unknown>;

type CredentialSummary = {
  provider: string;
  configured?: boolean;
  status?: string;
  values?: Record<string, string>;
  secretFields?: Record<string, boolean>;
  updatedAt?: string | null;
  lastVerifiedAt?: string | null;
  lastError?: string | null;
};

type IntegrationRun = {
  source?: string;
  status?: string;
  fetched?: number;
  written?: number;
  error?: string | null;
  started_at?: string | null;
  finished_at?: string | null;
};

type ProviderDefinition = {
  id: ProviderId;
  name: string;
  subtitle: string;
  mark: string;
  description: string;
};

type EditorState = {
  provider: 'tiktok' | 'google_ads';
  values: Record<string, string>;
};

const providers: ProviderDefinition[] = [
  { id: 'meta', name: 'Meta Ads', subtitle: 'Facebook · Instagram', mark: 'M', description: 'Рекламные кабинеты, кампании, лиды и Meta Insights.' },
  { id: 'tiktok', name: 'TikTok Ads', subtitle: 'TikTok for Business', mark: 'TT', description: 'Advertiser accounts, кампании и performance TikTok.' },
  { id: 'google_ads', name: 'Google Ads', subtitle: 'Search · Display · YouTube', mark: 'G', description: 'Customer accounts, кампании, клики и конверсии Google Ads.' },
  { id: 'yandex', name: 'Yandex Direct', subtitle: 'Search · РСЯ', mark: 'Я', description: 'Подключение Direct подготовлено как следующий рекламный коннектор.' },
];

const text = (value: unknown) => typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim();
const countCsv = (value: unknown) => text(value).split(',').map((item) => item.trim()).filter(Boolean).length;

function formatDate(value?: string | null) {
  if (!value) return 'Нет проверки';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Нет проверки';
  return date.toLocaleString('ru-RU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

async function readJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await authFetch(path, init);
  const body = await response.text();
  let payload: unknown = {};
  try { payload = body ? JSON.parse(body) : {}; } catch { payload = { error: body }; }
  if (!response.ok) throw new Error(text((payload as JsonRecord).error) || `HTTP ${response.status}`);
  return payload as T;
}

function stateOf(config?: CredentialSummary): ConnectionStatus {
  if (!config?.configured) return 'not_connected';
  if (config.lastError || config.status === 'error') return 'error';
  if (config.status === 'connected') return 'connected';
  return 'configured';
}

function statusLabel(status: ConnectionStatus) {
  if (status === 'connected') return 'Подключено';
  if (status === 'configured') return 'Настроено';
  if (status === 'error') return 'Ошибка';
  if (status === 'planned') return 'Скоро';
  return 'Не подключено';
}

function accountCount(provider: ProviderId, config?: CredentialSummary) {
  const values = config?.values || {};
  if (provider === 'meta') return countCsv(values.adAccountIds);
  if (provider === 'tiktok') return countCsv(values.advertiserIds);
  if (provider === 'google_ads') return countCsv(values.customerIds);
  return 0;
}

function latestRun(source: string, runs: IntegrationRun[]) {
  return runs.find((run) => run.source === source);
}

export default function AdvertisingAccountsCenter() {
  const { user } = useAuth();
  const isAdmin = user.role === 'administrator';
  const [standardConfigs, setStandardConfigs] = useState<CredentialSummary[]>([]);
  const [googleConfigs, setGoogleConfigs] = useState<CredentialSummary[]>([]);
  const [runs, setRuns] = useState<IntegrationRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: 'ok' | 'error'; text: string } | null>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);

  const configMap = useMemo(() => {
    const map = new Map<string, CredentialSummary>();
    for (const item of standardConfigs) map.set(item.provider, item);
    for (const item of googleConfigs) map.set(item.provider, item);
    return map;
  }, [standardConfigs, googleConfigs]);

  const load = async () => {
    setLoading(true);
    setMessage(null);
    try {
      const statusPromise = readJson<{ runs?: IntegrationRun[] }>('/api/integrations/status').catch(() => ({ runs: [] }));
      if (!isAdmin) {
        const status = await statusPromise;
        setRuns(status.runs || []);
        return;
      }
      const [standard, google, status] = await Promise.all([
        readJson<{ providers?: CredentialSummary[] }>('/api/integrations/config'),
        readJson<{ providers?: CredentialSummary[] }>('/api/integrations/google/config'),
        statusPromise,
      ]);
      setStandardConfigs(standard.providers || []);
      setGoogleConfigs(google.providers || []);
      setRuns(status.runs || []);
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'Не удалось загрузить рекламные подключения' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [isAdmin]);

  const openEditor = (provider: 'tiktok' | 'google_ads') => {
    const config = configMap.get(provider);
    if (provider === 'tiktok') {
      setEditor({ provider, values: { accessToken: '', advertiserIds: config?.values?.advertiserIds || '' } });
      return;
    }
    setEditor({ provider, values: {
      clientId: config?.values?.clientId || '',
      clientSecret: '',
      refreshToken: '',
      developerToken: '',
      customerIds: config?.values?.customerIds || '',
      loginCustomerId: config?.values?.loginCustomerId || '',
      apiVersion: config?.values?.apiVersion || 'v25',
    } });
  };

  const connectMeta = async () => {
    setBusy('meta-connect');
    setMessage(null);
    try {
      const result = await readJson<{ authorizationUrl?: string }>('/api/integrations/meta/start', { method: 'POST' });
      if (!result.authorizationUrl) throw new Error('Meta не вернула OAuth URL');
      window.location.assign(result.authorizationUrl);
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'Не удалось начать подключение Meta' });
      setBusy(null);
    }
  };

  const saveEditor = async () => {
    if (!editor) return;
    setBusy(`save-${editor.provider}`);
    setMessage(null);
    try {
      const path = editor.provider === 'tiktok' ? '/api/integrations/config/tiktok' : '/api/integrations/google/config/google_ads';
      await readJson(path, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(editor.values) });
      setEditor(null);
      setMessage({ type: 'ok', text: editor.provider === 'tiktok' ? 'TikTok Ads сохранён' : 'Google Ads сохранён' });
      await load();
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'Не удалось сохранить подключение' });
    } finally {
      setBusy(null);
    }
  };

  const disconnect = async (provider: 'meta' | 'tiktok' | 'google_ads') => {
    if (!window.confirm('Отключить рекламную платформу? Сохранённая аналитика не удаляется.')) return;
    setBusy(`delete-${provider}`);
    setMessage(null);
    try {
      const path = provider === 'google_ads' ? '/api/integrations/google/config/google_ads' : `/api/integrations/config/${provider}`;
      await readJson(path, { method: 'DELETE' });
      setMessage({ type: 'ok', text: 'Подключение удалено' });
      await load();
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'Не удалось отключить платформу' });
    } finally {
      setBusy(null);
    }
  };

  const syncGoogle = async () => {
    setBusy('sync-google_ads');
    setMessage(null);
    try {
      const result = await readJson<{ fetched?: number; written?: number }>('/api/integrations/google/sync/google_ads', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ days: 30 }),
      });
      setMessage({ type: 'ok', text: `Google Ads: получено ${result.fetched || 0}, записано ${result.written || 0}` });
      await load();
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'Не удалось синхронизировать Google Ads' });
    } finally {
      setBusy(null);
    }
  };

  const cards = providers.map((provider) => {
    const config = configMap.get(provider.id);
    const status = provider.id === 'yandex' ? 'planned' : stateOf(config);
    const run = latestRun(provider.id === 'google_ads' ? 'google_ads' : provider.id, runs);
    return { provider, config, status, run, count: accountCount(provider.id, config) };
  });

  return <section className="ad-accounts-center">
    <header className="ad-accounts-center-head">
      <div>
        <span>ADVERTISING ACCOUNTS CENTER</span>
        <h2>Рекламные платформы</h2>
        <p>Подключения, рекламные кабинеты и состояние синхронизации — перед таблицей кампаний.</p>
      </div>
      <button type="button" className="ad-accounts-refresh" onClick={() => void load()} disabled={loading}><RefreshCw size={15} className={loading ? 'spin' : ''}/>{loading ? 'Проверяем…' : 'Обновить'}</button>
    </header>

    {message && <div className={`ad-accounts-message ${message.type}`}><span>{message.type === 'ok' ? <Check size={16}/> : <AlertTriangle size={16}/>}</span>{message.text}</div>}
    {!isAdmin && <div className="ad-accounts-note"><ShieldCheck size={17}/><span>Состояние рекламных данных доступно команде, а подключение и секретные настройки — только администратору.</span></div>}

    <div className="ad-accounts-grid">
      {cards.map(({ provider, config, status, run, count }) => <article className={`ad-account-card ad-account-card--${status}`} key={provider.id}>
        <div className="ad-account-card-top">
          <div className={`ad-account-mark ad-account-mark--${provider.id}`}>{provider.mark}</div>
          <span className={`ad-account-state ad-account-state--${status}`}><CircleDot size={12}/>{statusLabel(status)}</span>
        </div>
        <div className="ad-account-copy"><h3>{provider.name}</h3><p>{provider.subtitle}</p><small>{provider.description}</small></div>
        <div className="ad-account-facts">
          <div><span>Кабинеты</span><b>{count}</b></div>
          <div><span>Последняя проверка</span><b>{formatDate(config?.lastVerifiedAt || run?.finished_at || run?.started_at)}</b></div>
        </div>
        {config?.lastError && <div className="ad-account-error"><AlertTriangle size={14}/>{config.lastError}</div>}
        {run?.status === 'failed' && run.error && !config?.lastError && <div className="ad-account-error"><AlertTriangle size={14}/>{run.error}</div>}
        <footer>
          {!isAdmin ? <span className="ad-account-readonly">Только просмотр</span> : provider.id === 'meta' ? <>
            <button type="button" className="ad-account-primary" onClick={() => void connectMeta()} disabled={busy === 'meta-connect'}>{busy === 'meta-connect' ? <LoaderCircle className="spin" size={15}/> : <Plug size={15}/>} {status === 'not_connected' ? 'Подключить Meta' : 'Переподключить'}</button>
            {config?.configured && <button type="button" className="ad-account-icon-button danger" aria-label="Отключить Meta" onClick={() => void disconnect('meta')} disabled={busy === 'delete-meta'}><Trash2 size={15}/></button>}
          </> : provider.id === 'tiktok' ? <>
            <button type="button" className="ad-account-primary" onClick={() => openEditor('tiktok')}><Settings2 size={15}/>{config?.configured ? 'Настроить' : 'Подключить'}</button>
            {config?.configured && <button type="button" className="ad-account-icon-button danger" aria-label="Отключить TikTok" onClick={() => void disconnect('tiktok')} disabled={busy === 'delete-tiktok'}><Trash2 size={15}/></button>}
          </> : provider.id === 'google_ads' ? <>
            <button type="button" className="ad-account-primary" onClick={() => openEditor('google_ads')}><Settings2 size={15}/>{config?.configured ? 'Настроить' : 'Подключить'}</button>
            {config?.configured && <button type="button" className="ad-account-icon-button" aria-label="Синхронизировать Google Ads" onClick={() => void syncGoogle()} disabled={busy === 'sync-google_ads'}>{busy === 'sync-google_ads' ? <LoaderCircle className="spin" size={15}/> : <RefreshCw size={15}/>}</button>}
            {config?.configured && <button type="button" className="ad-account-icon-button danger" aria-label="Отключить Google Ads" onClick={() => void disconnect('google_ads')} disabled={busy === 'delete-google_ads'}><Trash2 size={15}/></button>}
          </> : <button type="button" className="ad-account-secondary" disabled>Следующий коннектор <ChevronRight size={15}/></button>}
        </footer>
      </article>)}
    </div>

    <div className="ad-accounts-security"><KeyRound size={16}/><span>Токены и секреты не возвращаются в браузер после сохранения. В интерфейсе отображаются только безопасные summary-поля подключения.</span></div>

    {editor && <ConnectionEditor editor={editor} setEditor={setEditor} config={configMap.get(editor.provider)} busy={Boolean(busy)} onSave={() => void saveEditor()}/>} 
  </section>;
}

function ConnectionEditor({editor,setEditor,config,busy,onSave}:{editor:EditorState;setEditor:(value:EditorState|null)=>void;config?:CredentialSummary;busy:boolean;onSave:()=>void}) {
  const update = (name: string, value: string) => setEditor({ ...editor, values: { ...editor.values, [name]: value } });
  const google = editor.provider === 'google_ads';
  return <div className="ad-account-modal-backdrop" onClick={() => setEditor(null)}>
    <section className="ad-account-modal" onClick={(event) => event.stopPropagation()}>
      <header><div><span>{google ? 'GOOGLE ADS' : 'TIKTOK ADS'}</span><h3>{config?.configured ? 'Настройки подключения' : 'Подключить рекламную платформу'}</h3><p>Секретные поля можно оставить пустыми при редактировании — сохранённое значение останется прежним.</p></div><button type="button" onClick={() => setEditor(null)}><X size={18}/></button></header>
      <div className="ad-account-modal-form">
        {google ? <>
          <label>OAuth Client ID<input value={editor.values.clientId || ''} onChange={(e) => update('clientId', e.target.value)} placeholder="Google OAuth Client ID"/></label>
          <label>OAuth Client Secret<input type="password" value={editor.values.clientSecret || ''} onChange={(e) => update('clientSecret', e.target.value)} placeholder={config?.secretFields?.clientSecret ? 'Сохранён · оставить пустым' : 'Client secret'}/></label>
          <label>Refresh token<input type="password" value={editor.values.refreshToken || ''} onChange={(e) => update('refreshToken', e.target.value)} placeholder={config?.secretFields?.refreshToken ? 'Сохранён · оставить пустым' : 'Refresh token'}/></label>
          <label>Developer token<input type="password" value={editor.values.developerToken || ''} onChange={(e) => update('developerToken', e.target.value)} placeholder={config?.secretFields?.developerToken ? 'Сохранён · оставить пустым' : 'Developer token'}/></label>
          <label className="wide">Customer IDs<input value={editor.values.customerIds || ''} onChange={(e) => update('customerIds', e.target.value)} placeholder="1234567890, 9876543210"/></label>
          <label>Manager / Login Customer ID<input value={editor.values.loginCustomerId || ''} onChange={(e) => update('loginCustomerId', e.target.value)} placeholder="Необязательно"/></label>
          <label>API version<input value={editor.values.apiVersion || ''} onChange={(e) => update('apiVersion', e.target.value)} placeholder="v25"/></label>
        </> : <>
          <label className="wide">TikTok access token<input type="password" value={editor.values.accessToken || ''} onChange={(e) => update('accessToken', e.target.value)} placeholder={config?.secretFields?.accessToken ? 'Сохранён · оставить пустым' : 'TikTok Business API token'}/></label>
          <label className="wide">Advertiser IDs<input value={editor.values.advertiserIds || ''} onChange={(e) => update('advertiserIds', e.target.value)} placeholder="123456789, 987654321"/></label>
        </>}
      </div>
      <footer><button type="button" className="ad-account-secondary" onClick={() => setEditor(null)}>Отмена</button><button type="button" className="ad-account-primary" onClick={onSave} disabled={busy}>{busy ? <LoaderCircle className="spin" size={15}/> : <ShieldCheck size={15}/>}Сохранить защищённо</button></footer>
    </section>
  </div>;
}
