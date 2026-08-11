import { useEffect, useMemo, useState } from 'react';
import { Activity, DatabaseZap, LoaderCircle, RefreshCw, Send, ShieldCheck, Unplug } from 'lucide-react';
import { useAuth } from './AuthGate';
import '../mis-integration.css';

type Credential = {
  configured?: boolean;
  status?: string;
  values?: { baseUrl?: string; apiKeyHeader?: string; healthPath?: string };
  lastVerifiedAt?: string | null;
  lastError?: string | null;
  updatedAt?: string | null;
};

type Settings = {
  enabled?: boolean;
  pull_enabled?: boolean;
  push_appointments?: boolean;
  source_of_truth?: string;
  sync_branches?: boolean;
  sync_doctors?: boolean;
  sync_schedules?: boolean;
  sync_patients?: boolean;
  sync_appointments?: boolean;
  last_sync_at?: string | null;
  last_success_at?: string | null;
  last_error?: string | null;
};

type SyncRun = {
  id: string;
  mode?: string;
  status?: string;
  counts?: Record<string, number>;
  error?: string | null;
  started_at?: string;
  finished_at?: string | null;
};

type StatusShape = {
  credential: Credential;
  settings: Settings;
  runs: SyncRun[];
  queue: Record<string, number>;
};

const defaults: Settings = {
  enabled: false,
  pull_enabled: true,
  push_appointments: false,
  source_of_truth: 'mis',
  sync_branches: true,
  sync_doctors: true,
  sync_schedules: true,
  sync_patients: true,
  sync_appointments: true,
};

const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);
const formatDate = (value?: string | null) => value ? new Date(value).toLocaleString('ru-RU') : '—';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { 'content-type': 'application/json', ...init?.headers },
  });
  const raw = await response.text();
  let payload: unknown = {};
  try { payload = raw ? JSON.parse(raw) : {}; } catch { payload = { error: raw }; }
  if (!response.ok) throw new Error((payload as { error?: string }).error || `HTTP ${response.status}`);
  return payload as T;
}

export default function MisIntegrationPanel() {
  const { user } = useAuth();
  const isAdmin = user.role === 'administrator';
  const [status, setStatus] = useState<StatusShape | null>(null);
  const [settings, setSettings] = useState<Settings>(defaults);
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [apiKeyHeader, setApiKeyHeader] = useState('Authorization');
  const [healthPath, setHealthPath] = useState('/health');
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');

  const load = async () => {
    setBusy((current) => current || 'load');
    try {
      const result = await request<StatusShape>('/api/integrations/mis/status');
      setStatus(result);
      setSettings({ ...defaults, ...result.settings });
      setBaseUrl(result.credential?.values?.baseUrl || '');
      setApiKeyHeader(result.credential?.values?.apiKeyHeader || 'Authorization');
      setHealthPath(result.credential?.values?.healthPath || '/health');
    } catch (error) {
      setMessage(errorText(error));
    } finally {
      setBusy((current) => current === 'load' ? '' : current);
    }
  };

  useEffect(() => { void load(); }, [user.companyId]);

  const act = async (key: string, task: () => Promise<unknown>, success: string) => {
    if (!isAdmin) return;
    setBusy(key);
    setMessage('');
    try {
      await task();
      setMessage(success);
      await load();
    } catch (error) {
      setMessage(errorText(error));
    } finally {
      setBusy('');
    }
  };

  const saveConnection = () => act('save', async () => {
    await request('/api/integrations/mis/config', {
      method: 'PUT',
      body: JSON.stringify({ baseUrl, apiKey, apiKeyHeader, healthPath }),
    });
    setApiKey('');
  }, 'Реквизиты МИС сохранены для выбранной клиники.');

  const saveSettings = () => act('settings', () => request('/api/integrations/mis/settings', {
    method: 'PUT',
    body: JSON.stringify(settings),
  }), 'Настройки синхронизации сохранены.');

  const connected = status?.credential?.status === 'connected';
  const configured = Boolean(status?.credential?.configured);
  const pending = Number(status?.queue?.pending || 0);
  const failed = Number(status?.queue?.failed || 0);
  const latestRuns = useMemo(() => (status?.runs || []).slice(0, 5), [status?.runs]);

  const toggle = (key: keyof Settings, label: string, description: string) => (
    <label className="mis-switch" key={String(key)}>
      <input
        type="checkbox"
        checked={Boolean(settings[key])}
        disabled={!isAdmin || Boolean(busy)}
        onChange={(event) => setSettings((current) => ({ ...current, [key]: event.target.checked }))}
      />
      <span className="mis-switch__control" />
      <span><strong>{label}</strong><small>{description}</small></span>
    </label>
  );

  return <section className="mis-panel">
    <header className="mis-panel__head">
      <div className="mis-panel__brand">
        <span className="mis-panel__icon"><DatabaseZap size={23}/></span>
        <div>
          <small>MIS INTEGRATION LAYER</small>
          <h2>МИС / Клиническая система</h2>
          <p>МИС — источник клинических данных. IMDS нормализует филиалы, врачей, расписание, пациентов и записи для Phone Workspace, WhatsApp и Growth Engine.</p>
        </div>
      </div>
      <div className={`mis-state ${connected ? 'is-connected' : configured ? 'is-configured' : ''}`}>
        <span />
        {connected ? 'Подключено' : configured ? 'Настроено' : 'Не подключено'}
      </div>
    </header>

    <div className="mis-metrics">
      <article><small>Source of Truth</small><strong>МИС</strong><span>Клинические данные</span></article>
      <article><small>Последняя успешная синхронизация</small><strong>{formatDate(settings.last_success_at)}</strong><span>{settings.last_error || 'Без ошибок'}</span></article>
      <article><small>Исходящая очередь</small><strong>{pending}</strong><span>{failed ? `${failed} с ошибкой` : 'Ошибок нет'}</span></article>
    </div>

    {message && <div className="mis-message">{message}</div>}

    <div className="mis-grid">
      <div className="mis-card">
        <div className="mis-card__title"><ShieldCheck size={18}/><div><strong>Подключение</strong><small>Generic REST adapter</small></div></div>
        <label>Base URL<input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://mis.example.kz/api" disabled={!isAdmin || Boolean(busy)}/></label>
        <div className="mis-form-row">
          <label>API key / token<input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={configured ? '•••••••• (оставьте пустым, чтобы не менять)' : 'Token'} disabled={!isAdmin || Boolean(busy)}/></label>
          <label>Header<input value={apiKeyHeader} onChange={(e) => setApiKeyHeader(e.target.value)} placeholder="Authorization" disabled={!isAdmin || Boolean(busy)}/></label>
        </div>
        <label>Health path<input value={healthPath} onChange={(e) => setHealthPath(e.target.value)} placeholder="/health" disabled={!isAdmin || Boolean(busy)}/></label>
        <div className="mis-actions">
          <button onClick={saveConnection} disabled={!isAdmin || Boolean(busy) || !baseUrl}><LoaderCircle className={busy === 'save' ? 'spin' : ''} size={16}/>Сохранить</button>
          <button className="secondary" onClick={() => act('test', () => request('/api/integrations/mis/test', { method: 'POST' }), 'Соединение с МИС подтверждено.')} disabled={!isAdmin || Boolean(busy) || !configured}><Activity size={16}/>Проверить</button>
          <button className="danger" onClick={() => act('disconnect', () => request('/api/integrations/mis/config', { method: 'DELETE' }), 'МИС отключена от выбранной клиники.')} disabled={!isAdmin || Boolean(busy) || !configured}><Unplug size={16}/>Отключить</button>
        </div>
        <div className="mis-connection-meta">
          <span>Последняя проверка: {formatDate(status?.credential?.lastVerifiedAt)}</span>
          {status?.credential?.lastError && <span className="error">{status.credential.lastError}</span>}
        </div>
      </div>

      <div className="mis-card">
        <div className="mis-card__title"><RefreshCw size={18}/><div><strong>Синхронизация</strong><small>Tenant-safe для выбранной клиники</small></div></div>
        <div className="mis-switches">
          {toggle('enabled', 'Интеграция активна', 'Разрешить обмен данными с МИС')}
          {toggle('pull_enabled', 'Импорт из МИС', 'Использовать МИС как источник данных')}
          {toggle('sync_branches', 'Филиалы', 'Импортировать клиники / филиалы')}
          {toggle('sync_doctors', 'Врачи', 'Импортировать врачей и специализации')}
          {toggle('sync_schedules', 'Расписание', 'Импортировать рабочие интервалы врачей')}
          {toggle('sync_patients', 'Пациенты', 'Хранить в отдельном clinic patient master')}
          {toggle('sync_appointments', 'Записи', 'Синхронизировать приёмы и статусы')}
          {toggle('push_appointments', 'Отправлять записи обратно', 'Новые/изменённые записи IMDS → МИС')}
        </div>
        <div className="mis-actions">
          <button onClick={saveSettings} disabled={!isAdmin || Boolean(busy)}><ShieldCheck size={16}/>Сохранить настройки</button>
          <button className="secondary" onClick={() => act('sync', () => request('/api/integrations/mis/sync', { method: 'POST' }), 'Синхронизация МИС выполнена.')} disabled={!isAdmin || Boolean(busy) || !configured || !settings.enabled}><RefreshCw className={busy === 'sync' ? 'spin' : ''} size={16}/>Синхронизировать</button>
          <button className="secondary" onClick={() => act('push', () => request('/api/integrations/mis/push', { method: 'POST' }), 'Исходящая очередь обработана.')} disabled={!isAdmin || Boolean(busy) || !configured || !settings.push_appointments}><Send size={16}/>Отправить очередь</button>
        </div>
      </div>
    </div>

    <div className="mis-card mis-runs">
      <div className="mis-card__title"><Activity size={18}/><div><strong>Последние синхронизации</strong><small>Контроль импорта и ошибок</small></div></div>
      {!latestRuns.length ? <div className="mis-empty">Синхронизаций пока не было.</div> : <div className="mis-run-list">
        {latestRuns.map((run) => <article key={run.id}>
          <div><strong>{run.mode === 'push' ? 'IMDS → МИС' : 'МИС → IMDS'}</strong><small>{formatDate(run.started_at)}</small></div>
          <span className={`mis-run-status is-${run.status || 'unknown'}`}>{run.status || 'unknown'}</span>
          <div className="mis-run-counts">{Object.entries(run.counts || {}).map(([key, value]) => <span key={key}>{key}: <b>{value}</b></span>)}</div>
          {run.error && <p>{run.error}</p>}
        </article>)}
      </div>}
    </div>

    {!isAdmin && <div className="mis-readonly">Подключение и изменение настроек МИС доступны администратору. Статус интеграции доступен для просмотра.</div>}
  </section>;
}
