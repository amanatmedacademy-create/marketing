import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  BrainCircuit,
  CalendarPlus,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock3,
  ExternalLink,
  History,
  LoaderCircle,
  MapPin,
  MessageCircle,
  Phone,
  PhoneCall,
  RefreshCw,
  Search,
  Sparkles,
  Stethoscope,
  UserRound,
} from 'lucide-react';
import { useAuth } from './AuthGate';
import { telephonyApi } from '../services/telephony';
import { tasksApi } from '../services/tasks';

type Row = Record<string, unknown>;
type Branch = { id: string; name: string; address?: string | null };
type Doctor = { id: string; branch_id: string; name: string; specialty?: string | null };
type Slot = { id: string; starts_at: string; ends_at: string; slot_minutes: number };
type PhoneContext = {
  activeCall: Row | null;
  selectedCall: Row | null;
  recentCalls: Row[];
  patient: {
    lead: Row | null;
    calls: Row[];
    journey: Row[];
    appointments: Row[];
    tasks: Row[];
  };
  clinic: { branches: Branch[]; doctors: Doctor[] };
};
type QueueFilter = 'all' | 'live' | 'missed' | 'followup';
type TimelineKind = 'call' | 'journey' | 'appointment' | 'task';
type TimelineItem = { id: string; kind: TimelineKind; at: string; row: Row };
type CallTab = 'summary' | 'transcript' | 'quality';

const text = (value: unknown) => typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim();
const numberValue = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : 0;
const bool = (value: unknown) => value === true;
const dateTime = (value: unknown) => text(value) ? new Date(text(value)).toLocaleString('ru-RU') : '—';
const timeOnly = (value: unknown) => text(value) ? new Date(text(value)).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : '—';
const dateOnly = (value: unknown) => text(value) ? new Date(text(value)).toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' }) : '—';
const duration = (value: unknown) => {
  const seconds = Math.max(0, numberValue(value));
  return `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, '0')}`;
};
const strings = (value: unknown): string[] => Array.isArray(value) ? value.map(text).filter(Boolean) : [];

function formatPhone(value: unknown) {
  const raw = text(value);
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('7')) return `+7 ${digits.slice(1, 4)} ${digits.slice(4, 7)} ${digits.slice(7, 9)} ${digits.slice(9)}`;
  return raw || 'Без номера';
}

function eventLabel(value: unknown) {
  const labels: Record<string, string> = {
    lead_created: 'Лид создан',
    first_contact: 'Первый контакт',
    first_response: 'Первый ответ',
    qualified: 'Квалифицирован',
    conversation: 'Диалог',
    message: 'Сообщение',
    arrived: 'Визит',
    deal_created: 'Сделка',
    rejected: 'Отказ',
    sale: 'Продажа',
  };
  return labels[text(value)] || text(value) || 'Событие';
}

function isFreshPending(call: Row | null | undefined): boolean {
  if (!call || text(call.call_status) !== 'PENDING') return false;
  const started = new Date(text(call.started_at)).getTime();
  if (!Number.isFinite(started)) return false;
  return Date.now() - started < 3 * 60 * 60 * 1000;
}

function isMissed(call: Row): boolean {
  if (text(call.call_direction) !== 'INBOUND' || isFreshPending(call)) return false;
  return text(call.call_status) === 'CANCELLED' || numberValue(call.duration_seconds) === 0 || text(call.call_status) === 'PENDING';
}

function attribution(sourceValue: unknown, campaignValue: unknown, adValue: unknown) {
  const source = text(sourceValue);
  const normalized = source.toLowerCase();
  const hasPaidIds = Boolean(text(campaignValue) || text(adValue));
  if (hasPaidIds || /(meta|facebook ads|instagram ads|tiktok ads|google ads|cpc|paid)/i.test(normalized)) return { kind: 'PAID', label: source || 'Реклама' };
  if (/(google|yandex|search|seo|maps|2gis)/i.test(normalized)) return { kind: 'ORGANIC SEARCH', label: source || 'Органический поиск' };
  if (/(instagram|facebook|tiktok|telegram|social)/i.test(normalized)) return { kind: 'ORGANIC SOCIAL', label: source || 'Соцсети' };
  if (/(referral|recommend|рекоменд)/i.test(normalized)) return { kind: 'REFERRAL', label: source || 'Рекомендация' };
  if (/(offline|наруж|визит|вывес)/i.test(normalized)) return { kind: 'OFFLINE', label: source || 'Офлайн' };
  if (/(direct|phone|звон)/i.test(normalized)) return { kind: 'DIRECT', label: source || 'Прямое обращение' };
  return { kind: source ? 'SOURCE' : 'UNKNOWN', label: source || 'Источник не определён' };
}

function queueState(call: Row) {
  if (isFreshPending(call)) return { label: 'LIVE', className: 'is-live' };
  if (isMissed(call)) return { label: 'ПРОПУЩЕН', className: 'is-missed' };
  if (text(call.next_action)) return { label: 'FOLLOW-UP', className: 'is-followup' };
  return { label: text(call.call_direction) === 'INBOUND' ? 'ВХ' : 'ИСХ', className: '' };
}

function defaultFollowUpInput(): string {
  const next = new Date(Date.now() + 24 * 60 * 60 * 1000);
  next.setMinutes(0, 0, 0);
  return new Date(next.getTime() - next.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...init, headers: { 'content-type': 'application/json', ...init?.headers }, cache: 'no-store' });
  const raw = await response.text();
  let payload: unknown = {};
  try { payload = raw ? JSON.parse(raw) : {}; } catch { payload = { error: raw }; }
  if (!response.ok) throw new Error((payload as { error?: string }).error || raw || `HTTP ${response.status}`);
  return payload as T;
}

function RecordingPlayer({ call }: { call: Row }) {
  const [src, setSrc] = useState('');
  const [message, setMessage] = useState('');
  const hasRecording = Boolean(text(call.recording_url) || text(call.pbx_call_id) || text(call.recording_external_id));

  useEffect(() => {
    if (!hasRecording || text(call.call_status) !== 'COMPLETED') {
      setSrc('');
      setMessage('');
      return;
    }
    const controller = new AbortController();
    let objectUrl = '';
    setSrc('');
    setMessage('Загружаем защищённую запись…');
    fetch(`/api/telephony/calls/${encodeURIComponent(text(call.id))}/recording`, { signal: controller.signal, cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error((await response.text()) || `HTTP ${response.status}`);
        return response.blob();
      })
      .then((blob) => {
        if (controller.signal.aborted) return;
        objectUrl = URL.createObjectURL(blob);
        setSrc(objectUrl);
        setMessage('');
      })
      .catch((error) => {
        if (!controller.signal.aborted) setMessage(error instanceof Error ? error.message : String(error));
      });
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [call.id, call.call_status, call.recording_url, call.pbx_call_id, call.recording_external_id, hasRecording]);

  if (!hasRecording || text(call.call_status) !== 'COMPLETED') return null;
  if (src) return <audio className="telephony-call-card__audio" controls preload="metadata" src={src}/>;
  return message ? <div className="telephony-inline-state">{message}</div> : null;
}

function QualityGrid({ call }: { call: Row }) {
  const rows: Array<[string, unknown]> = [
    ['Выявлена потребность', call.detected_pain],
    ['Заданы вопросы', call.asked_questions],
    ['Презентована ценность', call.presented_value],
    ['Отработано возражение', call.handled_objection],
    ['Предложено время', call.offered_specific_time],
    ['Подтверждена запись', call.confirmed_appointment],
    ['Назван следующий шаг', call.stated_next_step],
    ['Запланирован follow-up', call.follow_up_planned],
  ];
  return <div className="telephony-quality-grid">{rows.map(([label, value]) => <div key={label}><span>{label}</span><strong className={value === true ? 'yes' : value === false ? 'no' : ''}>{value == null ? '—' : bool(value) ? 'Да' : 'Нет'}</strong></div>)}</div>;
}

function CallTimelineCard({
  call,
  expanded,
  tab,
  busy,
  onToggle,
  onTab,
  onAnalyze,
  onTranscribe,
}: {
  call: Row;
  expanded: boolean;
  tab: CallTab;
  busy: string;
  onToggle: () => void;
  onTab: (tab: CallTab) => void;
  onAnalyze: () => void;
  onTranscribe: () => void;
}) {
  const result = text(call.call_result) || text(call.summary) || (isMissed(call) ? 'Пропущенный звонок' : 'Без результата');
  const score = call.quality_score == null ? '' : `${Math.round(numberValue(call.quality_score))}/100`;
  const violations = strings(call.script_violations);
  return <article className={`telephony-timeline__item telephony-timeline__item--call ${expanded ? 'is-expanded' : ''}`}>
    <button className="telephony-timeline__call-head" type="button" onClick={onToggle}>
      <span className="telephony-timeline__icon"><PhoneCall size={16}/></span>
      <div><strong>{text(call.call_direction) === 'INBOUND' ? 'Входящий звонок' : 'Исходящий звонок'} · {duration(call.duration_seconds)}</strong><small>{dateTime(call.started_at)} · {result}</small></div>
      {score && <b>{score}</b>}
      {expanded ? <ChevronUp size={17}/> : <ChevronDown size={17}/>} 
    </button>
    {expanded && <div className="telephony-call-card">
      <div className="telephony-call-card__facts">
        <span><small>Оператор</small><strong>{text(call.operator_name) || 'Не назначен'}</strong></span>
        <span><small>Результат</small><strong>{text(call.call_result) || '—'}</strong></span>
        <span><small>Следующий шаг</small><strong>{text(call.next_action) || '—'}</strong></span>
      </div>
      <RecordingPlayer call={call}/>
      <div className="telephony-call-card__tabs">
        <button type="button" className={tab === 'summary' ? 'active' : ''} onClick={() => onTab('summary')}>Резюме</button>
        <button type="button" className={tab === 'transcript' ? 'active' : ''} onClick={() => onTab('transcript')}>Транскрипт</button>
        <button type="button" className={tab === 'quality' ? 'active' : ''} onClick={() => onTab('quality')}>Качество</button>
      </div>
      {tab === 'summary' && <div className="telephony-call-card__body">
        <p>{text(call.summary) || 'AI-резюме пока отсутствует.'}</p>
        <dl>
          <div><dt>Причина обращения</dt><dd>{text(call.request_reason) || '—'}</dd></div>
          <div><dt>Потребность</dt><dd>{text(call.patient_pain) || '—'}</dd></div>
          <div><dt>Возражения</dt><dd>{strings(call.objections).join(', ') || '—'}</dd></div>
          <div><dt>Причина потери</dt><dd>{text(call.loss_reason) || '—'}</dd></div>
        </dl>
      </div>}
      {tab === 'transcript' && <div className="telephony-call-card__body telephony-call-card__transcript"><p>{text(call.transcript) || (text(call.transcription_status) === 'processing' ? 'Расшифровка выполняется…' : 'Расшифровка отсутствует.')}</p></div>}
      {tab === 'quality' && <div className="telephony-call-card__body">
        <QualityGrid call={call}/>
        <div className="telephony-call-card__violations"><strong>Нарушения</strong><p>{violations.length ? violations.join(' · ') : 'Нарушений не зафиксировано.'}</p></div>
      </div>}
      <div className="telephony-call-card__actions">
        <button type="button" onClick={onTranscribe} disabled={busy !== '' || text(call.call_status) !== 'COMPLETED'}><Stethoscope size={15}/>{busy === `transcribe:${text(call.id)}` ? 'Расшифровка…' : 'Текст + AI'}</button>
        <button type="button" onClick={onAnalyze} disabled={busy !== '' || !text(call.transcript)}><BrainCircuit size={15}/>{busy === `analyze:${text(call.id)}` ? 'Анализ…' : 'AI анализ'}</button>
      </div>
    </div>}
  </article>;
}

export default function TelephonyOperatorWorkspace() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [data, setData] = useState<PhoneContext | null>(null);
  const [selectedCallId, setSelectedCallId] = useState('');
  const [query, setQuery] = useState('');
  const [queueFilter, setQueueFilter] = useState<QueueFilter>('all');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [expandedCallId, setExpandedCallId] = useState('');
  const [callTab, setCallTab] = useState<CallTab>('summary');
  const [branchId, setBranchId] = useState('');
  const [doctorId, setDoctorId] = useState('');
  const [service, setService] = useState('');
  const [slots, setSlots] = useState<Slot[]>([]);
  const [slotId, setSlotId] = useState('');
  const [followUpAt, setFollowUpAt] = useState(defaultFollowUpInput());
  const [followUpReason, setFollowUpReason] = useState('');
  const [followUpCreated, setFollowUpCreated] = useState('');

  const load = useCallback(async (callId?: string, silent = false) => {
    if (!silent) setLoading(true);
    try {
      const params = new URLSearchParams();
      if (callId) params.set('call_id', callId);
      const next = await request<PhoneContext>(`/api/phone-workspace${params.size ? `?${params}` : ''}`);
      setData(next);
      const resolvedId = text(next.selectedCall?.id);
      if (resolvedId) {
        setSelectedCallId(resolvedId);
        setExpandedCallId((current) => current || resolvedId);
      }
      setMessage('');
    } catch (error) {
      if (!silent) setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const timer = window.setInterval(() => void load(selectedCallId || undefined, true), 7000);
    return () => window.clearInterval(timer);
  }, [load, selectedCallId]);

  const selected = data?.selectedCall || null;
  const lead = data?.patient.lead || null;
  const patientName = text(lead?.name) || text(selected?.client_name) || 'Неизвестный пациент';
  const patientPhone = text(lead?.phone) || text(selected?.client_phone);
  const selectedAttribution = attribution(lead?.source || selected?.source, lead?.campaign_id || selected?.campaign_id, lead?.ad_id || selected?.ad_id);
  const activeId = isFreshPending(data?.activeCall) ? text(data?.activeCall?.id) : '';

  const filteredCalls = useMemo(() => (data?.recentCalls || []).filter((call) => {
    const haystack = [call.client_name, call.client_phone, call.operator_name, call.call_result, call.source, call.next_action].map(text).join(' ').toLowerCase();
    if (!haystack.includes(query.trim().toLowerCase())) return false;
    if (queueFilter === 'live') return isFreshPending(call);
    if (queueFilter === 'missed') return isMissed(call);
    if (queueFilter === 'followup') return Boolean(text(call.next_action)) || isMissed(call);
    return true;
  }), [data?.recentCalls, query, queueFilter]);

  const queueCounts = useMemo(() => {
    const calls = data?.recentCalls || [];
    return {
      all: calls.length,
      live: calls.filter(isFreshPending).length,
      missed: calls.filter(isMissed).length,
      followup: calls.filter((call) => Boolean(text(call.next_action)) || isMissed(call)).length,
    };
  }, [data?.recentCalls]);

  const doctors = useMemo(() => (data?.clinic.doctors || []).filter((doctor) => !branchId || doctor.branch_id === branchId), [data?.clinic.doctors, branchId]);

  const timeline = useMemo<TimelineItem[]>(() => {
    if (!data) return [];
    const directCalls = data.patient.calls.map((row) => ({ id: `call:${text(row.id)}`, kind: 'call' as const, at: text(row.started_at) || text(row.created_at), row }));
    const appointments = data.patient.appointments.map((row) => ({ id: `appointment:${text(row.id)}`, kind: 'appointment' as const, at: text(row.created_at) || text(row.starts_at), row }));
    const tasks = data.patient.tasks.map((row) => ({ id: `task:${text(row.id)}`, kind: 'task' as const, at: text(row.created_at) || text(row.due_at), row }));
    const journey = data.patient.journey
      .filter((row) => !['call', 'appointment_booked'].includes(text(row.event_type)))
      .map((row) => ({ id: `journey:${text(row.id)}`, kind: 'journey' as const, at: text(row.occurred_at) || text(row.created_at), row }));
    return [...directCalls, ...appointments, ...tasks, ...journey]
      .filter((item) => Boolean(item.at))
      .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
      .slice(0, 50);
  }, [data]);

  useEffect(() => {
    setBranchId('');
    setDoctorId('');
    setSlots([]);
    setSlotId('');
    setFollowUpAt(defaultFollowUpInput());
    setFollowUpReason(text(selected?.next_action));
    setFollowUpCreated('');
  }, [selectedCallId]); // eslint-disable-line react-hooks/exhaustive-deps

  const chooseCall = async (id: string) => {
    if (!id) return;
    setSelectedCallId(id);
    setExpandedCallId(id);
    setCallTab('summary');
    setMessage('');
    await load(id);
  };

  const sendToDialer = () => {
    if (!patientPhone) return;
    window.dispatchEvent(new CustomEvent('imds:telephony-dial', { detail: { phone: patientPhone } }));
  };

  const runAnalyze = async (callId: string) => {
    if (!callId) return;
    setBusy(`analyze:${callId}`);
    setMessage('');
    try {
      await request(`/api/growth/calls/${encodeURIComponent(callId)}/analyze`, { method: 'POST', body: '{}' });
      setMessage('AI-анализ обновлён.');
      await load(callId, true);
      setExpandedCallId(callId);
      setCallTab('summary');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally { setBusy(''); }
  };

  const runTranscribe = async (callId: string) => {
    if (!callId) return;
    setBusy(`transcribe:${callId}`);
    setMessage('');
    try {
      const result = await telephonyApi.transcribe(callId);
      setMessage(result.analysisError ? `Текст готов, AI: ${result.analysisError}` : 'Транскрипция и AI-анализ завершены.');
      await load(callId, true);
      setExpandedCallId(callId);
      setCallTab('transcript');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally { setBusy(''); }
  };

  const loadSlots = async (nextDoctorId: string) => {
    setDoctorId(nextDoctorId);
    setSlotId('');
    setSlots([]);
    if (!nextDoctorId) return;
    setBusy('slots');
    try {
      const result = await request<{ slots: Slot[] }>(`/api/phone-workspace/slots?doctor_id=${encodeURIComponent(nextDoctorId)}`);
      setSlots(result.slots || []);
      setMessage((result.slots || []).length ? '' : 'У выбранного врача нет свободных слотов на ближайшие 21 день.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally { setBusy(''); }
  };

  const createAppointment = async () => {
    if (!branchId || !doctorId || !slotId) return;
    setBusy('appointment');
    setMessage('');
    try {
      await request('/api/phone-workspace/appointments', {
        method: 'POST',
        body: JSON.stringify({
          callId: text(selected?.id),
          leadId: text(lead?.id),
          branchId,
          doctorId,
          startsAt: slotId,
          service: service.trim(),
          patientName,
          phone: patientPhone,
        }),
      });
      setMessage('Пациент записан. Timeline обновлена.');
      setSlots((items) => items.filter((slot) => slot.starts_at !== slotId));
      setSlotId('');
      await load(text(selected?.id), true);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally { setBusy(''); }
  };

  const createFollowUp = async () => {
    if (!followUpAt || !patientPhone) return;
    setBusy('followup');
    setMessage('');
    try {
      const title = `Перезвонить: ${patientName}`;
      const description = [
        'Follow-up из IMDS Telephony',
        `Пациент: ${patientName}`,
        `Телефон: ${formatPhone(patientPhone)}`,
        text(selected?.id) ? `Звонок: ${text(selected?.id)}` : '',
        followUpReason.trim() ? `Причина: ${followUpReason.trim()}` : '',
      ].filter(Boolean).join('\n');
      await tasksApi.create({
        title,
        description,
        priority: 'medium',
        dueAt: new Date(followUpAt).toISOString(),
        assignmentMode: 'shared',
        targets: [{ targetType: 'user', targetValue: user.id, targetLabel: user.name || user.email || 'Текущий оператор' }],
      });
      setFollowUpCreated(`Создано на ${new Date(followUpAt).toLocaleString('ru-RU')}`);
      setMessage('Follow-up создан в модуле «Задачи».');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally { setBusy(''); }
  };

  const noDirectory = !(data?.clinic.branches || []).length || !(data?.clinic.doctors || []).length;
  const selectedIsLive = isFreshPending(selected) && text(selected?.id) === activeId;

  return <div className="telephony-operator">
    {message && <div className="telephony-operator__message">{message}</div>}
    {loading && <div className="telephony-operator__loading"><LoaderCircle className="spin"/> Загружаем рабочее место…</div>}

    {!loading && data && <div className="telephony-operator__grid">
      <aside className="telephony-queue">
        <header className="telephony-panel-head">
          <div><PhoneCall size={17}/><strong>Очередь</strong></div>
          <button type="button" onClick={() => void load(selectedCallId || undefined)} title="Обновить"><RefreshCw size={15}/></button>
        </header>
        <label className="telephony-search"><Search size={15}/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Пациент или номер"/></label>
        <div className="telephony-queue__filters">
          {([
            ['all', 'Все'],
            ['live', 'Live'],
            ['missed', 'Пропущ.'],
            ['followup', 'Действие'],
          ] as Array<[QueueFilter, string]>).map(([id, label]) => <button key={id} type="button" className={queueFilter === id ? 'active' : ''} onClick={() => setQueueFilter(id)}>{label}<span>{queueCounts[id]}</span></button>)}
        </div>
        <div className="telephony-queue__list">
          {filteredCalls.map((call) => {
            const state = queueState(call);
            const callId = text(call.id);
            return <button key={callId} type="button" className={`${callId === text(selected?.id) ? 'active' : ''} ${state.className}`} onClick={() => void chooseCall(callId)}>
              <span className="telephony-queue__phone"><Phone size={14}/></span>
              <div><strong>{text(call.client_name) || formatPhone(call.client_phone)}</strong><small>{formatPhone(call.client_phone)} · {timeOnly(call.started_at)}</small></div>
              <em>{state.label}</em>
            </button>;
          })}
          {!filteredCalls.length && <div className="telephony-empty">Нет звонков по фильтру.</div>}
        </div>
      </aside>

      <main className="telephony-patient">
        <header className={`telephony-patient__hero ${selectedIsLive ? 'is-live' : ''}`}>
          <div className="telephony-patient__avatar"><UserRound size={24}/></div>
          <div className="telephony-patient__identity">
            <span>{selectedIsLive ? 'АКТИВНЫЙ ЗВОНОК' : 'ПАЦИЕНТ'}</span>
            <h2>{patientName}</h2>
            <p>{formatPhone(patientPhone)}</p>
          </div>
          <div className="telephony-patient__actions">
            <button type="button" onClick={sendToDialer} disabled={!patientPhone}><PhoneCall size={15}/> Набрать</button>
            <button type="button" onClick={() => navigate('/chat')} disabled={!patientPhone}><MessageCircle size={15}/> WhatsApp</button>
            {lead && <button type="button" onClick={() => navigate(`/customers?lead_id=${encodeURIComponent(text(lead.id))}`)}><ExternalLink size={15}/> 360°</button>}
          </div>
        </header>

        <section className="telephony-attribution">
          <div><span>Источник</span><strong>{selectedAttribution.label}</strong><small>{selectedAttribution.kind}</small></div>
          {text(lead?.campaign_id || selected?.campaign_id) && <div><span>Кампания</span><strong>{text(lead?.campaign_id || selected?.campaign_id)}</strong></div>}
          {text(lead?.ad_id || selected?.ad_id) && <div><span>Объявление</span><strong>{text(lead?.ad_id || selected?.ad_id)}</strong></div>}
          {lead?.first_response_seconds != null && <div><span>Первый ответ</span><strong>{numberValue(lead.first_response_seconds)} сек</strong></div>}
        </section>

        <section className="telephony-timeline">
          <header><div><History size={17}/><strong>История взаимодействий</strong></div><span>{timeline.length}</span></header>
          <div className="telephony-timeline__list">
            {timeline.map((item) => {
              if (item.kind === 'call') {
                const callId = text(item.row.id);
                return <CallTimelineCard
                  key={item.id}
                  call={item.row}
                  expanded={expandedCallId === callId}
                  tab={callTab}
                  busy={busy}
                  onToggle={() => { setExpandedCallId((current) => current === callId ? '' : callId); setCallTab('summary'); }}
                  onTab={setCallTab}
                  onAnalyze={() => void runAnalyze(callId)}
                  onTranscribe={() => void runTranscribe(callId)}
                />;
              }
              if (item.kind === 'appointment') return <article key={item.id} className="telephony-timeline__item">
                <span className="telephony-timeline__icon"><CalendarPlus size={16}/></span>
                <div><strong>Запись в клинику</strong><small>{dateTime(item.row.starts_at)} · {text(item.row.service) || text(item.row.doctor_name) || 'Приём'}</small></div>
              </article>;
              if (item.kind === 'task') return <article key={item.id} className="telephony-timeline__item">
                <span className="telephony-timeline__icon"><CheckCircle2 size={16}/></span>
                <div><strong>{text(item.row.title) || 'Follow-up'}</strong><small>{dateTime(item.row.due_at || item.row.created_at)} · {text(item.row.status) || 'Задача'}</small></div>
              </article>;
              return <article key={item.id} className="telephony-timeline__item">
                <span className="telephony-timeline__icon"><MessageCircle size={16}/></span>
                <div><strong>{eventLabel(item.row.event_type)}</strong><small>{dateTime(item.row.occurred_at)} · {text(item.row.channel) || text(item.row.source) || 'IMDS'}</small></div>
              </article>;
            })}
            {!timeline.length && <div className="telephony-empty">История взаимодействий пока пуста.</div>}
          </div>
        </section>
      </main>

      <aside className="telephony-assist">
        <section className="telephony-assist__card telephony-assist__ai">
          <header><div><BrainCircuit size={18}/><strong>IMDS Call AI</strong></div>{selected?.ai_confidence != null && <span>{Math.round(numberValue(selected.ai_confidence))}%</span>}</header>
          <div className="telephony-assist__summary"><Sparkles size={16}/><p>{text(selected?.summary) || (text(selected?.transcript) ? 'Транскрипт готов. Запустите AI-анализ.' : 'После разговора здесь появятся выводы и следующий лучший шаг.')}</p></div>
          <dl>
            <div><dt>Причина</dt><dd>{text(selected?.request_reason) || '—'}</dd></div>
            <div><dt>Потребность</dt><dd>{text(selected?.patient_pain) || '—'}</dd></div>
            <div><dt>Возражения</dt><dd>{strings(selected?.objections).join(', ') || '—'}</dd></div>
            <div><dt>Следующий шаг</dt><dd>{text(selected?.next_action) || '—'}</dd></div>
          </dl>
          <div className="telephony-assist__actions">
            <button type="button" onClick={() => void runTranscribe(text(selected?.id))} disabled={busy !== '' || text(selected?.call_status) !== 'COMPLETED'}><Stethoscope size={15}/> Текст + AI</button>
            <button type="button" onClick={() => void runAnalyze(text(selected?.id))} disabled={busy !== '' || !text(selected?.transcript)}><BrainCircuit size={15}/> Анализ</button>
          </div>
        </section>

        <section className="telephony-assist__card telephony-booking">
          <header><div><CalendarPlus size={18}/><strong>Быстрая запись</strong></div></header>
          {noDirectory ? <div className="telephony-booking__setup"><MapPin size={18}/><div><strong>Расписание не настроено</strong><p>Добавьте филиалы, врачей и расписание — IMDS не создаёт фиктивные слоты.</p></div></div> : <>
            <label><span>Филиал</span><select value={branchId} onChange={(event) => setBranchId(event.target.value)}><option value="">Выберите филиал</option>{data.clinic.branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label>
            <label><span>Врач</span><select value={doctorId} onChange={(event) => void loadSlots(event.target.value)} disabled={!branchId}><option value="">Выберите врача</option>{doctors.map((doctor) => <option key={doctor.id} value={doctor.id}>{doctor.name}{doctor.specialty ? ` · ${doctor.specialty}` : ''}</option>)}</select></label>
            <label><span>Услуга / причина</span><input value={service} onChange={(event) => setService(event.target.value)} placeholder={text(selected?.request_reason) || 'Например: консультация'}/></label>
            <label><span>Свободное время</span><select value={slotId} onChange={(event) => setSlotId(event.target.value)} disabled={!doctorId || busy === 'slots'}><option value="">{busy === 'slots' ? 'Ищем слоты…' : 'Выберите время'}</option>{slots.map((slot) => <option key={slot.id} value={slot.starts_at}>{dateOnly(slot.starts_at)} · {timeOnly(slot.starts_at)} · {slot.slot_minutes} мин</option>)}</select></label>
            <button className="telephony-booking__submit" type="button" onClick={() => void createAppointment()} disabled={!slotId || busy !== ''}>{busy === 'appointment' ? <LoaderCircle className="spin" size={16}/> : <CheckCircle2 size={16}/>} Записать</button>
          </>}
        </section>

        <section className="telephony-assist__card telephony-followup">
          <header><div><Clock3 size={18}/><strong>Follow-up</strong></div><span>{data.patient.tasks.length}</span></header>
          <label><span>Когда</span><input type="datetime-local" value={followUpAt} onChange={(event) => setFollowUpAt(event.target.value)}/></label>
          <label><span>Что сделать</span><input value={followUpReason} onChange={(event) => setFollowUpReason(event.target.value)} placeholder="Перезвонить, уточнить решение…"/></label>
          <button type="button" onClick={() => void createFollowUp()} disabled={!followUpAt || !patientPhone || busy !== ''}>{busy === 'followup' ? <LoaderCircle className="spin" size={16}/> : <CheckCircle2 size={16}/>} Создать задачу</button>
          {followUpCreated && <div className="telephony-followup__success">{followUpCreated}</div>}
          <div className="telephony-followup__existing">
            {data.patient.tasks.slice(0, 3).map((task) => <div key={text(task.id)}><strong>{text(task.title) || 'Задача'}</strong><small>{dateTime(task.due_at || task.created_at)}</small></div>)}
          </div>
        </section>
      </aside>
    </div>}
  </div>;
}
