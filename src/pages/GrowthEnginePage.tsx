import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, RefreshCw, RotateCcw, Send, Target, TrendingUp } from 'lucide-react';
import { useAuth } from '../components/AuthGate';
import '../strategic-platform.css';

type Destination = { provider: string; external_destination_id: string; enabled: boolean; config?: Record<string, unknown> };
type GrowthOverview = {
  funnel: Record<string, number>;
  journeyEvents: number;
  openLostOpportunities: number;
  recoverableValue: number;
  pendingConversions: number;
  sentConversions: number;
  skippedConversions: number;
  destinations?: Destination[];
};

type JourneyEvent = { id: string; lead_id?: string | null; event_type: string; occurred_at: string; channel?: string | null; source?: string | null; campaign_id?: string | null; value?: number; currency?: string; metadata?: Record<string, unknown> };
type LostOpportunity = { id: string; lead_id?: string | null; call_id?: string | null; status: 'open' | 'recovering' | 'recovered' | 'lost'; reason: string; estimated_value: number; currency: string; owner_name?: string | null; next_action?: string | null; next_action_at?: string | null; detected_at: string; recovered_at?: string | null };
type ConversionEvent = { id: string; lead_id?: string | null; event_name: string; occurred_at: string; destination: string; value: number; currency: string; sync_status: string; attempts: number; last_error?: string | null };

const money = (value: number, currency = 'KZT') => new Intl.NumberFormat('ru-RU', { style: 'currency', currency, maximumFractionDigits: 0 }).format(Number(value || 0));
const dateTime = (value?: string | null) => value ? new Date(value).toLocaleString('ru-RU') : '—';
const labels: Record<string, string> = { lead_created: 'Лид', first_contact: 'Первый контакт', qualified: 'Целевой', call: 'Звонок', conversation: 'Диалог', message: 'Сообщение', appointment_booked: 'Запись', arrived: 'Приход', deal_created: 'Сделка', rejected: 'Отказ', sale: 'Продажа', lead: 'Lead', qualified_lead: 'Qualified Lead', purchase: 'Purchase' };

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
  const [metaDatasetId, setMetaDatasetId] = useState('');
  const [loading, setLoading] = useState(true);
  const [syncingMeta, setSyncingMeta] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const load = async () => {
    setLoading(true); setMessage(null);
    try {
      const [summary, journeyRows, lostRows, conversionRows] = await Promise.all([
        api<GrowthOverview>('/api/growth/overview'),
        api<JourneyEvent[]>('/api/growth/journey?limit=100'),
        api<LostOpportunity[]>('/api/growth/lost-opportunities?limit=100'),
        api<ConversionEvent[]>('/api/growth/conversions?limit=100'),
      ]);
      setOverview(summary); setJourney(journeyRows); setLost(lostRows); setConversions(conversionRows);
      const meta = summary.destinations?.find((item) => item.provider === 'meta');
      setMetaDatasetId(meta?.external_destination_id || '');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Ошибка загрузки Growth Engine'); }
    finally { setLoading(false); }
  };

  useEffect(() => { void load(); }, []);

  const funnel = useMemo(() => [
    ['lead_created', 'Лиды'], ['qualified', 'Целевые'], ['appointment_booked', 'Записи'], ['arrived', 'Пришли'], ['sale', 'Продажи'],
  ].map(([key, label]) => ({ key, label, value: overview?.funnel[key] || 0 })), [overview]);
  const openLost = lost.filter((item) => item.status === 'open' || item.status === 'recovering');
  const pending = conversions.filter((item) => ['pending', 'processing', 'failed'].includes(item.sync_status));

  const updateOpportunity = async (id: string, status: LostOpportunity['status']) => {
    try { await api(`/api/growth/lost-opportunities/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ status }) }); await load(); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Не удалось обновить возможность'); }
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
      <div><span>IMDS / Healthcare Growth OS</span><h1>Growth Engine</h1><p>Единый контур от первого рекламного касания до записи, прихода, продажи и возврата потерянной выручки. Все данные изолированы по выбранной клинике.</p></div>
      <button className="button" type="button" onClick={() => void load()} disabled={loading}><RefreshCw size={15}/>{loading ? 'Обновление…' : 'Обновить'}</button>
    </div>
    {message && <div className="alert alert--error">{message}</div>}
    {success && <div className="alert">{success}</div>}

    <div className="strategic-status">
      <article><span>Событий пути пациента</span><strong>{overview?.journeyEvents || 0}</strong></article>
      <article><span>Открытых потерь</span><strong>{overview?.openLostOpportunities || 0}</strong></article>
      <article><span>Потенциально вернуть</span><strong>{money(overview?.recoverableValue || 0)}</strong></article>
      <article><span>Offline conversions в очереди</span><strong>{overview?.pendingConversions || 0}</strong></article>
      <article><span>Offline conversions отправлено</span><strong>{overview?.sentConversions || 0}</strong></article>
      <article><span>Без рекламного идентификатора</span><strong>{overview?.skippedConversions || 0}</strong></article>
    </div>

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
        <div className="google-card-head"><div><h2>Offline Conversions</h2><p>Нижняя часть воронки для Meta CAPI; Google/TikTok используют ту же очередь и будут подключены следующим адаптером.</p></div><Target size={20}/></div>
        {isAdmin && <div className="strategic-note" style={{ display: 'grid', gap: 10 }}>
          <label><strong>Meta Dataset / Pixel ID</strong></label>
          <div className="strategic-actions" style={{ alignItems: 'center' }}>
            <input value={metaDatasetId} onChange={(event) => setMetaDatasetId(event.target.value)} placeholder="Например 123456789012345" style={{ minWidth: 260, flex: 1 }} />
            <button className="button" type="button" onClick={() => void saveMetaDestination()} disabled={!metaDatasetId.trim()}>Сохранить</button>
            <button className="button" type="button" onClick={() => void syncMeta()} disabled={syncingMeta || !metaDatasetId.trim()}><Send size={14}/>{syncingMeta ? 'Отправка…' : 'Отправить в Meta'}</button>
          </div>
          <small>Qualified Lead → Lead, Appointment → Schedule, Arrival → CompleteRegistration, Sale → Purchase. Телефон/email хешируются SHA-256; событие помечается sent только после успешного ответа Meta.</small>
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
