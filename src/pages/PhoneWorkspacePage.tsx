import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Activity,
  BrainCircuit,
  CalendarPlus,
  CheckCircle2,
  Clock3,
  ExternalLink,
  History,
  LoaderCircle,
  MapPin,
  Phone,
  PhoneCall,
  RefreshCw,
  Search,
  Sparkles,
  Stethoscope,
  UserRound,
} from 'lucide-react';
import { telephonyApi } from '../services/telephony';
import '../phone-workspace.css';

type Row = Record<string, unknown>;
type Branch = { id: string; name: string; address?: string | null };
type Doctor = { id: string; branch_id: string; name: string; specialty?: string | null };
type Slot = { id: string; starts_at: string; ends_at: string; slot_minutes: number };
type Context = {
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

const text = (value: unknown) => typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim();
const bool = (value: unknown) => value === true;
const dateTime = (value: unknown) => text(value) ? new Date(text(value)).toLocaleString('ru-RU') : '—';
const timeOnly = (value: unknown) => text(value) ? new Date(text(value)).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : '—';
const dateOnly = (value: unknown) => text(value) ? new Date(text(value)).toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' }) : '—';
const duration = (value: unknown) => {
  const seconds = Math.max(0, Number(value || 0));
  return `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, '0')}`;
};

function formatPhone(value: unknown) {
  const digits = text(value).replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('7')) return `+7 ${digits.slice(1, 4)} ${digits.slice(4, 7)} ${digits.slice(7, 9)} ${digits.slice(9)}`;
  return text(value) || 'Без номера';
}

function eventLabel(value: unknown) {
  const labels: Record<string, string> = {
    lead_created: 'Лид создан', first_contact: 'Первый контакт', first_response: 'Первый ответ', qualified: 'Квалифицирован',
    call: 'Звонок', conversation: 'Диалог', message: 'Сообщение', appointment_booked: 'Запись создана', arrived: 'Пришёл', deal_created: 'Сделка', rejected: 'Отказ', sale: 'Продажа',
  };
  return labels[text(value)] || text(value) || 'Событие';
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...init, headers: { 'content-type': 'application/json', ...init?.headers }, cache: 'no-store' });
  const raw = await response.text();
  let payload: unknown = {};
  try { payload = raw ? JSON.parse(raw) : {}; } catch { payload = { error: raw }; }
  if (!response.ok) throw new Error((payload as { error?: string }).error || raw || `HTTP ${response.status}`);
  return payload as T;
}

export default function PhoneWorkspacePage() {
  const navigate = useNavigate();
  const [data, setData] = useState<Context | null>(null);
  const [selectedCallId, setSelectedCallId] = useState('');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [branchId, setBranchId] = useState('');
  const [doctorId, setDoctorId] = useState('');
  const [service, setService] = useState('');
  const [slots, setSlots] = useState<Slot[]>([]);
  const [slotId, setSlotId] = useState('');

  const load = useCallback(async (callId?: string, silent = false) => {
    if (!silent) setLoading(true);
    try {
      const params = new URLSearchParams();
      if (callId) params.set('call_id', callId);
      const next = await request<Context>(`/api/phone-workspace${params.size ? `?${params}` : ''}`);
      setData(next);
      if (!selectedCallId && next.selectedCall) setSelectedCallId(text(next.selectedCall.id));
      setMessage('');
    } catch (error) {
      if (!silent) setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      if (!silent) setLoading(false);
    }
  }, [selectedCallId]);

  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const timer = window.setInterval(() => void load(selectedCallId || undefined, true), 4000);
    return () => window.clearInterval(timer);
  }, [load, selectedCallId]);

  const activeId = text(data?.activeCall?.id);
  useEffect(() => {
    if (activeId && activeId !== selectedCallId) {
      setSelectedCallId(activeId);
      void load(activeId, true);
    }
  }, [activeId]); // eslint-disable-line react-hooks/exhaustive-deps

  const selected = data?.selectedCall || null;
  const lead = data?.patient.lead || null;
  const filteredCalls = useMemo(() => (data?.recentCalls || []).filter((call) => {
    const haystack = [call.client_name, call.client_phone, call.operator_name, call.call_result, call.source].map(text).join(' ').toLowerCase();
    return haystack.includes(query.trim().toLowerCase());
  }), [data?.recentCalls, query]);
  const doctors = useMemo(() => (data?.clinic.doctors || []).filter((doctor) => !branchId || doctor.branch_id === branchId), [data?.clinic.doctors, branchId]);

  useEffect(() => {
    setDoctorId(''); setSlots([]); setSlotId('');
  }, [branchId]);

  const chooseCall = async (id: string) => {
    setSelectedCallId(id);
    setBranchId(''); setDoctorId(''); setSlots([]); setSlotId(''); setMessage('');
    await load(id);
  };

  const loadSlots = async (nextDoctorId: string) => {
    setDoctorId(nextDoctorId); setSlotId(''); setSlots([]);
    if (!nextDoctorId) return;
    setBusy('slots');
    try {
      const result = await request<{ slots: Slot[] }>(`/api/phone-workspace/slots?doctor_id=${encodeURIComponent(nextDoctorId)}`);
      setSlots(result.slots || []);
      if (!(result.slots || []).length) setMessage('У выбранного врача нет свободных слотов на ближайшие 21 день.');
      else setMessage('');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally { setBusy(''); }
  };

  const createAppointment = async () => {
    if (!branchId || !doctorId || !slotId) return;
    setBusy('appointment'); setMessage('');
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
          patientName: text(lead?.name) || text(selected?.client_name),
          phone: text(lead?.phone) || text(selected?.client_phone),
        }),
      });
      setMessage('Запись создана. Patient Journey и offline conversion обновятся через существующий Growth Engine.');
      setSlots((items) => items.filter((slot) => slot.starts_at !== slotId));
      setSlotId('');
      await load(text(selected?.id), true);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally { setBusy(''); }
  };

  const analyze = async () => {
    const callId = text(selected?.id);
    if (!callId) return;
    setBusy('analyze'); setMessage('');
    try {
      const result = await request<{ call?: Row }>(`/api/growth/calls/${encodeURIComponent(callId)}/analyze`, { method: 'POST', body: '{}' });
      setMessage(result.call ? 'AI-анализ звонка обновлён.' : 'AI-анализ завершён.');
      await load(callId, true);
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(''); }
  };

  const transcribe = async () => {
    const callId = text(selected?.id);
    if (!callId) return;
    setBusy('transcribe'); setMessage('');
    try {
      const result = await telephonyApi.transcribe(callId);
      setMessage(result.analysisError ? `Текст готов, AI: ${result.analysisError}` : 'Транскрипция и доступный AI-анализ завершены.');
      await load(callId, true);
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(''); }
  };

  const callBack = async () => {
    const phone = text(lead?.phone) || text(selected?.client_phone);
    if (!phone) return;
    setBusy('callback'); setMessage('');
    try {
      const result = await telephonyApi.startCall(phone);
      setMessage(`Callback отправлен в Zadarma. Линия ${result.extension}.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(''); }
  };

  const noDirectory = !(data?.clinic.branches || []).length || !(data?.clinic.doctors || []).length;
  const isActive = text(selected?.call_status) === 'PENDING';

  return <div className="phone-workspace">
    <header className="phone-workspace__header">
      <div><span>IMDS PHONE</span><h1>Phone Workspace</h1><p>Звонок, пациент, история, AI и запись к врачу в одном окне.</p></div>
      <div className={`phone-workspace__live ${data?.activeCall ? 'is-live' : ''}`}><Activity size={17}/><div><strong>{data?.activeCall ? 'Входящий звонок' : 'Линия спокойна'}</strong><small>{data?.activeCall ? formatPhone(data.activeCall.client_phone) : 'Активных входящих нет'}</small></div></div>
    </header>

    {message && <div className="phone-workspace__message">{message}</div>}
    {loading && <div className="phone-workspace__loading"><LoaderCircle className="spin"/> Загружаем Phone Workspace…</div>}

    {!loading && data && <div className="phone-workspace__grid">
      <aside className="phone-workspace__queue">
        <div className="phone-workspace__panel-head"><div><PhoneCall size={17}/><strong>Линия</strong></div><button type="button" onClick={() => void load(selectedCallId || undefined)}><RefreshCw size={15}/></button></div>
        <label className="phone-workspace__search"><Search size={15}/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Пациент или номер"/></label>
        <div className="phone-workspace__call-list">
          {filteredCalls.map((call) => <button key={text(call.id)} type="button" className={`${text(call.id) === text(selected?.id) ? 'active' : ''} ${text(call.id) === activeId ? 'live' : ''}`} onClick={() => void chooseCall(text(call.id))}>
            <span className="phone-workspace__call-icon"><Phone size={15}/></span>
            <div><strong>{text(call.client_name) || formatPhone(call.client_phone)}</strong><small>{formatPhone(call.client_phone)} · {dateTime(call.started_at)}</small></div>
            <span className="phone-workspace__call-state">{text(call.call_status) === 'PENDING' ? 'LIVE' : text(call.call_direction) === 'INBOUND' ? 'IN' : 'OUT'}</span>
          </button>)}
          {!filteredCalls.length && <div className="phone-workspace__empty">Звонков пока нет.</div>}
        </div>
      </aside>

      <main className="phone-workspace__patient">
        <section className={`phone-workspace__hero ${isActive ? 'is-live' : ''}`}>
          <div className="phone-workspace__avatar"><UserRound size={25}/></div>
          <div className="phone-workspace__identity"><span>{isActive ? 'РАЗГОВОР ИДЁТ' : 'ПАЦИЕНТ'}</span><h2>{text(lead?.name) || text(selected?.client_name) || 'Неизвестный пациент'}</h2><p>{formatPhone(lead?.phone || selected?.client_phone)}</p></div>
          <div className="phone-workspace__hero-actions">
            <button type="button" onClick={() => void callBack()} disabled={busy === 'callback'}>{busy === 'callback' ? <LoaderCircle className="spin" size={15}/> : <PhoneCall size={15}/>} Позвонить</button>
            {lead && <button type="button" onClick={() => navigate(`/customers?lead_id=${encodeURIComponent(text(lead.id))}`)}><ExternalLink size={15}/> 360°</button>}
          </div>
        </section>

        <section className="phone-workspace__facts">
          <article><span>Источник</span><strong>{text(lead?.source) || text(selected?.source) || '—'}</strong></article>
          <article><span>Этап</span><strong>{text(lead?.stage) || '—'}</strong></article>
          <article><span>Первый ответ</span><strong>{lead?.first_response_seconds != null ? `${Number(lead.first_response_seconds)} сек` : '—'}</strong></article>
          <article><span>Звонок</span><strong>{duration(selected?.duration_seconds)}</strong></article>
        </section>

        <section className="phone-workspace__section">
          <div className="phone-workspace__section-title"><History size={17}/><strong>История пациента</strong><span>{data.patient.journey.length} событий</span></div>
          <div className="phone-workspace__timeline">
            {data.patient.journey.slice(0, 14).map((event) => <div key={text(event.id)}><span className="phone-workspace__dot"/><div><strong>{eventLabel(event.event_type)}</strong><small>{dateTime(event.occurred_at)} · {text(event.channel) || text(event.source) || 'IMDS'}</small></div></div>)}
            {!data.patient.journey.length && <div className="phone-workspace__empty">Для пациента ещё нет событий Journey.</div>}
          </div>
        </section>

        <section className="phone-workspace__section">
          <div className="phone-workspace__section-title"><Clock3 size={17}/><strong>Предыдущие звонки</strong><span>{data.patient.calls.length}</span></div>
          <div className="phone-workspace__history-calls">
            {data.patient.calls.slice(0, 8).map((call) => <button type="button" key={text(call.id)} onClick={() => void chooseCall(text(call.id))}><div><strong>{dateTime(call.started_at)}</strong><small>{text(call.call_result) || text(call.summary) || text(call.call_status)}</small></div><span>{duration(call.duration_seconds)}</span></button>)}
            {!data.patient.calls.length && <div className="phone-workspace__empty">История звонков пуста.</div>}
          </div>
        </section>
      </main>

      <aside className="phone-workspace__assistant">
        <section className="phone-workspace__ai">
          <div className="phone-workspace__section-title"><BrainCircuit size={18}/><strong>IMDS Call AI</strong>{selected?.ai_confidence != null && <span>{Number(selected.ai_confidence).toFixed(0)}%</span>}</div>
          <div className="phone-workspace__ai-summary"><Sparkles size={17}/><p>{text(selected?.summary) || (text(selected?.transcript) ? 'Транскрипт готов. Запустите AI-анализ.' : 'После записи разговора здесь появятся краткое содержание и следующий лучший шаг.')}</p></div>
          <dl>
            <div><dt>Запрос</dt><dd>{text(selected?.request_reason) || '—'}</dd></div>
            <div><dt>Потребность</dt><dd>{text(selected?.patient_pain) || '—'}</dd></div>
            <div><dt>Следующий шаг</dt><dd>{text(selected?.next_action) || '—'}</dd></div>
            <div><dt>Результат</dt><dd>{text(selected?.call_result) || '—'}</dd></div>
          </dl>
          {!!(selected?.objections as unknown[] || []).length && <div className="phone-workspace__chips">{(selected?.objections as unknown[]).map((item, index) => <span key={`${text(item)}-${index}`}>{text(item)}</span>)}</div>}
          <div className="phone-workspace__ai-actions">
            <button type="button" onClick={() => void transcribe()} disabled={busy !== '' || text(selected?.call_status) !== 'COMPLETED'}>{busy === 'transcribe' ? <LoaderCircle className="spin" size={15}/> : <Stethoscope size={15}/>} Текст + AI</button>
            <button type="button" onClick={() => void analyze()} disabled={busy !== '' || !text(selected?.transcript)}>{busy === 'analyze' ? <LoaderCircle className="spin" size={15}/> : <BrainCircuit size={15}/>} Анализ</button>
          </div>
        </section>

        <section className="phone-workspace__booking">
          <div className="phone-workspace__section-title"><CalendarPlus size={18}/><strong>Быстрая запись</strong></div>
          {noDirectory ? <div className="phone-workspace__setup-needed"><MapPin size={18}/><div><strong>Расписание не настроено</strong><p>Добавьте филиалы, врачей и график в WhatsApp Booking Setup. Фиктивные слоты IMDS не создаёт.</p></div></div> : <>
            <label><span>Филиал</span><select value={branchId} onChange={(event) => setBranchId(event.target.value)}><option value="">Выберите филиал</option>{data.clinic.branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label>
            <label><span>Врач</span><select value={doctorId} onChange={(event) => void loadSlots(event.target.value)} disabled={!branchId}><option value="">Выберите врача</option>{doctors.map((doctor) => <option key={doctor.id} value={doctor.id}>{doctor.name}{doctor.specialty ? ` · ${doctor.specialty}` : ''}</option>)}</select></label>
            <label><span>Услуга / причина</span><input value={service} onChange={(event) => setService(event.target.value)} placeholder={text(selected?.request_reason) || 'Например: консультация'}/></label>
            <label><span>Свободное время</span><select value={slotId} onChange={(event) => setSlotId(event.target.value)} disabled={!doctorId || busy === 'slots'}><option value="">{busy === 'slots' ? 'Ищем слоты…' : 'Выберите время'}</option>{slots.map((slot) => <option key={slot.id} value={slot.starts_at}>{dateOnly(slot.starts_at)} · {timeOnly(slot.starts_at)} · {slot.slot_minutes} мин</option>)}</select></label>
            <button className="phone-workspace__book" type="button" onClick={() => void createAppointment()} disabled={!slotId || busy !== ''}>{busy === 'appointment' ? <LoaderCircle className="spin" size={16}/> : <CheckCircle2 size={16}/>} Записать пациента</button>
          </>}
        </section>

        <section className="phone-workspace__tasks">
          <div className="phone-workspace__section-title"><CheckCircle2 size={17}/><strong>Follow-up</strong><span>{data.patient.tasks.length}</span></div>
          {data.patient.tasks.slice(0, 6).map((task) => <div key={text(task.id)}><strong>{text(task.title)}</strong><small>{text(task.status)} · {dateTime(task.due_at || task.created_at)}</small></div>)}
          {!data.patient.tasks.length && <div className="phone-workspace__empty">Нет задач по этому звонку.</div>}
        </section>
      </aside>
    </div>}
  </div>;
}
