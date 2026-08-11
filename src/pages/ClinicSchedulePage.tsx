import { useEffect, useMemo, useState } from 'react';
import { Building2, CalendarDays, CheckCircle2, Clock3, LoaderCircle, MapPin, Plus, RefreshCw, Stethoscope, UserRound, XCircle } from 'lucide-react';
import { useAuth } from '../components/AuthGate';
import '../clinic-schedule.css';

type Branch = { id: string; name: string; address?: string | null; active: boolean; sort_order: number };
type Doctor = { id: string; branch_id: string; name: string; specialty?: string | null; active: boolean; sort_order: number };
type Schedule = { id: string; doctor_id: string; weekday: number; start_time: string; end_time: string; slot_minutes: number; active: boolean };
type Appointment = { id: string; branch_id: string; doctor_id: string; starts_at: string; ends_at: string; patient_name: string; phone: string; status: 'BOOKED'|'CONFIRMED'|'COMPLETED'|'CANCELLED'|'NO_SHOW'; source?: string | null };
type Snapshot = { branches: Branch[]; doctors: Doctor[]; schedules: Schedule[]; appointments: Appointment[] };

const weekdays = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
const statusLabels: Record<Appointment['status'], string> = { BOOKED: 'Новая', CONFIRMED: 'Подтверждена', COMPLETED: 'Завершена', CANCELLED: 'Отменена', NO_SHOW: 'Неявка' };
const dt = (value: string) => new Date(value).toLocaleString('ru-KZ', { timeZone: 'Asia/Almaty', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

async function api<T>(init?: RequestInit): Promise<T> {
  const response = await fetch('/api/clinic-schedule', { cache: 'no-store', ...init, headers: { accept: 'application/json', 'content-type': 'application/json', ...init?.headers } });
  const payload = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
  return payload;
}

export default function ClinicSchedulePage() {
  const { user } = useAuth();
  const admin = user.role === 'administrator';
  const [data, setData] = useState<Snapshot>({ branches: [], doctors: [], schedules: [], appointments: [] });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [branchName, setBranchName] = useState('');
  const [branchAddress, setBranchAddress] = useState('');
  const [doctorBranch, setDoctorBranch] = useState('');
  const [doctorName, setDoctorName] = useState('');
  const [specialty, setSpecialty] = useState('');
  const [scheduleDoctor, setScheduleDoctor] = useState('');
  const [weekday, setWeekday] = useState(1);
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('18:00');
  const [slotMinutes, setSlotMinutes] = useState(30);

  const load = async () => {
    setLoading(true);
    try {
      const next = await api<Snapshot>();
      setData(next);
      setDoctorBranch((value) => value || next.branches.find((x) => x.active)?.id || '');
      setScheduleDoctor((value) => value || next.doctors.find((x) => x.active)?.id || '');
      setMessage('');
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setLoading(false); }
  };

  useEffect(() => { void load(); }, []);

  const action = async (payload: Record<string, unknown>, key: string) => {
    setBusy(key); setMessage('');
    try {
      await api({ method: 'POST', body: JSON.stringify(payload) });
      await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(''); }
  };

  const activeBranches = data.branches.filter((x) => x.active);
  const activeDoctors = data.doctors.filter((x) => x.active);
  const grouped = useMemo(() => weekdays.map((label, day) => ({ label, day, rows: data.schedules.filter((x) => x.weekday === day && x.active) })), [data.schedules]);
  const today = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Almaty', weekday: 'short' }).format(new Date());
  const todayIndex = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].indexOf(today);

  return <div className="clinic-schedule">
    <header className="clinic-schedule__header">
      <div><span>IMDS OPERATIONS</span><h1>Clinic Schedule</h1><p>Единое расписание для Phone Workspace и WhatsApp Flow.</p></div>
      <button type="button" onClick={() => void load()} disabled={loading}><RefreshCw size={16}/> Обновить</button>
    </header>

    {message && <div className="clinic-schedule__message">{message}</div>}
    {loading ? <div className="clinic-schedule__loading"><LoaderCircle className="spin"/> Загружаем расписание…</div> : <>
      <section className="clinic-schedule__metrics">
        <article><Building2/><span>Филиалы</span><strong>{activeBranches.length}</strong></article>
        <article><Stethoscope/><span>Врачи</span><strong>{activeDoctors.length}</strong></article>
        <article><Clock3/><span>Интервалы</span><strong>{data.schedules.filter((x) => x.active).length}</strong></article>
        <article><CalendarDays/><span>Будущие записи</span><strong>{data.appointments.filter((x) => ['BOOKED','CONFIRMED'].includes(x.status)).length}</strong></article>
      </section>

      <div className="clinic-schedule__layout">
        <main>
          <section className="clinic-schedule__panel">
            <div className="clinic-schedule__panel-head"><div><CalendarDays size={18}/><strong>Недельный график</strong></div><small>Asia/Almaty</small></div>
            <div className="clinic-schedule__week">
              {grouped.map((day) => <div key={day.day} className={day.day === todayIndex ? 'today' : ''}>
                <header>{day.label}{day.day === todayIndex && <span>сегодня</span>}</header>
                {day.rows.map((row) => {
                  const doctor = data.doctors.find((x) => x.id === row.doctor_id);
                  const branch = data.branches.find((x) => x.id === doctor?.branch_id);
                  return <article key={row.id}><strong>{doctor?.name || 'Врач'}</strong><span>{row.start_time.slice(0,5)}–{row.end_time.slice(0,5)}</span><small>{branch?.name || 'Филиал'} · {row.slot_minutes} мин</small>{admin && <button type="button" onClick={() => void action({ action:'set_active', entity:'schedule', id:row.id, active:false }, `schedule-${row.id}`)}>Отключить</button>}</article>;
                })}
                {!day.rows.length && <p>Нет графика</p>}
              </div>)}
            </div>
          </section>

          <section className="clinic-schedule__panel">
            <div className="clinic-schedule__panel-head"><div><UserRound size={18}/><strong>Ближайшие записи</strong></div><small>{data.appointments.length}</small></div>
            <div className="clinic-schedule__appointments">
              {data.appointments.map((item) => {
                const doctor = data.doctors.find((x) => x.id === item.doctor_id);
                const branch = data.branches.find((x) => x.id === item.branch_id);
                return <article key={item.id}>
                  <div><strong>{item.patient_name}</strong><small>{item.phone}</small></div>
                  <div><strong>{dt(item.starts_at)}</strong><small>{doctor?.name || 'Врач'} · {branch?.name || 'Филиал'}</small></div>
                  <span className={`status status--${item.status.toLowerCase()}`}>{statusLabels[item.status]}</span>
                  <div className="clinic-schedule__appointment-actions">
                    {item.status === 'BOOKED' && <button onClick={() => void action({ action:'set_appointment_status', id:item.id, status:'CONFIRMED' }, `appt-${item.id}`)}><CheckCircle2 size={14}/> Подтвердить</button>}
                    {(item.status === 'BOOKED' || item.status === 'CONFIRMED') && <button onClick={() => void action({ action:'set_appointment_status', id:item.id, status:'CANCELLED' }, `appt-${item.id}`)}><XCircle size={14}/> Отменить</button>}
                    {item.status === 'CONFIRMED' && <button onClick={() => void action({ action:'set_appointment_status', id:item.id, status:'COMPLETED' }, `appt-${item.id}`)}>Завершена</button>}
                    {item.status === 'CONFIRMED' && <button onClick={() => void action({ action:'set_appointment_status', id:item.id, status:'NO_SHOW' }, `appt-${item.id}`)}>Неявка</button>}
                  </div>
                </article>;
              })}
              {!data.appointments.length && <div className="clinic-schedule__empty">Предстоящих записей пока нет.</div>}
            </div>
          </section>
        </main>

        <aside>
          {!admin && <section className="clinic-schedule__panel clinic-schedule__notice"><MapPin size={19}/><div><strong>Режим просмотра</strong><p>Изменять филиалы, врачей и график может администратор клиники.</p></div></section>}

          {admin && <>
            <section className="clinic-schedule__panel clinic-schedule__form">
              <div className="clinic-schedule__panel-head"><div><Building2 size={18}/><strong>Филиал</strong></div></div>
              <label><span>Название</span><input value={branchName} onChange={(e) => setBranchName(e.target.value)} placeholder="Например, Абая"/></label>
              <label><span>Адрес</span><input value={branchAddress} onChange={(e) => setBranchAddress(e.target.value)} placeholder="Адрес"/></label>
              <button disabled={!branchName.trim() || !!busy} onClick={() => void action({ action:'save_branch', name:branchName.trim(), address:branchAddress.trim() }, 'branch').then(() => { setBranchName(''); setBranchAddress(''); })}>{busy === 'branch' ? <LoaderCircle className="spin" size={15}/> : <Plus size={15}/>} Добавить филиал</button>
              <div className="clinic-schedule__entities">{data.branches.map((x) => <div key={x.id}><div><strong>{x.name}</strong><small>{x.address || 'Без адреса'}</small></div><button onClick={() => void action({ action:'set_active', entity:'branch', id:x.id, active:!x.active }, `branch-${x.id}`)}>{x.active ? 'Отключить' : 'Включить'}</button></div>)}</div>
            </section>

            <section className="clinic-schedule__panel clinic-schedule__form">
              <div className="clinic-schedule__panel-head"><div><Stethoscope size={18}/><strong>Врач</strong></div></div>
              <label><span>Филиал</span><select value={doctorBranch} onChange={(e) => setDoctorBranch(e.target.value)}><option value="">Выберите</option>{activeBranches.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
              <label><span>ФИО</span><input value={doctorName} onChange={(e) => setDoctorName(e.target.value)} placeholder="ФИО врача"/></label>
              <label><span>Специализация</span><input value={specialty} onChange={(e) => setSpecialty(e.target.value)} placeholder="Например, стоматолог"/></label>
              <button disabled={!doctorBranch || !doctorName.trim() || !!busy} onClick={() => void action({ action:'save_doctor', branch_id:doctorBranch, name:doctorName.trim(), specialty:specialty.trim() }, 'doctor').then(() => { setDoctorName(''); setSpecialty(''); })}>{busy === 'doctor' ? <LoaderCircle className="spin" size={15}/> : <Plus size={15}/>} Добавить врача</button>
              <div className="clinic-schedule__entities">{data.doctors.map((x) => <div key={x.id}><div><strong>{x.name}</strong><small>{x.specialty || 'Без специализации'} · {data.branches.find((b) => b.id === x.branch_id)?.name || 'Филиал'}</small></div><button onClick={() => void action({ action:'set_active', entity:'doctor', id:x.id, active:!x.active }, `doctor-${x.id}`)}>{x.active ? 'Отключить' : 'Включить'}</button></div>)}</div>
            </section>

            <section className="clinic-schedule__panel clinic-schedule__form">
              <div className="clinic-schedule__panel-head"><div><Clock3 size={18}/><strong>Интервал работы</strong></div></div>
              <label><span>Врач</span><select value={scheduleDoctor} onChange={(e) => setScheduleDoctor(e.target.value)}><option value="">Выберите</option>{activeDoctors.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
              <div className="clinic-schedule__row"><label><span>День</span><select value={weekday} onChange={(e) => setWeekday(Number(e.target.value))}>{weekdays.map((x,i) => <option key={x} value={i}>{x}</option>)}</select></label><label><span>Слот</span><input type="number" min={5} max={240} step={5} value={slotMinutes} onChange={(e) => setSlotMinutes(Number(e.target.value))}/></label></div>
              <div className="clinic-schedule__row"><label><span>С</span><input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)}/></label><label><span>До</span><input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)}/></label></div>
              <button disabled={!scheduleDoctor || !startTime || !endTime || !!busy} onClick={() => void action({ action:'save_schedule', doctor_id:scheduleDoctor, weekday, start_time:startTime, end_time:endTime, slot_minutes:slotMinutes }, 'schedule')}>{busy === 'schedule' ? <LoaderCircle className="spin" size={15}/> : <Plus size={15}/>} Добавить интервал</button>
              <small>Пересекающиеся интервалы одного врача отклоняются. Слоты генерируются на 21 день вперёд.</small>
            </section>
          </>}
        </aside>
      </div>
    </>}
  </div>;
}
