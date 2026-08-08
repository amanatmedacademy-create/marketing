import { useEffect, useMemo, useState } from 'react';
import { Building2, CalendarClock, LoaderCircle, Plus, Stethoscope } from 'lucide-react';

type Branch = { id: string; name: string; address?: string | null; active: boolean };
type Doctor = { id: string; branch_id: string; name: string; specialty?: string | null; active: boolean };
type Schedule = { id: string; doctor_id: string; weekday: number; start_time: string; end_time: string; slot_minutes: number; active: boolean };
type BookingConfig = { branches: Branch[]; doctors: Doctor[]; schedules: Schedule[]; upcoming: unknown[]; error?: string };

type ApiPayload = Record<string, unknown>;
const weekdays = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];

async function api<T>(init?: RequestInit): Promise<T> {
  const response = await fetch('/api/integrations/waba/flows/clinic/booking', {
    cache: 'no-store',
    ...init,
    headers: { accept: 'application/json', 'content-type': 'application/json', ...init?.headers },
  });
  const value = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(value.error || `HTTP ${response.status}`);
  return value;
}

export default function WabaClinicBookingSetup({ enabled }: { enabled: boolean }) {
  const [data, setData] = useState<BookingConfig | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [branchName, setBranchName] = useState('');
  const [branchAddress, setBranchAddress] = useState('');
  const [doctorName, setDoctorName] = useState('');
  const [specialty, setSpecialty] = useState('');
  const [doctorBranch, setDoctorBranch] = useState('');
  const [scheduleDoctor, setScheduleDoctor] = useState('');
  const [weekday, setWeekday] = useState(1);
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('18:00');
  const [slotMinutes, setSlotMinutes] = useState(30);

  const load = async () => {
    if (!enabled) return;
    try {
      const value = await api<BookingConfig>();
      setData(value);
      setError('');
      if (!doctorBranch && value.branches[0]?.id) setDoctorBranch(value.branches[0].id);
      if (!scheduleDoctor && value.doctors[0]?.id) setScheduleDoctor(value.doctors[0].id);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    }
  };

  useEffect(() => { void load(); }, [enabled]);

  const save = async (payload: ApiPayload) => {
    setBusy(true);
    setError('');
    try {
      await api({ method: 'POST', body: JSON.stringify(payload) });
      await load();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setBusy(false);
    }
  };

  const activeBranches = useMemo(() => data?.branches.filter((item) => item.active) || [], [data]);
  const activeDoctors = useMemo(() => data?.doctors.filter((item) => item.active) || [], [data]);
  if (!enabled) return null;

  const fieldStyle = { display: 'grid', gap: 4 } as const;
  const rowStyle = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 8 } as const;
  const panelStyle = { display: 'grid', gap: 8, padding: 10, border: '1px solid rgba(148,163,184,.2)', borderRadius: 10 } as const;

  return <div style={{ display: 'grid', gap: 10, marginTop: 10 }}>
    <div style={panelStyle}>
      <strong><Building2 size={15}/> Филиалы</strong>
      <div style={rowStyle}>
        <label style={fieldStyle}><span>Название</span><input value={branchName} onChange={(e) => setBranchName(e.target.value)} placeholder="Например, Абая"/></label>
        <label style={fieldStyle}><span>Адрес</span><input value={branchAddress} onChange={(e) => setBranchAddress(e.target.value)} placeholder="Адрес филиала"/></label>
      </div>
      <button type="button" className="connections-button" disabled={busy || !branchName.trim()} onClick={() => void save({ action: 'save_branch', name: branchName.trim(), address: branchAddress.trim() }).then(() => { setBranchName(''); setBranchAddress(''); })}>
        {busy ? <LoaderCircle size={15} className="spin"/> : <Plus size={15}/>} Добавить филиал
      </button>
      {data?.branches.map((item) => <small className="meta-oauth-message" key={item.id}>{item.active ? '●' : '○'} {item.name}{item.address ? ` · ${item.address}` : ''}</small>)}
    </div>

    <div style={panelStyle}>
      <strong><Stethoscope size={15}/> Врачи</strong>
      <div style={rowStyle}>
        <label style={fieldStyle}><span>Филиал</span><select value={doctorBranch} onChange={(e) => setDoctorBranch(e.target.value)}>{activeBranches.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label style={fieldStyle}><span>Врач</span><input value={doctorName} onChange={(e) => setDoctorName(e.target.value)} placeholder="ФИО врача"/></label>
        <label style={fieldStyle}><span>Специализация</span><input value={specialty} onChange={(e) => setSpecialty(e.target.value)} placeholder="Специализация"/></label>
      </div>
      <button type="button" className="connections-button" disabled={busy || !doctorBranch || !doctorName.trim()} onClick={() => void save({ action: 'save_doctor', branch_id: doctorBranch, name: doctorName.trim(), specialty: specialty.trim() }).then(() => { setDoctorName(''); setSpecialty(''); })}>
        {busy ? <LoaderCircle size={15} className="spin"/> : <Plus size={15}/>} Добавить врача
      </button>
      {data?.doctors.map((item) => <small className="meta-oauth-message" key={item.id}>{item.active ? '●' : '○'} {item.name}{item.specialty ? ` · ${item.specialty}` : ''} · {data.branches.find((branch) => branch.id === item.branch_id)?.name || 'Филиал'}</small>)}
    </div>

    <div style={panelStyle}>
      <strong><CalendarClock size={15}/> Расписание и слоты</strong>
      <div style={rowStyle}>
        <label style={fieldStyle}><span>Врач</span><select value={scheduleDoctor} onChange={(e) => setScheduleDoctor(e.target.value)}>{activeDoctors.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label style={fieldStyle}><span>День</span><select value={weekday} onChange={(e) => setWeekday(Number(e.target.value))}>{weekdays.map((label, index) => <option key={label} value={index}>{label}</option>)}</select></label>
        <label style={fieldStyle}><span>С</span><input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)}/></label>
        <label style={fieldStyle}><span>До</span><input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)}/></label>
        <label style={fieldStyle}><span>Слот, мин</span><input type="number" min={5} max={240} step={5} value={slotMinutes} onChange={(e) => setSlotMinutes(Number(e.target.value))}/></label>
      </div>
      <button type="button" className="connections-button" disabled={busy || !scheduleDoctor || !startTime || !endTime} onClick={() => void save({ action: 'save_schedule', doctor_id: scheduleDoctor, weekday, start_time: startTime, end_time: endTime, slot_minutes: slotMinutes })}>
        {busy ? <LoaderCircle size={15} className="spin"/> : <Plus size={15}/>} Добавить расписание
      </button>
      {data?.schedules.map((item) => <small className="meta-oauth-message" key={item.id}>{item.active ? '●' : '○'} {data.doctors.find((doctor) => doctor.id === item.doctor_id)?.name || 'Врач'} · {weekdays[item.weekday]} · {item.start_time.slice(0,5)}–{item.end_time.slice(0,5)} · {item.slot_minutes} мин</small>)}
      <small className="meta-oauth-message">Свободные слоты генерируются на 21 день вперёд и автоматически исключают уже занятое время.</small>
    </div>

    {error && <small className="meta-oauth-message">{error}</small>}
  </div>;
}
