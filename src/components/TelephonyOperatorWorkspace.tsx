import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  BrainCircuit,
  CalendarPlus,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock3,
  Ellipsis,
  History,
  LoaderCircle,
  MessageCircle,
  Phone,
  PhoneCall,
  Play,
  RefreshCw,
  Search,
  SlidersHorizontal,
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
type TimelineKind = 'call' | 'journey' | 'appointment' | 'task';
type TimelineItem = { id: string; kind: TimelineKind; at: string; row: Row };
type CallTab = 'summary' | 'transcript' | 'quality';
type PatientTab = 'history' | 'profile' | 'notes' | 'files' | 'tasks';
type AttributionKind = 'PAID' | 'ORGANIC SEARCH' | 'ORGANIC SOCIAL' | 'DIRECT' | 'REFERRAL' | 'OFFLINE' | 'UNKNOWN';

const text = (value: unknown) => typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim();
const numberValue = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : 0;
const dateTime = (value: unknown) => text(value) ? new Date(text(value)).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
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

function hasAction(call: Row): boolean {
  return Boolean(text(call.next_action)) && !isFreshPending(call) && !isMissed(call);
}

function attribution(sourceValue: unknown, campaignValue: unknown, adValue: unknown): { kind: AttributionKind; label: string } {
  const source = text(sourceValue);
  const normalized = source.toLowerCase();
  const hasPaidIds = Boolean(text(campaignValue) || text(adValue));
  if (hasPaidIds || /(meta|facebook ads|instagram ads|tiktok ads|google ads|cpc|paid)/i.test(normalized)) return { kind: 'PAID', label: source || 'Реклама' };
  if (/(google|yandex|search|seo|maps|2gis)/i.test(normalized)) return { kind: 'ORGANIC SEARCH', label: source || 'Органический поиск' };
  if (/(instagram|facebook|tiktok|telegram|social)/i.test(normalized)) return { kind: 'ORGANIC SOCIAL', label: source || 'Соцсети' };
  if (/(referral|recommend|рекоменд)/i.test(normalized)) return { kind: 'REFERRAL', label: source || 'Рекомендация' };
  if (/(offline|наруж|визит|вывес)/i.test(normalized)) return { kind: 'OFFLINE', label: source || 'Офлайн' };
  if (/(direct|phone|звон)/i.test(normalized)) return { kind: 'DIRECT', label: source || 'Прямое обращение' };
  return { kind: 'UNKNOWN', label: source || 'Источник не определён' };
}

function tomorrowDate(): string {
  const next = new Date();
  next.setDate(next.getDate() + 1);
  return new Date(next.getTime() - next.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
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
  const [open, setOpen] = useState(false);
  const [src, setSrc] = useState('');
  const [message, setMessage] = useState('');
  const hasRecording = Boolean(text(call.recording_url) || text(call.pbx_call_id) || text(call.recording_external_id));

  useEffect(() => {
    if (!open || !hasRecording || text(call.call_status) !== 'COMPLETED') {
      setSrc('');
      setMessage('');
      return;
    }
    const controller = new AbortController();
    let objectUrl = '';
    setMessage('Загружаем запись…');
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
  }, [open, call.id, call.call_status, call.recording_url, call.pbx_call_id, call.recording_external_id, hasRecording]);

  if (!hasRecording || text(call.call_status) !== 'COMPLETED') return null;
  return <div className="telephony-recording">
    <button type="button" onClick={() => setOpen((value) => !value)}><Play size={13}/>{open ? 'Скрыть запись' : 'Запись'}</button>
    {open && src && <audio controls preload="metadata" src={src}/>} 
    {open && !src && message && <small>{message}</small>}
  </div>;
}

function QualityPanel({ call }: { call: Row }) {
  const rows: Array<[string, unknown]> = [
    ['Выявлена потребность', call.detected_pain],
    ['Работа с возражениями', call.handled_objection],
    ['Презентация ценности', call.presented_value],
    ['Назван следующий шаг', call.stated_next_step],
    ['Закрытие на запись', call.confirmed_appointment],
  ];
  const available = rows.filter(([, value]) => value === true || value === false);
  const hasScore = call.quality_score != null && Number.isFinite(Number(call.quality_score));
  if (!hasScore && !available.length) return <div className="telephony-empty compact">Оценка качества для этого звонка отсутствует.</div>;
  return <div className="telephony-quality-panel">
    {hasScore && <div className="telephony-quality-panel__score"><span>Оценка качества</span><strong>{Math.round(numberValue(call.quality_score))}<small>/100</small></strong><i><b style={{ width: `${Math.max(0, Math.min(100, numberValue(call.quality_score)))}%` }}/></i></div>}
    <div className="telephony-quality-panel__checks">
      {available.map(([label, value]) => <div key={label} className={value === true ? 'yes' : 'no'}><span>{value === true ? '✓' : '×'}</span>{label}</div>)}
    </div>
  </div>;
}

function CallTimelineCard({ call, expanded, tab, busy, onToggle, onTab, onAnalyze, onTranscribe }: {
  call: Row;
  expanded: boolean;
  tab: CallTab;
  busy: string;
  onToggle: () => void;
  onTab: (tab: CallTab) => void;
  onAnalyze: () => void;
  onTranscribe: () => void;
}) {
  const result = text(call.call_result) || (isMissed(call) ? 'Пропущенный звонок' : '');
  const hasSummaryFacts = Boolean(text(call.summary) || text(call.request_reason) || text(call.patient_pain) || strings(call.objections).length || text(call.next_action));
  return <article className={`telephony-timeline__item telephony-timeline__item--call ${expanded ? 'is-expanded' : ''}`}>
    <div className="telephony-timeline__time">{timeOnly(call.started_at)}</div>
    <div className="telephony-timeline__card">
      <button className="telephony-timeline__call-head" type="button" onClick={onToggle}>
        <span className="telephony-timeline__icon"><PhoneCall size={15}/></span>
        <div><strong>{text(call.call_direction) === 'INBOUND' ? 'Входящий звонок' : 'Исходящий звонок'} · {duration(call.duration_seconds)}</strong>{result && <small>Результат: {result}</small>}</div>
        {call.quality_score != null && <b>{Math.round(numberValue(call.quality_score))}/100</b>}
        {expanded ? <ChevronUp size={16}/> : <ChevronDown size={16}/>} 
      </button>
      {expanded && <div className="telephony-call-card">
        <RecordingPlayer call={call}/>
        <div className="telephony-call-card__tabs">
          <button type="button" className={tab === 'summary' ? 'active' : ''} onClick={() => onTab('summary')}>AI-резюме</button>
          <button type="button" className={tab === 'transcript' ? 'active' : ''} onClick={() => onTab('transcript')}>Транскрипт</button>
          <button type="button" className={tab === 'quality' ? 'active' : ''} onClick={() => onTab('quality')}>Качество</button>
        </div>
        {tab === 'summary' && <div className="telephony-call-card__summary-grid">
          <div className="telephony-call-card__body">
            {hasSummaryFacts ? <>
              {text(call.summary) && <p>{text(call.summary)}</p>}
              <dl>
                {text(call.request_reason) && <div><dt>Причина обращения</dt><dd>{text(call.request_reason)}</dd></div>}
                {text(call.patient_pain) && <div><dt>Потребность</dt><dd>{text(call.patient_pain)}</dd></div>}
                {strings(call.objections).length > 0 && <div><dt>Возражения</dt><dd>{strings(call.objections).join(', ')}</dd></div>}
                {text(call.next_action) && <div><dt>Следующий шаг</dt><dd>{text(call.next_action)}</dd></div>}
              </dl>
            </> : <div className="telephony-empty compact">AI-резюме пока отсутствует.</div>}
          </div>
          <QualityPanel call={call}/>
        </div>}
        {tab === 'transcript' && <div className="telephony-call-card__body telephony-call-card__transcript"><p>{text(call.transcript) || (text(call.transcription_status) === 'processing' ? 'Расшифровка выполняется…' : 'Расшифровка отсутствует.')}</p></div>}
        {tab === 'quality' && <QualityPanel call={call}/>} 
        <div className="telephony-call-card__actions">
          <button type="button" onClick={onTranscribe} disabled={busy !== '' || text(call.call_status) !== 'COMPLETED'}><Stethoscope size={14}/>{busy === `transcribe:${text(call.id)}` ? 'Обработка…' : 'Текст + AI'}</button>
          <button type="button" onClick={onAnalyze} disabled={busy !== '' || !text(call.transcript)}><BrainCircuit size={14}/>{busy === `analyze:${text(call.id)}` ? 'Анализ…' : 'Анализ разговора'}</button>
        </div>
      </div>}
    </div>
  </article>;
}

function QueueGroup({ title, count, tone, calls, selectedId, onChoose }: {
  title: string;
  count: number;
  tone?: 'live' | 'missed' | 'action';
  calls: Row[];
  selectedId: string;
  onChoose: (id: string) => void;
}) {
  if (!count) return null;
  return <section className={`telephony-queue-group ${tone ? `is-${tone}` : ''}`}>
    <header><span>{title}</span><b>{count}</b></header>
    <div>
      {calls.map((call) => {
        const id = text(call.id);
        const action = text(call.next_action);
        return <button key={id} type="button" className={id === selectedId ? 'active' : ''} onClick={() => onChoose(id)}>
          <span className="telephony-queue__phone"><Phone size={14}/></span>
          <div><strong>{text(call.client_name) || formatPhone(call.client_phone)}</strong><small>{formatPhone(call.client_phone)}</small></div>
          <em>{tone === 'live' ? duration(call.duration_seconds) : tone === 'action' && action ? action : timeOnly(call.started_at)}</em>
        </button>;
      })}
    </div>
  </section>;
}

export default function TelephonyOperatorWorkspace() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [data, setData] = useState<PhoneContext | null>(null);
  const [selectedCallId, setSelectedCallId] = useState('');
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [showAllRecent, setShowAllRecent] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [expandedCallId, setExpandedCallId] = useState('');
  const [callTab, setCallTab] = useState<CallTab>('summary');
  const [patientTab, setPatientTab] = useState<PatientTab>('history');
  const [branchId, setBranchId] = useState('');
  const [doctorId, setDoctorId] = useState('');
  const [service, setService] = useState('');
  const [slots, setSlots] = useState<Slot[]>([]);
  const [slotId, setSlotId] = useState('');
  const [followUpAction, setFollowUpAction] = useState('Перезвонить');
  const [followUpDate, setFollowUpDate] = useState(tomorrowDate());
  const [followUpTime, setFollowUpTime] = useState('11:00');
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
      if (!silent) setMessage('');
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

  useEffect(() => {
    const active = isFreshPending(data?.activeCall) ? data?.activeCall : null;
    window.dispatchEvent(new CustomEvent('imds:telephony-active-call', { detail: active ? {
      active: true,
      id: text(active.id),
      name: text(active.client_name) || 'Пациент',
      phone: text(active.client_phone),
      startedAt: text(active.started_at),
    } : { active: false } }));
    return () => {
      window.dispatchEvent(new CustomEvent('imds:telephony-active-call', { detail: { active: false } }));
    };
  }, [data?.activeCall]);

  const selected = data?.selectedCall || null;
  const lead = data?.patient.lead || null;
  const patientName = text(lead?.name) || text(selected?.client_name) || 'Неизвестный пациент';
  const patientPhone = text(lead?.phone) || text(selected?.client_phone);
  const selectedAttribution = attribution(lead?.source || selected?.source, lead?.campaign_id || selected?.campaign_id, lead?.ad_id || selected?.ad_id);
  const responsible = text(selected?.operator_name) || text(lead?.assigned_to) || text(lead?.owner_name);

  const visibleCalls = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (data?.recentCalls || []).filter((call) => !needle || [call.client_name, call.client_phone, call.operator_name, call.call_result, call.source, call.next_action].map(text).join(' ').toLowerCase().includes(needle));
  }, [data?.recentCalls, query]);
  const liveCalls = useMemo(() => visibleCalls.filter(isFreshPending), [visibleCalls]);
  const missedCalls = useMemo(() => visibleCalls.filter(isMissed), [visibleCalls]);
  const actionCalls = useMemo(() => visibleCalls.filter(hasAction), [visibleCalls]);
  const recentCalls = useMemo(() => visibleCalls.filter((call) => !isFreshPending(call) && !isMissed(call) && !hasAction(call)).slice(0, showAllRecent ? 20 : 5), [visibleCalls, showAllRecent]);

  const doctors = useMemo(() => (data?.clinic.doctors || []).filter((doctor) => !branchId || doctor.branch_id === branchId), [data?.clinic.doctors, branchId]);
  const timeline = useMemo<TimelineItem[]>(() => {
    if (!data) return [];
    const calls = data.patient.calls.map((row) => ({ id: `call:${text(row.id)}`, kind: 'call' as const, at: text(row.started_at) || text(row.created_at), row }));
    const appointments = data.patient.appointments.map((row) => ({ id: `appointment:${text(row.id)}`, kind: 'appointment' as const, at: text(row.created_at) || text(row.starts_at), row }));
    const tasks = data.patient.tasks.map((row) => ({ id: `task:${text(row.id)}`, kind: 'task' as const, at: text(row.created_at) || text(row.due_at), row }));
    const journey = data.patient.journey
      .filter((row) => !['call', 'appointment_booked'].includes(text(row.event_type)))
      .map((row) => ({ id: `journey:${text(row.id)}`, kind: 'journey' as const, at: text(row.occurred_at) || text(row.created_at), row }));
    return [...calls, ...appointments, ...tasks, ...journey]
      .filter((item) => Boolean(item.at))
      .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime())
      .slice(-50);
  }, [data]);

  useEffect(() => {
    setBranchId('');
    setDoctorId('');
    setService('');
    setSlots([]);
    setSlotId('');
    setFollowUpAction(text(selected?.next_action) || 'Перезвонить');
    setFollowUpDate(tomorrowDate());
    setFollowUpTime('11:00');
    setFollowUpCreated('');
    setPatientTab('history');
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
      setMessage('Пациент записан.');
      setSlots((items) => items.filter((slot) => slot.starts_at !== slotId));
      setSlotId('');
      await load(text(selected?.id), true);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally { setBusy(''); }
  };

  const createFollowUp = async () => {
    if (!followUpDate || !followUpTime || !patientPhone) return;
    const due = new Date(`${followUpDate}T${followUpTime}:00`);
    if (!Number.isFinite(due.getTime())) return;
    setBusy('followup');
    setMessage('');
    try {
      const title = `${followUpAction || 'Перезвонить'}: ${patientName}`;
      const description = [
        'Follow-up из IMDS Telephony',
        `Пациент: ${patientName}`,
        `Телефон: ${formatPhone(patientPhone)}`,
        text(selected?.id) ? `Звонок: ${text(selected?.id)}` : '',
      ].filter(Boolean).join('\n');
      await tasksApi.create({
        title,
        description,
        priority: 'medium',
        dueAt: due.toISOString(),
        assignmentMode: 'shared',
        targets: [{ targetType: 'user', targetValue: user.id, targetLabel: user.name || user.email || 'Текущий оператор' }],
      });
      setFollowUpCreated(`Создано · ${due.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}`);
      await load(text(selected?.id), true);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally { setBusy(''); }
  };

  const noDirectory = !(data?.clinic.branches || []).length || !(data?.clinic.doctors || []).length;
  const tabs: Array<[PatientTab, string]> = [['history', 'История'], ['profile', 'Профиль'], ['notes', 'Заметки'], ['files', 'Файлы'], ['tasks', 'Задачи']];

  return <div className="telephony-operator">
    {message && <div className="telephony-operator__message">{message}</div>}
    {loading && <div className="telephony-operator__loading"><LoaderCircle className="spin"/> Загружаем рабочее место…</div>}

    {!loading && data && <div className="telephony-operator__grid">
      <aside className="telephony-queue">
        <header className="telephony-panel-head">
          <div><PhoneCall size={16}/><strong>Очередь</strong></div>
          <div className="telephony-panel-head__actions">
            <button type="button" className={searchOpen ? 'active' : ''} onClick={() => setSearchOpen((value) => !value)} title="Поиск и фильтр"><SlidersHorizontal size={15}/></button>
            <button type="button" onClick={() => void load(selectedCallId || undefined)} title="Обновить"><RefreshCw size={15}/></button>
          </div>
        </header>
        {searchOpen && <label className="telephony-search"><Search size={14}/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Пациент или номер"/></label>}
        <div className="telephony-queue__groups">
          <QueueGroup title="LIVE" count={liveCalls.length} tone="live" calls={liveCalls} selectedId={text(selected?.id)} onChoose={(id) => void chooseCall(id)}/>
          <QueueGroup title="ПРОПУЩЕННЫЕ" count={missedCalls.length} tone="missed" calls={missedCalls} selectedId={text(selected?.id)} onChoose={(id) => void chooseCall(id)}/>
          <QueueGroup title="ТРЕБУЮТ ДЕЙСТВИЯ" count={actionCalls.length} tone="action" calls={actionCalls} selectedId={text(selected?.id)} onChoose={(id) => void chooseCall(id)}/>
          <QueueGroup title="ПОСЛЕДНИЕ" count={recentCalls.length} calls={recentCalls} selectedId={text(selected?.id)} onChoose={(id) => void chooseCall(id)}/>
          {!visibleCalls.length && <div className="telephony-empty">Нет звонков по текущему поиску.</div>}
        </div>
        <button type="button" className="telephony-queue__all" onClick={() => setShowAllRecent((value) => !value)}><Phone size={14}/>{showAllRecent ? 'Свернуть' : 'Все звонки'}</button>
      </aside>

      <main className="telephony-patient">
        <header className="telephony-patient__hero">
          <div className="telephony-patient__avatar"><UserRound size={23}/></div>
          <div className="telephony-patient__identity">
            <div><h2>{patientName}</h2><span>ПАЦИЕНТ</span></div>
            <p>{formatPhone(patientPhone)}</p>
          </div>
          <div className="telephony-patient__actions">
            <button type="button" onClick={sendToDialer} disabled={!patientPhone}><PhoneCall size={14}/>Позвонить</button>
            <button type="button" onClick={() => navigate('/chat')} disabled={!patientPhone}><MessageCircle size={14}/>WhatsApp</button>
            <button type="button" onClick={() => lead && navigate(`/customers?lead_id=${encodeURIComponent(text(lead.id))}`)} disabled={!lead} title="Карточка клиента"><Ellipsis size={16}/></button>
          </div>
        </header>

        <section className="telephony-patient__meta">
          <div><span>Источник</span><strong>{selectedAttribution.label}</strong><small>{selectedAttribution.kind}</small></div>
          {responsible && <div><span>Ответственный</span><strong>{responsible}</strong></div>}
          {selectedAttribution.kind === 'PAID' && text(lead?.campaign_id || selected?.campaign_id) && <div><span>Кампания</span><strong>{text(lead?.campaign_id || selected?.campaign_id)}</strong></div>}
          {selectedAttribution.kind === 'PAID' && text(lead?.ad_id || selected?.ad_id) && <div><span>Объявление</span><strong>{text(lead?.ad_id || selected?.ad_id)}</strong></div>}
        </section>

        <nav className="telephony-patient__tabs" aria-label="Пациент">
          {tabs.map(([id, label]) => <button key={id} type="button" className={patientTab === id ? 'active' : ''} onClick={() => setPatientTab(id)}>{label}</button>)}
        </nav>

        {patientTab === 'history' && <section className="telephony-timeline">
          <div className="telephony-timeline__day"><span/>Сегодня<span/></div>
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
                <div className="telephony-timeline__time">{timeOnly(item.at)}</div><div className="telephony-timeline__card simple"><span className="telephony-timeline__icon appointment"><CalendarPlus size={15}/></span><div><strong>Запись</strong><small>{dateTime(item.row.starts_at)}{text(item.row.service) ? ` · ${text(item.row.service)}` : ''}{text(item.row.doctor_name) ? ` · ${text(item.row.doctor_name)}` : ''}</small></div></div>
              </article>;
              if (item.kind === 'task') return <article key={item.id} className="telephony-timeline__item">
                <div className="telephony-timeline__time">{timeOnly(item.at)}</div><div className="telephony-timeline__card simple"><span className="telephony-timeline__icon task"><CheckCircle2 size={15}/></span><div><strong>{text(item.row.title) || 'Задача'}</strong><small>{dateTime(item.row.due_at || item.row.created_at)}{text(item.row.status) ? ` · ${text(item.row.status)}` : ''}</small></div></div>
              </article>;
              const channel = text(item.row.channel) || text(item.row.source) || 'IMDS';
              const body = text(item.row.message_text) || text(item.row.content) || text(item.row.description);
              return <article key={item.id} className="telephony-timeline__item">
                <div className="telephony-timeline__time">{timeOnly(item.at)}</div><div className="telephony-timeline__card simple"><span className="telephony-timeline__icon message"><MessageCircle size={15}/></span><div><strong>{channel.toLowerCase().includes('whatsapp') ? 'WhatsApp' : eventLabel(item.row.event_type)}</strong><small>{eventLabel(item.row.event_type)}{body ? ` · ${body}` : ` · ${channel}`}</small></div></div>
              </article>;
            })}
            {!timeline.length && <div className="telephony-empty">История взаимодействий пока пуста.</div>}
          </div>
        </section>}

        {patientTab === 'profile' && <section className="telephony-patient-panel">
          <div><span>Имя</span><strong>{patientName}</strong></div>
          <div><span>Телефон</span><strong>{formatPhone(patientPhone)}</strong></div>
          {text(lead?.stage) && <div><span>Этап</span><strong>{text(lead?.stage)}</strong></div>}
          {text(lead?.source || selected?.source) && <div><span>Источник</span><strong>{selectedAttribution.label}</strong></div>}
        </section>}
        {patientTab === 'notes' && <div className="telephony-empty telephony-tab-empty">Заметки не возвращаются текущим Phone Workspace API.</div>}
        {patientTab === 'files' && <div className="telephony-empty telephony-tab-empty">Файлы не возвращаются текущим Phone Workspace API.</div>}
        {patientTab === 'tasks' && <section className="telephony-patient-panel telephony-patient-panel--tasks">
          {data.patient.tasks.map((task) => <div key={text(task.id)}><span>{dateTime(task.due_at || task.created_at)}</span><strong>{text(task.title) || 'Задача'}</strong></div>)}
          {!data.patient.tasks.length && <div className="telephony-empty compact">Задач по пациенту нет.</div>}
        </section>}
      </main>

      <aside className="telephony-assist">
        <section className="telephony-assist__card telephony-assist__ai">
          <header><div><BrainCircuit size={17}/><strong>IMDS Call AI</strong></div>{selected?.ai_confidence != null && <span>{Math.round(numberValue(selected.ai_confidence))}%</span>}</header>
          {text(selected?.summary) && <div className="telephony-assist__summary"><Sparkles size={15}/><p>{text(selected?.summary)}</p></div>}
          <dl>
            <div><dt>Причина обращения</dt><dd>{text(selected?.request_reason) || 'Нет данных'}</dd></div>
            <div><dt>Потребность</dt><dd>{text(selected?.patient_pain) || 'Нет данных'}</dd></div>
            <div><dt>Возражения</dt><dd>{strings(selected?.objections).join(', ') || 'Нет данных'}</dd></div>
            <div><dt>Следующий лучший шаг</dt><dd>{text(selected?.next_action) || 'Нет данных'}</dd></div>
          </dl>
          <div className="telephony-assist__actions">
            <button type="button" onClick={() => void runTranscribe(text(selected?.id))} disabled={busy !== '' || text(selected?.call_status) !== 'COMPLETED'}><Stethoscope size={14}/>Текст + AI</button>
            <button type="button" onClick={() => void runAnalyze(text(selected?.id))} disabled={busy !== '' || !text(selected?.transcript)}><BrainCircuit size={14}/>Анализ разговора</button>
          </div>
        </section>

        <section className="telephony-assist__card telephony-booking">
          <header><div><CalendarPlus size={17}/><strong>Быстрая запись</strong></div></header>
          {noDirectory ? <div className="telephony-booking__setup"><strong>Расписание не настроено</strong><p>Нет доступных филиалов или врачей. Фиктивные слоты не создаются.</p></div> : <>
            <div className="telephony-booking__row two">
              <label><span>Филиал</span><select value={branchId} onChange={(event) => { setBranchId(event.target.value); setDoctorId(''); setSlots([]); setSlotId(''); }}><option value="">Выберите</option>{data.clinic.branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label>
              <label><span>Врач</span><select value={doctorId} onChange={(event) => void loadSlots(event.target.value)} disabled={!branchId}><option value="">Выберите</option>{doctors.map((doctor) => <option key={doctor.id} value={doctor.id}>{doctor.name}</option>)}</select></label>
            </div>
            <label><span>Услуга</span><input value={service} onChange={(event) => setService(event.target.value)} placeholder={text(selected?.request_reason) || 'Услуга'}/></label>
            <label><span>Дата и время</span><select value={slotId} onChange={(event) => setSlotId(event.target.value)} disabled={!doctorId || busy === 'slots'}><option value="">{busy === 'slots' ? 'Ищем слоты…' : slots.length ? 'Выберите время' : 'Нет выбранного времени'}</option>{slots.map((slot) => <option key={slot.id} value={slot.starts_at}>{dateOnly(slot.starts_at)} · {timeOnly(slot.starts_at)} · {slot.slot_minutes} мин</option>)}</select></label>
            <button className="telephony-booking__submit" type="button" onClick={() => void createAppointment()} disabled={!slotId || busy !== ''}>{busy === 'appointment' ? <LoaderCircle className="spin" size={15}/> : <CheckCircle2 size={15}/>}Записать пациента</button>
          </>}
        </section>

        <section className="telephony-assist__card telephony-followup">
          <header><div><Clock3 size={17}/><strong>Follow-up</strong></div></header>
          <label><span>Что сделать</span><select value={followUpAction} onChange={(event) => setFollowUpAction(event.target.value)}><option>Перезвонить</option><option>Уточнить решение</option><option>Отправить информацию</option></select></label>
          <div className="telephony-booking__row two">
            <label><span>Когда</span><input type="date" value={followUpDate} onChange={(event) => setFollowUpDate(event.target.value)}/></label>
            <label><span>Время</span><input type="time" value={followUpTime} onChange={(event) => setFollowUpTime(event.target.value)}/></label>
          </div>
          <button type="button" onClick={() => void createFollowUp()} disabled={!followUpDate || !followUpTime || !patientPhone || busy !== ''}>{busy === 'followup' ? <LoaderCircle className="spin" size={15}/> : <CheckCircle2 size={15}/>}Создать задачу</button>
          {followUpCreated && <div className="telephony-followup__success">{followUpCreated}</div>}
        </section>
      </aside>
    </div>}
  </div>;
}
