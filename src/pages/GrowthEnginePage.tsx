import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Clock3, Headphones, MessageCircle, PlayCircle, RefreshCw, RotateCcw, Send, Target, TrendingUp } from 'lucide-react';
import { useAuth } from '../components/AuthGate';
import '../strategic-platform.css';

type Destination = { provider: string; external_destination_id: string; enabled: boolean; config?: Record<string, unknown> };
type SpeedToLead = { slaSeconds: number; staleAfterHours: number; leads: number; respondedLeads: number; unansweredLeads: number; staleUnansweredLeads: number; withinSla: number; breached: number; averageSeconds: number | null; medianSeconds: number | null };
type CallIntelligence = { calls: number; completedCalls: number; analyzableCalls: number; analyzedCalls: number; failedAnalyses: number; averageQualityScore: number | null; detectedLostCalls: number; appointments: number };
type GrowthOverview = {
  funnel: Record<string, number>;
  journeyEvents: number;
  openLostOpportunities: number;
  recoverableValue: number;
  pendingConversions: number;
  sentConversions: number;
  skippedConversions: number;
  destinations?: Destination[];
  speedToLead?: SpeedToLead;
  callIntelligence?: CallIntelligence;
};

type JourneyEvent = { id: string; lead_id?: string | null; event_type: string; occurred_at: string; channel?: string | null; source?: string | null; campaign_id?: string | null; value?: number; currency?: string; metadata?: Record<string, unknown> };
type LostOpportunity = { id: string; lead_id?: string | null; call_id?: string | null; status: 'open' | 'recovering' | 'recovered' | 'lost'; reason: string; estimated_value: number; currency: string; owner_name?: string | null; next_action?: string | null; next_action_at?: string | null; detected_at: string; recovered_at?: string | null };
type ConversionEvent = { id: string; lead_id?: string | null; event_name: string; occurred_at: string; destination: string; value: number; currency: string; sync_status: string; attempts: number; last_error?: string | null };
type RecoverySettings = {
  enabled: boolean;
  create_tasks: boolean;
  stale_lead_enabled: boolean;
  lost_opportunity_enabled: boolean;
  appointment_recovery_enabled: boolean;
  no_show_grace_minutes: number;
  whatsapp_enabled: boolean;
  lost_task_delay_minutes: number;
  whatsapp_template_name?: string | null;
  whatsapp_template_language: string;
  whatsapp_template_parameters?: string[];
};
type RecoveryAction = {
  id: string;
  lead_id?: string | null;
  lost_opportunity_id?: string | null;
  appointment_id?: string | null;
  trigger_type: 'stale_lead' | 'lost_opportunity' | 'appointment_no_show' | 'appointment_cancelled' | 'appointment_unconfirmed';
  action_type: 'task' | 'whatsapp_template';
  status: 'pending' | 'sent' | 'completed' | 'skipped' | 'failed';
  scheduled_at: string;
  executed_at?: string | null;
  template_name?: string | null;
  last_error?: string | null;
  created_at: string;
};
type RecoveryRun = {
  enabled: boolean;
  scanned: number;
  eligible?: number;
  tasksCreated: number;
  whatsappQueued: number;
  appointmentNoShowCandidates?: number;
  appointmentUnconfirmedCandidates?: number;
  message?: string;
};

const money = (value: number, currency = 'KZT') => new Intl.NumberFormat('ru-RU', { style: 'currency', currency, maximumFractionDigits: 0 }).format(Number(value || 0));
const dateTime = (value?: string | null) => value ? new Date(value).toLocaleString('ru-RU') : '—';
const responseTime = (seconds?: number | null) => {
  if (seconds == null || !Number.isFinite(Number(seconds))) return '—';
  const value = Math.max(0, Math.round(Number(seconds)));
  if (value < 60) return `${value} сек`;
  if (value < 3600) return `${Math.floor(value / 60)} мин ${value % 60} сек`;
  return `${Math.floor(value / 3600)} ч ${Math.floor((value % 3600) / 60)} мин`;
};
const percent = (value: number, total: number) => total ? `${((value / total) * 100).toFixed(0)}%` : '—';
const labels: Record<string, string> = { lead_created: 'Лид', first_contact: 'Первый контакт', first_response: 'Первый ответ клиники', qualified: 'Целевой', call: 'Звонок', conversation: 'Диалог', message: 'Сообщение', appointment_booked: 'Запись', arrived: 'Приход', deal_created: 'Сделка', rejected: 'Отказ', sale: 'Продажа', lead: 'Lead', qualified_lead: 'Qualified Lead', purchase: 'Purchase' };
const recoveryTriggerLabel: Record<string, string> = {
  stale_lead: 'Лид без ответа',
  lost_opportunity: 'Потерянная возможность',
  appointment_no_show: 'Подтверждённая неявка',
  appointment_cancelled: 'Отменённый визит',
  appointment_unconfirmed: 'Факт визита не подтверждён',
};

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...init, headers: { 'content-type': 'application/json', ...init?.headers } });
  const body = await response.text();
  if (!response.ok) {
    try { throw new Error((JSON.parse(body) as { error?: string }).error || body || `HTTP ${response.status}`); }
    catch (error) { if (error instanceof SyntaxError) throw new Error(body || `HTTP ${response.status}`); throw error; }
  }
  return body ? JSON.parse(body) as T : (null as T);
}

export default function GrowthEnginePage() {
  const { user } = useAuth();
  const isAdmin = user.role === 'administrator';
  const [overview, setOverview] = useState<GrowthOverview | null>(null);
  const [journey, setJourney] = useState<JourneyEvent[]>([]);
  const [lost, setLost] = useState<LostOpportunity[]>([]);
  const [conversions, setConversions] = useState<ConversionEvent[]>([]);
  const [recoverySettings, setRecoverySettings] = useState<RecoverySettings | null>(null);
  const [recoveryActions, setRecoveryActions] = useState<RecoveryAction[]>([]);
  const [lastRecoveryRun, setLastRecoveryRun] = useState<RecoveryRun | null>(null);
  const [metaDatasetId, setMetaDatasetId] = useState('');
  const [slaSeconds, setSlaSeconds] = useState(300);
  const [staleAfterHours, setStaleAfterHours] = useState(24);
  const [loading, setLoading] = useState(true);
  const [syncingMeta, setSyncingMeta] = useState(false);
  const [savingResponseSettings, setSavingResponseSettings] = useState(false);
  const [savingRecovery, setSavingRecovery] = useState(false);
  const [runningRecovery, setRunningRecovery] = useState(false);
  const [sendingRecoveryId, setSendingRecoveryId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const load = async () => {
    setLoading(true); setMessage(null);
    try {
      const [summary, journeyRows, lostRows, conversionRows, recoveryCfg, recoveryRows] = await Promise.all([
        api<GrowthOverview>('/api/growth/overview'),
        api<JourneyEvent[]>('/api/growth/journey?limit=100'),
        api<LostOpportunity[]>('/api/growth/lost-opportunities?limit=100'),
        api<ConversionEvent[]>('/api/growth/conversions?limit=100'),
        api<RecoverySettings>('/api/growth/recovery/settings'),
        api<RecoveryAction[]>('/api/growth/recovery/actions?limit=100'),
      ]);
      setOverview(summary); setJourney(journeyRows); setLost(lostRows); setConversions(conversionRows);
      setRecoverySettings(recoveryCfg); setRecoveryActions(recoveryRows);
      const meta = summary.destinations?.find((item) => item.provider === 'meta');
      setMetaDatasetId(meta?.external_destination_id || '');
      if (summary.speedToLead) {
        setSlaSeconds(summary.speedToLead.slaSeconds);
        setStaleAfterHours(summary.speedToLead.staleAfterHours);
      }
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Ошибка загрузки Growth Engine'); }
    finally { setLoading(false); }
  };

  useEffect(() => { void load(); }, []);

  const funnel = useMemo(() => [
    ['lead_created', 'Лиды'], ['qualified', 'Целевые'], ['appointment_booked', 'Записи'], ['arrived', 'Пришли'], ['sale', 'Продажи'],
  ].map(([key, label]) => ({ key, label, value: overview?.funnel[key] || 0 })), [overview]);
  const openLost = lost.filter((item) => item.status === 'open' || item.status === 'recovering');
  const pending = conversions.filter((item) => ['pending', 'processing', 'failed'].includes(item.sync_status));
  const pendingRecovery = recoveryActions.filter((item) => item.status === 'pending');
  const failedRecovery = recoveryActions.filter((item) => item.status === 'failed');
  const recoveryTasks = recoveryActions.filter((item) => item.action_type === 'task' && item.status === 'completed');
  const recoverySent = recoveryActions.filter((item) => item.action_type === 'whatsapp_template' && item.status === 'sent');
  const noShowRecovery = recoveryActions.filter((item) => item.trigger_type === 'appointment_no_show');
  const unconfirmedRecovery = recoveryActions.filter((item) => item.trigger_type === 'appointment_unconfirmed');
  const speed = overview?.speedToLead;
  const calls = overview?.callIntelligence;

  const updateOpportunity = async (id: string, status: LostOpportunity['status']) => {
    try { await api(`/api/growth/lost-opportunities/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ status }) }); await load(); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Не удалось обновить возможность'); }
  };

  const saveResponseSettings = async () => {
    setSavingResponseSettings(true); setMessage(null); setSuccess(null);
    try {
      await api('/api/growth/response-settings', { method: 'PUT', body: JSON.stringify({ slaSeconds, staleAfterHours }) });
      setSuccess('SLA первого ответа сохранён для текущей клиники.');
      await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Не удалось сохранить SLA'); }
    finally { setSavingResponseSettings(false); }
  };

  const saveRecoverySettings = async () => {
    if (!recoverySettings) return;
    setSavingRecovery(true); setMessage(null); setSuccess(null);
    try {
      await api('/api/growth/recovery/settings', {
        method: 'PUT',
        body: JSON.stringify({
          enabled: recoverySettings.enabled,
          createTasks: recoverySettings.create_tasks,
          staleLeadEnabled: recoverySettings.stale_lead_enabled,
          lostOpportunityEnabled: recoverySettings.lost_opportunity_enabled,
          appointmentRecoveryEnabled: recoverySettings.appointment_recovery_enabled,
          noShowGraceMinutes: recoverySettings.no_show_grace_minutes,
          whatsappEnabled: recoverySettings.whatsapp_enabled,
          lostTaskDelayMinutes: recoverySettings.lost_task_delay_minutes,
          whatsappTemplateName: recoverySettings.whatsapp_template_name || '',
          whatsappTemplateLanguage: recoverySettings.whatsapp_template_language || 'ru',
          whatsappTemplateParameters: recoverySettings.whatsapp_template_parameters || [],
        }),
      });
      setSuccess('Настройки Recovery Engine сохранены для текущей клиники.');
      await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Не удалось сохранить Recovery Engine'); }
    finally { setSavingRecovery(false); }
  };

  const runRecovery = async () => {
    setRunningRecovery(true); setMessage(null); setSuccess(null);
    try {
      const result = await api<RecoveryRun>('/api/growth/recovery/run', { method: 'POST', body: '{}' });
      setLastRecoveryRun(result);
      setSuccess(result.enabled
        ? `Recovery: проверено ${result.scanned}, кандидатов ${result.eligible || 0}, задач ${result.tasksCreated}, WhatsApp в очереди ${result.whatsappQueued}, NO_SHOW ${result.appointmentNoShowCandidates || 0}, неподтверждённых визитов ${result.appointmentUnconfirmedCandidates || 0}.`
        : (result.message || 'Recovery Engine выключен.'));
      await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Ошибка Recovery Engine'); }
    finally { setRunningRecovery(false); }
  };

  const sendRecovery = async (id: string) => {
    setSendingRecoveryId(id); setMessage(null); setSuccess(null);
    try {
      await api(`/api/growth/recovery/actions/${encodeURIComponent(id)}/send`, { method: 'POST', body: '{}' });
      setSuccess('WhatsApp follow-up отправлен через одобренный WABA-шаблон.');
      await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : 'WhatsApp follow-up не отправлен'); }
    finally { setSendingRecoveryId(null); }
  };

  const saveMetaDestination = async () => {
    setMessage(null); setSuccess(null);
    try {
      await api('/api/growth/destinations', { method: 'PUT', body: JSON.stringify({ provider: 'meta', externalDestinationId: metaDatasetId, enabled: true }) });
      setSuccess('Meta Dataset / Pixel ID сохранён для текущей клиники.');
      await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Не удалось сохранить Meta destination'); }
  };

  const syncMeta = async () => {
    setSyncingMeta(true); setMessage(null); setSuccess(null);
    try {
      const result = await api<{ processed: number; sent: number; failed: number; skipped: number }>('/api/growth/conversions/meta/sync', { method: 'POST', body: JSON.stringify({ limit: 50 }) });
      setSuccess(`Meta CAPI: обработано ${result.processed}, отправлено ${result.sent}, ошибок ${result.failed}, пропущено ${result.skipped}.`);
      await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Ошибка Meta CAPI'); }
    finally { setSyncingMeta(false); }
  };

  return <div className="strategic-page">
    <div className="strategic-head">
      <div><span>IMDS / Healthcare Growth OS</span><h1>Growth Engine</h1><p>Единый контур от первого рекламного касания до первого ответа клиники, записи, прихода, продажи и возврата потерянной выручки.</p></div>
      <button className="button" type="button" onClick={() => void load()} disabled={loading}><RefreshCw size={15}/>{loading ? 'Обновление…' : 'Обновить'}</button>
    </div>
    {message && <div className="alert alert--error">{message}</div>}
    {success && <div className="alert">{success}</div>}

    <div className="strategic-status">
      <article><span>Медиана первого ответа</span><strong>{responseTime(speed?.medianSeconds)}</strong></article>
      <article><span>Ответили в SLA</span><strong>{speed ? percent(speed.withinSla, speed.respondedLeads) : '—'}</strong><small>{speed ? `${speed.withinSla} из ${speed.respondedLeads}` : 'Нет данных'}</small></article>
      <article><span>Без ответа</span><strong>{speed?.unansweredLeads ?? 0}</strong><small>{speed?.staleUnansweredLeads ? `просрочено: ${speed.staleUnansweredLeads}` : 'просроченных нет'}</small></article>
      <article><span>Recovery очередь</span><strong>{pendingRecovery.length}</strong><small>{failedRecovery.length ? `ошибок: ${failedRecovery.length}` : recoverySettings?.enabled ? 'движок включён' : 'движок выключен'}</small></article>
      <article><span>Открытых потерь</span><strong>{overview?.openLostOpportunities || 0}</strong></article>
      <article><span>Потенциально вернуть</span><strong>{money(overview?.recoverableValue || 0)}</strong></article>
    </div>

    <div className="strategic-grid strategic-grid--equal">
      <section className="panel">
        <div className="google-card-head"><div><h2>Speed-to-Lead</h2><p>Первый фактический ответ сотрудника: исходящее сообщение или завершённый звонок. Входящий контакт пациента не считается ответом клиники.</p></div><Clock3 size={20}/></div>
        <div className="customer-facts">
          <div><span>Среднее время</span><b>{responseTime(speed?.averageSeconds)}</b></div>
          <div><span>SLA</span><b>{responseTime(speed?.slaSeconds)}</b></div>
          <div><span>Нарушили SLA</span><b>{speed?.breached ?? 0}</b></div>
          <div><span>Просрочены без ответа</span><b>{speed?.staleUnansweredLeads ?? 0}</b></div>
        </div>
        {isAdmin && <div className="strategic-note" style={{ display: 'grid', gap: 10 }}>
          <strong>SLA текущей клиники</strong>
          <div className="strategic-actions" style={{ alignItems: 'center' }}>
            <label>Ответ за <input type="number" min={30} max={86400} value={slaSeconds} onChange={(event) => setSlaSeconds(Number(event.target.value))} style={{ width: 110 }} /> сек</label>
            <label>Просрочка без ответа <input type="number" min={1} max={720} value={staleAfterHours} onChange={(event) => setStaleAfterHours(Number(event.target.value))} style={{ width: 90 }} /> ч</label>
            <button className="button" type="button" onClick={() => void saveResponseSettings()} disabled={savingResponseSettings}>{savingResponseSettings ? 'Сохранение…' : 'Сохранить SLA'}</button>
          </div>
        </div>}
      </section>

      <section className="panel">
        <div className="google-card-head"><div><h2>AI Call Intelligence</h2><p>AI заполняет существующую карточку звонка только по фактическому транскрипту и автоматически передаёт подтверждённую причину потери в Lost Revenue.</p></div><Headphones size={20}/></div>
        <div className="customer-facts">
          <div><span>Завершённые</span><b>{calls?.completedCalls ?? 0}</b></div>
          <div><span>С транскриптом</span><b>{calls?.analyzableCalls ?? 0}</b></div>
          <div><span>Средняя AI-оценка</span><b>{calls?.averageQualityScore == null ? '—' : `${calls.averageQualityScore.toFixed(1)}/100`}</b></div>
          <div><span>AI выявил потери</span><b>{calls?.detectedLostCalls ?? 0}</b></div>
        </div>
        <div className="strategic-note">На странице «Звонки» завершённый разговор можно получить из Zadarma, расшифровать и сразу передать в AI Call Intelligence. PENDING-звонки и звонки без реальной записи не оцениваются.</div>
      </section>
    </div>

    <section className="panel">
      <div className="google-card-head"><div><h2>Recovery Engine</h2><p>Возвращает просроченные лиды, потерянные возможности и пропущенные визиты в работу. Неявка фиксируется только по явному статусу NO_SHOW.</p></div><RotateCcw size={20}/></div>
      <div className="customer-facts">
        <div><span>CRM-задач создано</span><b>{recoveryTasks.length}</b></div>
        <div><span>Подтверждённые NO_SHOW</span><b>{noShowRecovery.length}</b></div>
        <div><span>Визит не подтверждён</span><b>{unconfirmedRecovery.length}</b></div>
        <div><span>Ошибки</span><b>{failedRecovery.length}</b></div>
      </div>
      {lastRecoveryRun && lastRecoveryRun.enabled && <div className="strategic-note" style={{ marginTop: 12 }}>Последний поиск: NO_SHOW {lastRecoveryRun.appointmentNoShowCandidates || 0} · требуют проверки визита {lastRecoveryRun.appointmentUnconfirmedCandidates || 0} · создано задач {lastRecoveryRun.tasksCreated}.</div>}
      <div className="strategic-actions" style={{ marginTop: 12 }}>
        <button className="button" type="button" onClick={() => void runRecovery()} disabled={runningRecovery || !recoverySettings?.enabled}><PlayCircle size={14}/>{runningRecovery ? 'Проверка…' : 'Запустить Recovery'}</button>
      </div>
      {isAdmin && recoverySettings && <div className="strategic-note" style={{ display: 'grid', gap: 10, marginTop: 12 }}>
        <strong>Настройки текущей клиники</strong>
        <div className="strategic-actions" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
          <label><input type="checkbox" checked={recoverySettings.enabled} onChange={(event) => setRecoverySettings({ ...recoverySettings, enabled: event.target.checked })} /> Recovery включён</label>
          <label><input type="checkbox" checked={recoverySettings.create_tasks} onChange={(event) => setRecoverySettings({ ...recoverySettings, create_tasks: event.target.checked })} /> Создавать CRM-задачи</label>
          <label><input type="checkbox" checked={recoverySettings.stale_lead_enabled} onChange={(event) => setRecoverySettings({ ...recoverySettings, stale_lead_enabled: event.target.checked })} /> Лиды без ответа</label>
          <label><input type="checkbox" checked={recoverySettings.lost_opportunity_enabled} onChange={(event) => setRecoverySettings({ ...recoverySettings, lost_opportunity_enabled: event.target.checked })} /> Потерянные возможности</label>
          <label>Дожим через <input type="number" min={0} max={10080} value={recoverySettings.lost_task_delay_minutes} onChange={(event) => setRecoverySettings({ ...recoverySettings, lost_task_delay_minutes: Number(event.target.value) })} style={{ width: 90 }} /> мин</label>
        </div>
        <div className="strategic-actions" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
          <label><input type="checkbox" checked={recoverySettings.appointment_recovery_enabled} onChange={(event) => setRecoverySettings({ ...recoverySettings, appointment_recovery_enabled: event.target.checked })} /> Recovery записей</label>
          <label>Проверять через <input type="number" min={0} max={10080} value={recoverySettings.no_show_grace_minutes} onChange={(event) => setRecoverySettings({ ...recoverySettings, no_show_grace_minutes: Number(event.target.value) })} style={{ width: 90 }} /> мин после окончания</label>
        </div>
        <small>Если статус визита явно NO_SHOW — создаётся задача вернуть пациента. Если время BOOKED/CONFIRMED прошло, создаётся только задача проверить факт визита. IMDS не меняет такой визит на NO_SHOW автоматически.</small>
        <div className="strategic-actions" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
          <label><input type="checkbox" checked={recoverySettings.whatsapp_enabled} onChange={(event) => setRecoverySettings({ ...recoverySettings, whatsapp_enabled: event.target.checked })} /> WhatsApp follow-up</label>
          <input value={recoverySettings.whatsapp_template_name || ''} onChange={(event) => setRecoverySettings({ ...recoverySettings, whatsapp_template_name: event.target.value })} placeholder="Одобренный template name" style={{ minWidth: 220 }} />
          <input value={recoverySettings.whatsapp_template_language || 'ru'} onChange={(event) => setRecoverySettings({ ...recoverySettings, whatsapp_template_language: event.target.value })} placeholder="ru" style={{ width: 90 }} />
          <input value={(recoverySettings.whatsapp_template_parameters || []).join(', ')} onChange={(event) => setRecoverySettings({ ...recoverySettings, whatsapp_template_parameters: event.target.value.split(',').map((item) => item.trim()).filter(Boolean) })} placeholder="$lead_name, $reason" style={{ minWidth: 220 }} />
          <button className="button" type="button" onClick={() => void saveRecoverySettings()} disabled={savingRecovery}>{savingRecovery ? 'Сохранение…' : 'Сохранить Recovery'}</button>
        </div>
        <small>WhatsApp не отправляется автоматически. Recovery только ставит шаблон в очередь; сотрудник запускает отправку вручную. Поддерживаемые параметры: $lead_name, $reason, $next_action, $source. WABA повторно проверяет, что шаблон одобрен и параметры совпадают.</small>
      </div>}
      <div className="run-list" style={{ marginTop: 12 }}>
        {recoveryActions.length ? recoveryActions.slice(0, 50).map((item) => <div className="run-item" key={item.id}>
          <i className={`run-dot ${['sent', 'completed'].includes(item.status) ? 'success' : item.status === 'failed' ? 'failed' : ''}`}/>
          <div><b>{recoveryTriggerLabel[item.trigger_type] || item.trigger_type} · {item.action_type === 'task' ? 'CRM-задача' : 'WhatsApp шаблон'}</b><small>{dateTime(item.created_at)}{item.template_name ? ` · ${item.template_name}` : ''}{item.last_error ? ` · ${item.last_error}` : ''}</small></div>
          {item.action_type === 'whatsapp_template' && item.status !== 'sent' ? <button className="button" type="button" onClick={() => void sendRecovery(item.id)} disabled={sendingRecoveryId === item.id}><MessageCircle size={14}/>{sendingRecoveryId === item.id ? 'Отправка…' : item.status === 'failed' ? 'Повторить' : 'Отправить'}</button> : <span className="badge">{item.status}</span>}
        </div>) : <div className="suite-state">Recovery-действий пока нет.</div>}
      </div>
    </section>

    <section className="panel">
      <div className="google-card-head"><div><h2>Patient Journey Funnel</h2><p>Главная медицинская воронка: лид → квалификация → запись → приход → продажа.</p></div><TrendingUp size={20}/></div>
      <div className="journey-flow">{funnel.map((item, index) => <div key={item.key} style={{ display: 'contents' }}><div className="journey-node"><b>{item.value}</b> · {item.label}</div>{index < funnel.length - 1 && <ArrowRight size={14}/>}</div>)}</div>
    </section>

    <div className="strategic-grid strategic-grid--equal">
      <section className="panel">
        <div className="google-card-head"><div><h2>Lost Revenue</h2><p>Обращения, которые можно вернуть в запись или продажу.</p></div><RotateCcw size={20}/></div>
        <div className="journey-list">{openLost.length ? openLost.map((item) => <article className="journey-card" key={item.id}><div><h3>{item.reason}</h3><p>{item.owner_name || 'Ответственный не назначен'} · обнаружено {dateTime(item.detected_at)}</p><p>{item.next_action ? `Следующее действие: ${item.next_action}` : 'Следующее действие не задано'}{item.next_action_at ? ` · ${dateTime(item.next_action_at)}` : ''}</p></div><div style={{ textAlign: 'right' }}><strong>{money(item.estimated_value, item.currency)}</strong><div className="strategic-actions" style={{ marginTop: 8, justifyContent: 'flex-end' }}><button className="button" type="button" onClick={() => void updateOpportunity(item.id, 'recovering')}>В работу</button><button className="button" type="button" onClick={() => void updateOpportunity(item.id, 'recovered')}>Вернули</button></div></div></article>) : <div className="suite-state">Потерянные возможности пока не зафиксированы.</div>}</div>
      </section>

      <section className="panel">
        <div className="google-card-head"><div><h2>Offline Conversions</h2><p>Нижняя часть воронки для Meta CAPI; Google/TikTok используют ту же очередь и будут подключены отдельными адаптерами.</p></div><Target size={20}/></div>
        {isAdmin && <div className="strategic-note" style={{ display: 'grid', gap: 10 }}>
          <label><strong>Meta Dataset / Pixel ID</strong></label>
          <div className="strategic-actions" style={{ alignItems: 'center' }}>
            <input value={metaDatasetId} onChange={(event) => setMetaDatasetId(event.target.value)} placeholder="Например 123456789012345" style={{ minWidth: 260, flex: 1 }} />
            <button className="button" type="button" onClick={() => void saveMetaDestination()} disabled={!metaDatasetId.trim()}>Сохранить</button>
            <button className="button" type="button" onClick={() => void syncMeta()} disabled={syncingMeta || !metaDatasetId.trim()}><Send size={14}/>{syncingMeta ? 'Отправка…' : 'Отправить в Meta'}</button>
          </div>
          <small>Qualified Lead → Lead, Appointment → Schedule, Arrival → CompleteRegistration, Sale → Purchase. Событие помечается sent только после успешного ответа Meta.</small>
        </div>}
        <div className="run-list">{conversions.length ? conversions.map((item) => <div className="run-item" key={item.id}><i className={`run-dot ${item.sync_status === 'sent' ? 'success' : item.sync_status === 'failed' ? 'failed' : ''}`}/><div><b>{labels[item.event_name] || item.event_name} → {item.destination}</b><small>{dateTime(item.occurred_at)}{item.value > 0 ? ` · ${money(item.value, item.currency)}` : ''}{item.last_error ? ` · ${item.last_error}` : ''}</small></div><span className="badge">{item.sync_status}</span></div>) : <div className="suite-state">Конверсионных событий пока нет.</div>}</div>
        {pending.length > 0 && <div className="strategic-note">В очереди {pending.length} событий. Growth Engine не помечает их отправленными, пока рекламный коннектор фактически не подтвердит доставку.</div>}
      </section>
    </div>

    <section className="panel">
      <div className="google-card-head"><div><h2>Последние события Patient Journey</h2><p>Фактическая история касаний и конверсий по текущей клинике.</p></div></div>
      <div className="timeline">{journey.length ? journey.slice(0, 50).map((item) => <div className="timeline-item" key={item.id}><i/><div><b>{labels[item.event_type] || item.event_type}{item.value ? ` · ${money(item.value, item.currency || 'KZT')}` : ''}</b><p>{item.source || item.channel || 'Источник не указан'}{item.campaign_id ? ` · campaign ${item.campaign_id}` : ''} · {dateTime(item.occurred_at)}</p></div></div>) : <div className="suite-state">Событий пока нет.</div>}</div>
    </section>
  </div>;
}
