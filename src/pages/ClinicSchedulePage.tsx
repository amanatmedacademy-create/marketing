import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, Clock3, LockKeyhole, Phone, Plus, RefreshCw, Search, X } from 'lucide-react';
import '../clinic-schedule.css';

type Branch = { id: string; name: string; address?: string | null; active: boolean; sort_order: number };
type Doctor = { id: string; branch_id: string; name: string; specialty?: string | null; active: boolean; sort_order: number };
type Schedule = { id: string; doctor_id: string; weekday: number; start_time: string; end_time: string; slot_minutes: number; active: boolean };
type Patient = { id: string; name: string; phone?: string | null; email?: string | null; last_visit_at?: string | null; next_visit_at?: string | null; metadata?: Record<string, unknown> | null };
type AppointmentStatus = 'BOOKED'|'CONFIRMED'|'ARRIVED'|'COMPLETED'|'CANCELLED'|'NO_SHOW';
type Appointment = { id: string; branch_id: string; doctor_id: string; lead_id?: string | null; patient_id?: string | null; starts_at: string; ends_at: string; patient_name: string; phone: string; status: AppointmentStatus; source?: string | null; metadata?: Record<string, unknown> | null };
type BlockType = 'training'|'lunch'|'meeting'|'maintenance'|'personal'|'other';
type ScheduleBlock = { id: string; doctor_id: string; starts_at: string; ends_at: string; block_type: BlockType; title: string; note?: string | null; metadata?: Record<string, unknown> | null };
type Snapshot = { branches: Branch[]; doctors: Doctor[]; schedules: Schedule[]; appointments: Appointment[]; patients: Patient[]; blocks: ScheduleBlock[]; timezone: string };
type Draft = { kind: 'appointment'|'block'; id?: string; doctorId: string; patientId: string; patientName: string; phone: string; date: string; time: string; duration: number; note: string; blockType: BlockType; blockTitle: string };
type Toast = { id: number; message: string; tone: 'ok'|'warn'|'err' };
type Tooltip = { appointment: Appointment; x: number; y: number } | null;

const STATUS_LABELS: Record<AppointmentStatus,string> = { BOOKED:'Записан', CONFIRMED:'Подтверждён', ARRIVED:'Пришёл', COMPLETED:'Выполнено', CANCELLED:'Отменён', NO_SHOW:'Неявка' };
const BLOCK_LABELS: Record<BlockType,string> = { training:'Обучение', lunch:'Обед', meeting:'Собрание', maintenance:'Ремонт / тех. окно', personal:'Личное время', other:'Другое' };
const STEPS = [60,30,15] as const;
const WORKDAY_START = 8 * 60;
const WORKDAY_END = 21 * 60;
const SLOT_HEIGHT = 50;

function dateKey(value: Date) {
  const parts = new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Almaty',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(value);
  const map = Object.fromEntries(parts.map((part)=>[part.type,part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}
function addDays(key: string, amount: number) { const d = new Date(`${key}T12:00:00+05:00`); d.setUTCDate(d.getUTCDate() + amount); return dateKey(d); }
function minutes(value: string) { const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Almaty',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(value)).split(':').map(Number); return parts[0]*60+parts[1]; }
function minuteLabel(value: number) { return `${String(Math.floor(value / 60)).padStart(2,'0')}:${String(value % 60).padStart(2,'0')}`; }
function timeLabel(value: string) { return new Date(value).toLocaleTimeString('ru-KZ',{hour:'2-digit',minute:'2-digit',timeZone:'Asia/Almaty'}); }
function fullDate(key: string) { return new Date(`${key}T12:00:00+05:00`).toLocaleDateString('ru-KZ',{weekday:'short',day:'numeric',month:'long',timeZone:'Asia/Almaty'}); }
function appointmentIso(key: string, time: string) { return new Date(`${key}T${time}:00+05:00`).toISOString(); }
function durationMinutes(item: { starts_at:string; ends_at:string }) { return Math.max(15, Math.round((new Date(item.ends_at).getTime() - new Date(item.starts_at).getTime()) / 60000)); }
function initials(name: string) { return name.split(/\s+/).filter(Boolean).slice(0,2).map((x)=>x[0]?.toUpperCase()).join('') || '?'; }
function appointmentDate(item: Appointment) { return new Date(item.starts_at).toLocaleDateString('ru-KZ',{day:'numeric',month:'long',year:'numeric',timeZone:'Asia/Almaty'}); }
function safePhone(value: string) { return value.replace(/\D/g,''); }
function overlaps(startA:string,endA:string,startB:string,endB:string) { return new Date(startA)<new Date(endB) && new Date(endA)>new Date(startB); }

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache:'no-store', ...init, headers:{ accept:'application/json','content-type':'application/json',...init?.headers } });
  const payload = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
  return payload;
}

function monthDays(current: string) {
  const selected = new Date(`${current}T12:00:00+05:00`);
  const first = new Date(selected.getFullYear(), selected.getMonth(), 1, 12);
  const start = new Date(first); start.setDate(first.getDate() - ((first.getDay() + 6) % 7));
  return Array.from({length:42},(_,i)=>{ const d=new Date(start); d.setDate(start.getDate()+i); return { key:dateKey(d), day:d.getDate(), other:d.getMonth()!==selected.getMonth() }; });
}

function blankDraft(doctorId:string,date:string,minute:number):Draft {
  return { kind:'appointment', doctorId, patientId:'', patientName:'', phone:'', date, time:minuteLabel(minute), duration:30, note:'', blockType:'lunch', blockTitle:'Обед' };
}

export default function ClinicSchedulePage() {
  const [selectedDate,setSelectedDate] = useState(dateKey(new Date()));
  const [data,setData] = useState<Snapshot>({branches:[],doctors:[],schedules:[],appointments:[],patients:[],blocks:[],timezone:'Asia/Almaty'});
  const [loading,setLoading] = useState(true);
  const [query,setQuery] = useState('');
  const [doctorFilter,setDoctorFilter] = useState('');
  const [step,setStep] = useState<(typeof STEPS)[number]>(30);
  const [selected,setSelected] = useState<Appointment|null>(null);
  const [draft,setDraft] = useState<Draft|null>(null);
  const [saving,setSaving] = useState(false);
  const [draggedId,setDraggedId] = useState('');
  const [toasts,setToasts] = useState<Toast[]>([]);
  const [month,setMonth] = useState(()=>dateKey(new Date()));
  const [tooltip,setTooltip] = useState<Tooltip>(null);
  const [mobileDoctor,setMobileDoctor] = useState('');
  const scrollRef = useRef<HTMLDivElement|null>(null);

  const toast = (message:string,tone:Toast['tone']='ok') => { const id=Date.now()+Math.random(); setToasts((x)=>[...x,{id,message,tone}]); window.setTimeout(()=>setToasts((x)=>x.filter((t)=>t.id!==id)),3200); };
  const load = async () => { setLoading(true); try { const next=await api<Snapshot>(`/api/clinic-schedule?date=${selectedDate}`); setData({...next,blocks:next.blocks||[]}); setSelected((current)=>current ? next.appointments.find((x)=>x.id===current.id) || null : null); } catch(error) { toast(error instanceof Error ? error.message : String(error),'err'); } finally { setLoading(false); } };
  useEffect(()=>{ void load(); },[selectedDate]);
  useEffect(()=>{ setMonth(selectedDate); },[selectedDate]);

  const activeDoctors = useMemo(()=>data.doctors.filter((x)=>x.active && (!doctorFilter || x.id===doctorFilter)),[data.doctors,doctorFilter]);
  const normalizedQuery=query.trim().toLowerCase();
  const appointments=useMemo(()=>data.appointments.filter((x)=>!normalizedQuery || `${x.patient_name} ${x.phone}`.toLowerCase().includes(normalizedQuery)),[data.appointments,normalizedQuery]);
  const timeSlots=useMemo(()=>{ const out:number[]=[]; for(let m=WORKDAY_START;m<WORKDAY_END;m+=step) out.push(m); return out; },[step]);
  const dayAppointmentsByDoctor=useMemo(()=>new Map(activeDoctors.map((doctor)=>[doctor.id,appointments.filter((x)=>x.doctor_id===doctor.id)])),[activeDoctors,appointments]);
  const dayBlocksByDoctor=useMemo(()=>new Map(activeDoctors.map((doctor)=>[doctor.id,data.blocks.filter((x)=>x.doctor_id===doctor.id)])),[activeDoctors,data.blocks]);
  const calendar=useMemo(()=>monthDays(month),[month]);
  const appointmentDays=useMemo(()=>new Set(data.appointments.map((x)=>dateKey(new Date(x.starts_at)))),[data.appointments]);
  const counters=useMemo(()=>({today:new Set(data.appointments.map((x)=>x.patient_id||x.phone||x.patient_name)).size,arrived:data.appointments.filter((x)=>x.status==='ARRIVED'||x.status==='COMPLETED').length,completed:data.appointments.filter((x)=>x.status==='COMPLETED').length,cancelled:data.appointments.filter((x)=>x.status==='CANCELLED'||x.status==='NO_SHOW').length}),[data.appointments]);
  const mobileDoctors=useMemo(()=>data.doctors.filter((x)=>x.active),[data.doctors]);
  const mobileAppointments=useMemo(()=>data.appointments.filter((item)=>!mobileDoctor||item.doctor_id===mobileDoctor).sort((a,b)=>new Date(a.starts_at).getTime()-new Date(b.starts_at).getTime()),[data.appointments,mobileDoctor]);
  const selectedPatient=useMemo(()=>selected?.patient_id ? data.patients.find((x)=>x.id===selected.patient_id) : undefined,[data.patients,selected]);
  const patientAppointments=useMemo(()=>selected ? data.appointments.filter((item)=>item.id!==selected.id && ((selected.patient_id&&item.patient_id===selected.patient_id)||(!selected.patient_id&&item.phone===selected.phone))).sort((a,b)=>new Date(a.starts_at).getTime()-new Date(b.starts_at).getTime()) : [],[data.appointments,selected]);

  const createDraft=(doctorId:string,minute:number)=>setDraft(blankDraft(doctorId,selectedDate,minute));
  const editDraft=(item:Appointment)=>setDraft({kind:'appointment',id:item.id,doctorId:item.doctor_id,patientId:item.patient_id||'',patientName:item.patient_name,phone:item.phone||'',date:dateKey(new Date(item.starts_at)),time:timeLabel(item.starts_at),duration:durationMinutes(item),note:typeof item.metadata?.note==='string'?item.metadata.note:'',blockType:'lunch',blockTitle:'Обед'});
  const planNext=(item:Appointment)=>{ const nextDoctor=item.doctor_id; const nextDate=addDays(selectedDate,1); setSelected(null); setSelectedDate(nextDate); window.setTimeout(()=>setDraft({...blankDraft(nextDoctor,nextDate,9*60),patientId:item.patient_id||'',patientName:item.patient_name,phone:item.phone||'',duration:durationMinutes(item),note:'Следующая запись'}),0); };

  const saveDraft=async()=>{
    if(!draft) return;
    setSaving(true);
    try {
      const startsAt=appointmentIso(draft.date,draft.time); const endsAt=new Date(new Date(startsAt).getTime()+draft.duration*60000).toISOString();
      if(draft.kind==='block') {
        if(!draft.doctorId || !draft.blockTitle.trim()) throw new Error('Укажите специалиста и название блокировки');
        await api('/api/clinic-schedule',{method:'POST',body:JSON.stringify({action:'create_block',doctor_id:draft.doctorId,starts_at:startsAt,ends_at:endsAt,block_type:draft.blockType,title:draft.blockTitle.trim(),note:draft.note})});
        setDraft(null); toast('Время закрыто'); if(draft.date!==selectedDate) setSelectedDate(draft.date); else await load(); return;
      }
      if(!draft.doctorId || !draft.patientName.trim()) throw new Error('Укажите специалиста и пациента');
      await api('/api/clinic-schedule',{method:'POST',body:JSON.stringify(draft.id ? {action:'update_appointment',id:draft.id,patient_id:draft.patientId||null,patient_name:draft.patientName,phone:draft.phone,note:draft.note} : {action:'create_appointment',doctor_id:draft.doctorId,patient_id:draft.patientId||null,patient_name:draft.patientName,phone:draft.phone,starts_at:startsAt,ends_at:endsAt,note:draft.note})});
      if(draft.id) {
        const original=data.appointments.find((x)=>x.id===draft.id);
        if(original && (original.doctor_id!==draft.doctorId || timeLabel(original.starts_at)!==draft.time || dateKey(new Date(original.starts_at))!==draft.date || durationMinutes(original)!==draft.duration)) {
          await api('/api/clinic-schedule',{method:'POST',body:JSON.stringify({action:'move_appointment',id:draft.id,doctor_id:draft.doctorId,starts_at:startsAt,ends_at:endsAt})});
        }
      }
      setDraft(null); toast(draft.id?'Запись обновлена':'Запись создана'); if(draft.date!==selectedDate) setSelectedDate(draft.date); else await load();
    } catch(error) { toast(error instanceof Error?error.message:String(error),'err'); } finally { setSaving(false); }
  };

  const deleteBlock=async(block:ScheduleBlock)=>{ if(!window.confirm(`Открыть время «${block.title}»?`)) return; try { await api('/api/clinic-schedule',{method:'POST',body:JSON.stringify({action:'delete_block',id:block.id})}); toast('Время снова доступно'); await load(); } catch(error){toast(error instanceof Error?error.message:String(error),'err');} };
  const changeStatus=async(item:Appointment,status:AppointmentStatus)=>{ try { await api('/api/clinic-schedule',{method:'POST',body:JSON.stringify({action:'set_appointment_status',id:item.id,status})}); toast(`Статус: ${STATUS_LABELS[status]}`); await load(); } catch(error){toast(error instanceof Error?error.message:String(error),'err');} };
  const remove=async(item:Appointment)=>{ if(!window.confirm('Удалить запись без возможности восстановления?')) return; try { await api('/api/clinic-schedule',{method:'POST',body:JSON.stringify({action:'delete_appointment',id:item.id})}); setSelected(null); toast('Запись удалена'); await load(); } catch(error){toast(error instanceof Error?error.message:String(error),'err');} };
  const move=async(item:Appointment,doctorId:string,minute:number)=>{ const startsAt=appointmentIso(selectedDate,minuteLabel(minute)); const endsAt=new Date(new Date(startsAt).getTime()+durationMinutes(item)*60000).toISOString(); try { await api('/api/clinic-schedule',{method:'POST',body:JSON.stringify({action:'move_appointment',id:item.id,doctor_id:doctorId,starts_at:startsAt,ends_at:endsAt})}); toast('Запись перенесена'); await load(); } catch(error){toast(error instanceof Error?error.message:String(error),'err');} };

  return <div className="mis-schedule-page">
    <header className="mis-schedule-topbar">
      <div className="mis-topbar-nav"><button className="today" onClick={()=>setSelectedDate(dateKey(new Date()))}>Сегодня</button><button onClick={()=>setSelectedDate(addDays(selectedDate,-1))}><ChevronLeft size={16}/></button><button onClick={()=>setSelectedDate(addDays(selectedDate,1))}><ChevronRight size={16}/></button><strong>{fullDate(selectedDate)}</strong></div>
      <div className="mis-topbar-controls"><label className="search"><Search size={15}/><input value={query} onChange={(e)=>setQuery(e.target.value)} placeholder="Поиск пациента..."/>{query&&<button onClick={()=>setQuery('')}><X size={12}/></button>}</label><select value={doctorFilter} onChange={(e)=>setDoctorFilter(e.target.value)}><option value="">Сотрудник</option>{data.doctors.filter((x)=>x.active).map((x)=><option key={x.id} value={x.id}>{x.name}</option>)}</select><div className="scale">{STEPS.map((x)=><button key={x} className={step===x?'active':''} onClick={()=>setStep(x)}>{x===60?'1 час':`${x} мин`}</button>)}</div></div>
      <div className="mis-topbar-stats"><div><span>Сегодня</span><b>{counters.today}</b></div><div><span>Пришли</span><b>{counters.arrived}</b></div><div><span>Завершили</span><b>{counters.completed}</b></div><div><span>Отменили</span><b>{counters.cancelled}</b></div></div>
      <button className="sync" onClick={()=>void load()} title="Синхронизировать"><RefreshCw size={16}/></button>
    </header>

    <div className="mis-schedule-workspace">
      <aside className="mis-schedule-sidebar">
        <section className="mini-calendar"><header><button onClick={()=>{const d=new Date(`${month}T12:00:00+05:00`);d.setMonth(d.getMonth()-1);setMonth(dateKey(d));}}>‹</button><strong>{new Date(`${month}T12:00:00+05:00`).toLocaleDateString('ru-KZ',{month:'long',year:'numeric',timeZone:'Asia/Almaty'})}</strong><button onClick={()=>{const d=new Date(`${month}T12:00:00+05:00`);d.setMonth(d.getMonth()+1);setMonth(dateKey(d));}}>›</button></header><div className="weekdays">{['Пн','Вт','Ср','Чт','Пт','Сб','Вс'].map((x)=><span key={x}>{x}</span>)}</div><div className="days">{calendar.map((d)=><button key={d.key} onClick={()=>setSelectedDate(d.key)} className={`${d.other?'other':''} ${d.key===selectedDate?'selected':''} ${d.key===dateKey(new Date())?'today':''}`}>{d.day}{appointmentDays.has(d.key)&&<i/>}</button>)}</div></section>
        <section className="doctor-list"><header><div><span>Специалисты</span><strong>{data.doctors.filter((x)=>x.active).length}</strong></div><small>Выберите одного или всех специалистов</small></header><button className={!doctorFilter?'active':''} onClick={()=>setDoctorFilter('')}><span>Все специалисты</span><b>{data.appointments.length}</b></button><div>{data.doctors.filter((x)=>x.active).map((doctor)=><button key={doctor.id} className={doctorFilter===doctor.id?'active':''} onClick={()=>setDoctorFilter(doctorFilter===doctor.id?'':doctor.id)}><span className="avatar">{initials(doctor.name)}</span><span><strong>{doctor.name}</strong><small>{doctor.specialty||'Специалист'}</small></span><b>{data.appointments.filter((x)=>x.doctor_id===doctor.id).length}</b></button>)}</div></section>
      </aside>

      <main className="mis-schedule-stage">
        {loading && <div className="schedule-loading">Загружаем расписание…</div>}
        <div ref={scrollRef} className={`mis-schedule-scroll step-${step}`}>
          <div className="mis-schedule-inner" style={{minWidth:52+Math.max(activeDoctors.length,1)*224}}>
            <div className="staff-header"><div className="time-header">Время</div>{activeDoctors.map((doctor)=><div className="staff-card" key={doctor.id}><span className="avatar">{initials(doctor.name)}</span><span><strong>{doctor.name}</strong><small>{doctor.specialty||'Специалист'}</small><em>● Работает</em></span></div>)}</div>
            <div className="grid-body" style={{height:timeSlots.length*SLOT_HEIGHT}}><div className="time-column">{timeSlots.map((m)=><div className="time-slot" style={{height:SLOT_HEIGHT}} key={m}><span>{minuteLabel(m)}</span></div>)}</div>{activeDoctors.map((doctor)=><div className={`staff-column ${draggedId?'drag-active':''}`} key={doctor.id}>{timeSlots.map((m)=>{const slotStart=appointmentIso(selectedDate,minuteLabel(m));const slotEnd=new Date(new Date(slotStart).getTime()+step*60000).toISOString();const blocked=(dayBlocksByDoctor.get(doctor.id)||[]).some((block)=>overlaps(slotStart,slotEnd,block.starts_at,block.ends_at));return <button key={m} className={`column-slot ${blocked?'schedule-blocked':''}`} style={{height:SLOT_HEIGHT}} title={blocked?'Время закрыто':'Двойной клик — создать запись'} onDoubleClick={()=>{if(!blocked)createDraft(doctor.id,m)}} onDragOver={(e)=>{if(!blocked)e.preventDefault()}} onDrop={(e:DragEvent<HTMLButtonElement>)=>{if(blocked)return;e.preventDefault();const id=draggedId||e.dataTransfer.getData('text/plain');setDraggedId('');const item=data.appointments.find((x)=>x.id===id);if(item) void move(item,doctor.id,m);}}/>})}{(dayBlocksByDoctor.get(doctor.id)||[]).map((block)=>{const top=((minutes(block.starts_at)-WORKDAY_START)/step)*SLOT_HEIGHT;const height=Math.max(42,(durationMinutes(block)/step)*SLOT_HEIGHT-6);return <article key={block.id} className={`schedule-block block-${block.block_type}`} style={{top,height}} onClick={()=>void deleteBlock(block)} title="Нажмите, чтобы открыть время"><div><LockKeyhole size={12}/><strong>{BLOCK_LABELS[block.block_type]}</strong></div><span>{timeLabel(block.starts_at)}–{timeLabel(block.ends_at)}</span><small>{block.title}</small></article>})}{(dayAppointmentsByDoctor.get(doctor.id)||[]).map((item)=>{const top=((minutes(item.starts_at)-WORKDAY_START)/step)*SLOT_HEIGHT;const height=Math.max(42,(durationMinutes(item)/step)*SLOT_HEIGHT-6);const movable=item.status==='BOOKED'||item.status==='CONFIRMED';return <article draggable={movable} key={item.id} onDragStart={(e)=>{if(!movable){e.preventDefault();return;}setDraggedId(item.id);e.dataTransfer.setData('text/plain',item.id)}} onDragEnd={()=>setDraggedId('')} onMouseEnter={(e)=>{const rect=e.currentTarget.getBoundingClientRect();setTooltip({appointment:item,x:Math.min(window.innerWidth-340,rect.right+8),y:Math.max(12,Math.min(window.innerHeight-250,rect.top))});}} onMouseLeave={()=>setTooltip(null)} onClick={()=>{setTooltip(null);setSelected(item)}} className={`appointment status-${item.status.toLowerCase()} ${normalizedQuery?'highlighted':''}`} style={{top,height}}><div className="appt-head"><strong>{item.patient_name}</strong><span>{timeLabel(item.starts_at)}</span></div><div className="appt-body"><b>{item.source||'Запись'}</b><small>{durationMinutes(item)} мин</small></div></article>})}</div>)}</div>
          </div>
        </div>
      </main>
    </div>

    <section className="mis-schedule-mobile" aria-label="Мобильное расписание">
      <header><div><CalendarDays size={17}/><strong>{fullDate(selectedDate)}</strong></div><button onClick={()=>void load()}><RefreshCw size={15}/></button></header>
      <div className="mobile-date-nav"><button onClick={()=>setSelectedDate(addDays(selectedDate,-1))}><ChevronLeft size={16}/></button><button onClick={()=>setSelectedDate(dateKey(new Date()))}>Сегодня</button><button onClick={()=>setSelectedDate(addDays(selectedDate,1))}><ChevronRight size={16}/></button></div>
      <select value={mobileDoctor} onChange={(e)=>setMobileDoctor(e.target.value)}><option value="">Все специалисты</option>{mobileDoctors.map((doctor)=><option key={doctor.id} value={doctor.id}>{doctor.name}</option>)}</select>
      <div className="mobile-appointment-list">{mobileAppointments.map((item)=><button key={item.id} onClick={()=>setSelected(item)}><time>{timeLabel(item.starts_at)}</time><span><strong>{item.patient_name}</strong><small>{data.doctors.find((x)=>x.id===item.doctor_id)?.name||'Специалист'} · {STATUS_LABELS[item.status]}</small></span><em>{durationMinutes(item)} мин</em></button>)}{!mobileAppointments.length&&<div className="mobile-empty">Записей на выбранный день нет.</div>}</div>
      <button className="mobile-add" onClick={()=>createDraft(mobileDoctor||mobileDoctors[0]?.id||'',9*60)}><Plus size={17}/> Новая запись</button>
    </section>

    {tooltip && <aside className="schedule-hover-tooltip" style={{left:tooltip.x,top:tooltip.y}}><header><span className="avatar">{initials(tooltip.appointment.patient_name)}</span><div><strong>{tooltip.appointment.patient_name}</strong><small>{tooltip.appointment.phone||'Телефон не указан'}</small></div></header><div><p><Clock3 size={13}/>{timeLabel(tooltip.appointment.starts_at)}–{timeLabel(tooltip.appointment.ends_at)} · {durationMinutes(tooltip.appointment)} мин</p><p>{data.doctors.find((x)=>x.id===tooltip.appointment.doctor_id)?.name||'Специалист'}</p><p>{STATUS_LABELS[tooltip.appointment.status]}</p></div><footer>Нажмите, чтобы открыть карточку визита</footer></aside>}

    {selected && <><button className="drawer-overlay" onClick={()=>setSelected(null)} aria-label="Закрыть"/><aside className="visit-drawer"><header><span className="avatar">{initials(selected.patient_name)}</span><div><h2>{selected.patient_name}</h2><p>{timeLabel(selected.starts_at)} · {appointmentDate(selected)}</p></div><button onClick={()=>setSelected(null)}>×</button></header><div className="visit-summary"><div className="visit-contact-row">{selected.phone&&<a href={`tel:${selected.phone}`}><Phone size={13}/>{selected.phone}</a>}{selectedPatient?.email&&<span>{selectedPatient.email}</span>}</div><dl><div><dt>Специалист</dt><dd>{data.doctors.find((x)=>x.id===selected.doctor_id)?.name||'—'}</dd></div><div><dt>Филиал</dt><dd>{data.branches.find((x)=>x.id===selected.branch_id)?.name||'—'}</dd></div><div><dt>Время</dt><dd>{timeLabel(selected.starts_at)}–{timeLabel(selected.ends_at)}</dd></div><div><dt>Длительность</dt><dd>{durationMinutes(selected)} минут</dd></div><div><dt>Статус</dt><dd>{STATUS_LABELS[selected.status]}</dd></div><div><dt>Источник</dt><dd>{selected.source||'—'}</dd></div></dl></div><div className="visit-status-actions"><button onClick={()=>void changeStatus(selected,'ARRIVED')}>Пришёл</button><button onClick={()=>void changeStatus(selected,'COMPLETED')}>Выполнено</button><button onClick={()=>void changeStatus(selected,'CANCELLED')}>Отменить</button><button onClick={()=>void changeStatus(selected,'NO_SHOW')}>Неявка</button></div><section><h3>Комментарий к визиту</h3><p>{typeof selected.metadata?.note==='string'&&selected.metadata.note?selected.metadata.note:'Нет комментария'}</p></section>{patientAppointments.length>0&&<section><h3>Другие записи пациента</h3><div className="visit-history-list">{patientAppointments.slice(0,6).map((item)=><button key={item.id} onClick={()=>setSelected(item)}><time>{timeLabel(item.starts_at)}</time><span>{STATUS_LABELS[item.status]}</span><small>{data.doctors.find((x)=>x.id===item.doctor_id)?.name||'Специалист'}</small></button>)}</div></section>}<footer><button className="primary" onClick={()=>editDraft(selected)}>Редактировать</button>{selected.phone&&<a href={`https://wa.me/${safePhone(selected.phone)}`} target="_blank" rel="noreferrer">WhatsApp</a>}<button className="next" onClick={()=>planNext(selected)}><CalendarDays size={14}/> Следующая запись</button><button className="delete" onClick={()=>void remove(selected)}>Удалить визит</button></footer></aside></>}

    {draft && <div className="schedule-modal-overlay" onMouseDown={(e)=>{if(e.target===e.currentTarget&&!saving)setDraft(null)}}><div className="schedule-modal"><header><div><span>{draft.id?'Редактирование записи':draft.kind==='block'?'Закрыть время':'Новая запись'}</span><h2>{draft.kind==='block'?(draft.blockTitle||BLOCK_LABELS[draft.blockType]):draft.patientName||'Выберите пациента'}</h2></div><button onClick={()=>setDraft(null)}>×</button></header>{!draft.id&&<div className="schedule-modal-tabs"><button className={draft.kind==='appointment'?'active':''} onClick={()=>setDraft({...draft,kind:'appointment'})}>Запись пациента</button><button className={draft.kind==='block'?'active':''} onClick={()=>setDraft({...draft,kind:'block',blockTitle:draft.blockTitle||BLOCK_LABELS[draft.blockType]})}><LockKeyhole size={13}/> Закрыть время</button></div>}<div className="modal-body">{draft.kind==='appointment'?<><label className="full"><span>Пациент</span><input value={draft.patientName} onChange={(e)=>setDraft({...draft,patientName:e.target.value,patientId:''})} list="schedule-patients" placeholder="ФИО пациента"/><datalist id="schedule-patients">{data.patients.map((p)=><option key={p.id} value={p.name}>{p.phone||''}</option>)}</datalist></label><label><span>Телефон</span><input value={draft.phone} onChange={(e)=>setDraft({...draft,phone:e.target.value})}/></label></>:<><label><span>Тип блокировки</span><select value={draft.blockType} onChange={(e)=>{const blockType=e.target.value as BlockType;setDraft({...draft,blockType,blockTitle:BLOCK_LABELS[blockType]})}}>{Object.entries(BLOCK_LABELS).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label><label><span>Название</span><input value={draft.blockTitle} onChange={(e)=>setDraft({...draft,blockTitle:e.target.value})} placeholder="Например, Обед"/></label></>}<label><span>Специалист</span><select value={draft.doctorId} onChange={(e)=>setDraft({...draft,doctorId:e.target.value})}>{data.doctors.filter((x)=>x.active).map((x)=><option key={x.id} value={x.id}>{x.name}</option>)}</select></label><label><span>Дата</span><input type="date" value={draft.date} onChange={(e)=>setDraft({...draft,date:e.target.value})}/></label><label><span>Время</span><input type="time" value={draft.time} step={step*60} onChange={(e)=>setDraft({...draft,time:e.target.value})}/></label><label><span>Длительность</span><select value={draft.duration} onChange={(e)=>setDraft({...draft,duration:Number(e.target.value)})}>{[15,30,45,60,90,120,180,240].map((x)=><option key={x} value={x}>{x} минут</option>)}</select></label><label className="full"><span>Комментарий</span><textarea value={draft.note} onChange={(e)=>setDraft({...draft,note:e.target.value})} placeholder={draft.kind==='block'?'Причина, участники, кабинет...':'Причина визита, указания, кабинет...'}/></label></div><footer><button onClick={()=>setDraft(null)}>Отмена</button><button className="primary" disabled={saving} onClick={()=>void saveDraft()}>{saving?'Сохраняем…':draft.id?'Сохранить изменения':draft.kind==='block'?'Закрыть время':'Создать запись'}</button></footer></div></div>}

    <div className="schedule-toasts">{toasts.map((t)=><div key={t.id} className={t.tone}>{t.message}</div>)}</div>
  </div>;
}
