import type { Env } from './integrations';
import { requireCompanyId, type TenantScopedEnv } from './tenantScope';

type Row = Record<string, unknown>;
type ScopedEnv = Env & TenantScopedEnv;
type AppointmentStatus = 'BOOKED' | 'CONFIRMED' | 'ARRIVED' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW';
type ScheduleBlockType = 'training' | 'lunch' | 'meeting' | 'maintenance' | 'personal' | 'other';

const OCCUPYING_APPOINTMENT_STATUSES: AppointmentStatus[] = ['BOOKED', 'CONFIRMED', 'ARRIVED'];
const MOVABLE_APPOINTMENT_STATUSES: AppointmentStatus[] = ['BOOKED', 'CONFIRMED'];
const ALLOWED_APPOINTMENT_STATUSES = new Set<AppointmentStatus>(['BOOKED', 'CONFIRMED', 'ARRIVED', 'COMPLETED', 'CANCELLED', 'NO_SHOW']);
const ALLOWED_BLOCK_TYPES = new Set<ScheduleBlockType>(['training', 'lunch', 'meeting', 'maintenance', 'personal', 'other']);

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});
const text = (value: unknown): string => typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim();
const record = (value: unknown): Row => value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {};
const iso = (value: unknown): string => {
  const raw = text(value);
  const parsed = raw ? new Date(raw) : new Date('invalid');
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : '';
};
const time5 = (value: unknown): string => text(value).slice(0, 5);
const isMisAppointment = (row: Row): boolean => text(row.source).toUpperCase() === 'MIS' || record(row.metadata).external_busy === true;
const misReadOnlyError = () => json({ error: 'Запись создана в МИС и в Marketing доступна только как занятое время' }, 409);

function headers(env: Env, extra: HeadersInit = {}): Headers {
  const next = new Headers(extra);
  next.set('apikey', env.SUPABASE_SERVICE_ROLE_KEY);
  next.set('authorization', `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`);
  next.set('accept', 'application/json');
  if (!next.has('content-type')) next.set('content-type', 'application/json');
  return next;
}

async function db<T>(env: Env, path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/${path}`, {
    ...init,
    headers: headers(env, init.headers),
    cache: 'no-store',
  });
  const raw = await response.text();
  if (!response.ok) throw new Error(`Clinic Schedule DB ${response.status}: ${raw.slice(0, 1500)}`);
  return (raw ? JSON.parse(raw) : null) as T;
}

function admin(request: Request): boolean {
  return text(request.headers.get('x-amanat-auth-role')) === 'administrator';
}

function almatyDateKey(value: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Almaty', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(value);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function almatyDayRange(dateKey: string): { from: string; to: string } {
  const safe = /^\d{4}-\d{2}-\d{2}$/.test(dateKey) ? dateKey : almatyDateKey(new Date());
  const from = new Date(`${safe}T00:00:00+05:00`);
  const to = new Date(from.getTime() + 24 * 60 * 60 * 1000);
  return { from: from.toISOString(), to: to.toISOString() };
}

function appointmentRange(url: URL): { from: string; to: string } {
  const date = text(url.searchParams.get('date'));
  if (date) return almatyDayRange(date);
  const from = iso(url.searchParams.get('from'));
  const to = iso(url.searchParams.get('to'));
  if (from && to && new Date(to) > new Date(from)) return { from, to };
  return almatyDayRange(almatyDateKey(new Date()));
}

function almatyWeekday(value: string): number {
  const shifted = new Date(new Date(value).getTime() + 5 * 60 * 60 * 1000);
  return shifted.getUTCDay();
}

function monthRange(month: string): { from: string; to: string; month: string } {
  const safe = /^\d{4}-\d{2}$/.test(month) ? month : almatyDateKey(new Date()).slice(0, 7);
  const from = new Date(`${safe}-01T00:00:00+05:00`);
  const next = new Date(from.getTime());
  next.setUTCMonth(next.getUTCMonth() + 1);
  return { from: from.toISOString(), to: next.toISOString(), month: safe };
}

async function snapshot(env: ScopedEnv, url: URL): Promise<Response> {
  const companyId = requireCompanyId(env);
  const range = appointmentRange(url);
  const [branches, doctors, schedules, appointments, patients, blocks] = await Promise.all([
    db<Row[]>(env, `waba_clinic_branches?company_id=eq.${encodeURIComponent(companyId)}&select=*&order=sort_order.asc,name.asc`),
    db<Row[]>(env, `waba_clinic_doctors?company_id=eq.${encodeURIComponent(companyId)}&select=*&order=sort_order.asc,name.asc`),
    db<Row[]>(env, `waba_clinic_schedules?company_id=eq.${encodeURIComponent(companyId)}&select=*&order=weekday.asc,start_time.asc`),
    db<Row[]>(env, `waba_clinic_appointments?company_id=eq.${encodeURIComponent(companyId)}&starts_at=gte.${encodeURIComponent(range.from)}&starts_at=lt.${encodeURIComponent(range.to)}&select=id,branch_id,doctor_id,lead_id,patient_id,starts_at,ends_at,patient_name,phone,status,source,metadata,created_at,updated_at&order=starts_at.asc&limit=750`),
    db<Row[]>(env, `clinic_patients?company_id=eq.${encodeURIComponent(companyId)}&select=id,name,phone,email,last_visit_at,next_visit_at,source_system,metadata,updated_at&order=updated_at.desc&limit=500`).catch(() => []),
    db<Row[]>(env, `waba_clinic_schedule_blocks?company_id=eq.${encodeURIComponent(companyId)}&starts_at=lt.${encodeURIComponent(range.to)}&ends_at=gt.${encodeURIComponent(range.from)}&select=id,doctor_id,starts_at,ends_at,block_type,title,note,metadata,created_at,updated_at&order=starts_at.asc&limit=750`).catch(() => []),
  ]);
  const visibleAppointments = appointments.map((item) => isMisAppointment(item) ? {
    ...item,
    lead_id: null,
    patient_id: null,
    patient_name: 'Занято',
    phone: '',
    metadata: { external_busy: true },
  } : item);
  const visiblePatients = patients.filter((item) => text(item.source_system).toLowerCase() !== 'mis');
  return json({ branches, doctors, schedules, appointments: visibleAppointments, patients: visiblePatients, blocks, range, timezone: 'Asia/Almaty' });
}

async function calendarCounts(env: ScopedEnv, url: URL): Promise<Response> {
  const companyId = requireCompanyId(env);
  const range = monthRange(text(url.searchParams.get('month')));
  const appointments = await db<Row[]>(env, `waba_clinic_appointments?company_id=eq.${encodeURIComponent(companyId)}&starts_at=gte.${encodeURIComponent(range.from)}&starts_at=lt.${encodeURIComponent(range.to)}&select=starts_at,status&order=starts_at.asc&limit=5000`);
  const counts: Record<string, number> = {};
  for (const item of appointments) {
    const key = almatyDateKey(new Date(text(item.starts_at)));
    counts[key] = (counts[key] || 0) + 1;
  }
  return json({ month: range.month, counts });
}

async function saveBranch(request: Request, env: ScopedEnv, body: Row): Promise<Response> {
  if (!admin(request)) return json({ error: 'Требуются права администратора' }, 403);
  const companyId = requireCompanyId(env);
  const id = text(body.id);
  const name = text(body.name);
  if (!name) return json({ error: 'Укажите название филиала' }, 400);
  const payload = {
    company_id: companyId,
    name,
    address: text(body.address) || null,
    active: body.active !== false,
    sort_order: Number.isFinite(Number(body.sort_order)) ? Number(body.sort_order) : 0,
    updated_at: new Date().toISOString(),
  };
  const rows = id
    ? await db<Row[]>(env, `waba_clinic_branches?company_id=eq.${encodeURIComponent(companyId)}&id=eq.${encodeURIComponent(id)}&select=*`, { method: 'PATCH', headers: { prefer: 'return=representation' }, body: JSON.stringify(payload) })
    : await db<Row[]>(env, 'waba_clinic_branches?select=*', { method: 'POST', headers: { prefer: 'return=representation' }, body: JSON.stringify(payload) });
  if (id && !rows.length) return json({ error: 'Филиал не найден в выбранной клинике' }, 404);
  return json({ ok: true, item: rows[0] || null });
}

async function saveDoctor(request: Request, env: ScopedEnv, body: Row): Promise<Response> {
  if (!admin(request)) return json({ error: 'Требуются права администратора' }, 403);
  const companyId = requireCompanyId(env);
  const id = text(body.id);
  const branchId = text(body.branch_id);
  const name = text(body.name);
  if (!branchId || !name) return json({ error: 'Выберите филиал и укажите врача' }, 400);
  const branches = await db<Row[]>(env, `waba_clinic_branches?company_id=eq.${encodeURIComponent(companyId)}&id=eq.${encodeURIComponent(branchId)}&select=id&limit=1`);
  if (!branches[0]) return json({ error: 'Филиал не принадлежит выбранной клинике' }, 404);
  const payload = {
    company_id: companyId,
    branch_id: branchId,
    name,
    specialty: text(body.specialty) || null,
    active: body.active !== false,
    sort_order: Number.isFinite(Number(body.sort_order)) ? Number(body.sort_order) : 0,
    updated_at: new Date().toISOString(),
  };
  const rows = id
    ? await db<Row[]>(env, `waba_clinic_doctors?company_id=eq.${encodeURIComponent(companyId)}&id=eq.${encodeURIComponent(id)}&select=*`, { method: 'PATCH', headers: { prefer: 'return=representation' }, body: JSON.stringify(payload) })
    : await db<Row[]>(env, 'waba_clinic_doctors?select=*', { method: 'POST', headers: { prefer: 'return=representation' }, body: JSON.stringify(payload) });
  if (id && !rows.length) return json({ error: 'Врач не найден в выбранной клинике' }, 404);
  return json({ ok: true, item: rows[0] || null });
}

async function saveSchedule(request: Request, env: ScopedEnv, body: Row): Promise<Response> {
  if (!admin(request)) return json({ error: 'Требуются права администратора' }, 403);
  const companyId = requireCompanyId(env);
  const id = text(body.id);
  const doctorId = text(body.doctor_id);
  const weekday = Number(body.weekday);
  const startTime = time5(body.start_time);
  const endTime = time5(body.end_time);
  const breakStart = time5(body.break_start);
  const breakEnd = time5(body.break_end);
  const slotMinutes = Number(body.slot_minutes) || 30;
  if (!doctorId || !Number.isInteger(weekday) || weekday < 0 || weekday > 6 || !startTime || !endTime) return json({ error: 'Заполните врача, день и время' }, 400);
  if (startTime >= endTime) return json({ error: 'Начало смены должно быть раньше окончания' }, 400);
  if (Boolean(breakStart) !== Boolean(breakEnd)) return json({ error: 'Укажите начало и конец перерыва вместе' }, 400);
  if (breakStart && (breakStart >= breakEnd || breakStart < startTime || breakEnd > endTime)) return json({ error: 'Перерыв должен находиться внутри рабочей смены' }, 400);
  if (slotMinutes < 5 || slotMinutes > 240) return json({ error: 'Длительность слота должна быть от 5 до 240 минут' }, 400);
  const doctors = await db<Row[]>(env, `waba_clinic_doctors?company_id=eq.${encodeURIComponent(companyId)}&id=eq.${encodeURIComponent(doctorId)}&select=id&limit=1`);
  if (!doctors[0]) return json({ error: 'Врач не принадлежит выбранной клинике' }, 404);
  const existing = await db<Row[]>(env, `waba_clinic_schedules?company_id=eq.${encodeURIComponent(companyId)}&doctor_id=eq.${encodeURIComponent(doctorId)}&weekday=eq.${weekday}&active=eq.true&select=id,start_time,end_time`);
  const overlap = existing.find((row) => text(row.id) !== id && startTime < time5(row.end_time) && endTime > time5(row.start_time));
  if (overlap) return json({ error: `Интервал пересекается с ${time5(overlap.start_time)}–${time5(overlap.end_time)}` }, 409);
  const payload = {
    company_id: companyId,
    doctor_id: doctorId,
    weekday,
    start_time: startTime,
    end_time: endTime,
    break_start: breakStart || null,
    break_end: breakEnd || null,
    slot_minutes: slotMinutes,
    active: body.active !== false,
    updated_at: new Date().toISOString(),
  };
  try {
    const rows = id
      ? await db<Row[]>(env, `waba_clinic_schedules?company_id=eq.${encodeURIComponent(companyId)}&id=eq.${encodeURIComponent(id)}&select=*`, { method: 'PATCH', headers: { prefer: 'return=representation' }, body: JSON.stringify(payload) })
      : await db<Row[]>(env, 'waba_clinic_schedules?select=*', { method: 'POST', headers: { prefer: 'return=representation' }, body: JSON.stringify(payload) });
    if (id && !rows.length) return json({ error: 'Расписание не найдено в выбранной клинике' }, 404);
    return json({ ok: true, item: rows[0] || null });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('waba_clinic_schedules_exact_uidx') || message.includes('duplicate key')) return json({ error: 'Такой интервал уже существует' }, 409);
    throw error;
  }
}

async function toggle(request: Request, env: ScopedEnv, body: Row): Promise<Response> {
  if (!admin(request)) return json({ error: 'Требуются права администратора' }, 403);
  const companyId = requireCompanyId(env);
  const entity = text(body.entity);
  const id = text(body.id);
  const table = entity === 'branch' ? 'waba_clinic_branches' : entity === 'doctor' ? 'waba_clinic_doctors' : entity === 'schedule' ? 'waba_clinic_schedules' : '';
  if (!table || !id) return json({ error: 'Некорректный объект' }, 400);
  const rows = await db<Row[]>(env, `${table}?company_id=eq.${encodeURIComponent(companyId)}&id=eq.${encodeURIComponent(id)}&select=id`, {
    method: 'PATCH', headers: { prefer: 'return=representation' }, body: JSON.stringify({ active: body.active === true, updated_at: new Date().toISOString() }),
  });
  if (!rows.length) return json({ error: 'Объект не найден в выбранной клинике' }, 404);
  return json({ ok: true });
}

async function doctorInCompany(env: ScopedEnv, companyId: string, doctorId: string): Promise<Row | null> {
  const rows = await db<Row[]>(env, `waba_clinic_doctors?company_id=eq.${encodeURIComponent(companyId)}&id=eq.${encodeURIComponent(doctorId)}&select=id,branch_id,name,specialty,active&limit=1`);
  return rows[0] || null;
}

async function patientInCompany(env: ScopedEnv, companyId: string, patientId: string): Promise<Row | null> {
  if (!patientId) return null;
  const rows = await db<Row[]>(env, `clinic_patients?company_id=eq.${encodeURIComponent(companyId)}&id=eq.${encodeURIComponent(patientId)}&select=id,name,phone,source_system&limit=1`).catch(() => []);
  const patient = rows[0] || null;
  return patient && text(patient.source_system).toLowerCase() !== 'mis' ? patient : null;
}

async function appointmentInCompany(env: ScopedEnv, companyId: string, id: string): Promise<Row | null> {
  const rows = await db<Row[]>(env, `waba_clinic_appointments?company_id=eq.${encodeURIComponent(companyId)}&id=eq.${encodeURIComponent(id)}&select=*&limit=1`);
  return rows[0] || null;
}

async function appointmentConflict(env: ScopedEnv, companyId: string, doctorId: string, startsAt: string, endsAt: string, excludeId = ''): Promise<Row | null> {
  const statusFilter = `(${OCCUPYING_APPOINTMENT_STATUSES.join(',')})`;
  const rows = await db<Row[]>(env, `waba_clinic_appointments?company_id=eq.${encodeURIComponent(companyId)}&doctor_id=eq.${encodeURIComponent(doctorId)}&status=in.${statusFilter}&starts_at=lt.${encodeURIComponent(endsAt)}&ends_at=gt.${encodeURIComponent(startsAt)}&select=id,patient_name,starts_at,ends_at&order=starts_at.asc&limit=20`);
  return rows.find((row) => text(row.id) !== excludeId) || null;
}

async function validateDoctorWorkWindow(env: ScopedEnv, companyId: string, doctorId: string, startsAt: string, endsAt: string): Promise<string | null> {
  const weekday = almatyWeekday(startsAt);
  const formatter = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Almaty', hour: '2-digit', minute: '2-digit', hour12: false });
  const startTime = formatter.format(new Date(startsAt));
  const endTime = formatter.format(new Date(endsAt));
  const schedules = await db<Row[]>(env, `waba_clinic_schedules?company_id=eq.${encodeURIComponent(companyId)}&doctor_id=eq.${encodeURIComponent(doctorId)}&weekday=eq.${weekday}&active=eq.true&select=id,start_time,end_time,break_start,break_end`);
  if (!schedules.length) return 'На выбранный день у специалиста нет рабочего графика';
  const containing = schedules.find((row) => startTime >= time5(row.start_time) && endTime <= time5(row.end_time));
  if (!containing) return 'Время записи выходит за рабочий интервал специалиста';
  const breakStart = time5(containing.break_start);
  const breakEnd = time5(containing.break_end);
  if (breakStart && breakEnd && startTime < breakEnd && endTime > breakStart) return 'Время попадает в перерыв специалиста';
  return null;
}

async function createBlock(request: Request, env: ScopedEnv, body: Row): Promise<Response> {
  if (!admin(request)) return json({ error: 'Закрывать время может только администратор' }, 403);
  const companyId = requireCompanyId(env);
  const doctorId = text(body.doctor_id);
  const startsAt = iso(body.starts_at);
  const endsAt = iso(body.ends_at);
  const blockType = text(body.block_type) as ScheduleBlockType;
  const title = text(body.title);
  if (!doctorId || !startsAt || !endsAt || new Date(endsAt) <= new Date(startsAt)) return json({ error: 'Укажите специалиста и корректный интервал' }, 400);
  if (!ALLOWED_BLOCK_TYPES.has(blockType)) return json({ error: 'Некорректный тип блокировки' }, 400);
  if (!title) return json({ error: 'Укажите название блокировки' }, 400);
  const doctor = await doctorInCompany(env, companyId, doctorId);
  if (!doctor || doctor.active === false) return json({ error: 'Специалист недоступен в выбранной клинике' }, 404);
  const workError = await validateDoctorWorkWindow(env, companyId, doctorId, startsAt, endsAt);
  if (workError) return json({ error: workError }, 409);
  try {
    const rows = await db<Row[]>(env, 'waba_clinic_schedule_blocks?select=*', {
      method: 'POST', headers: { prefer: 'return=representation' },
      body: JSON.stringify({ company_id: companyId, doctor_id: doctorId, starts_at: startsAt, ends_at: endsAt, block_type: blockType, title, note: text(body.note) || null, created_by: text(request.headers.get('x-amanat-auth-user')) || null, metadata: record(body.metadata) }),
    });
    return json({ ok: true, item: rows[0] || null }, 201);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('Нельзя закрыть время')) return json({ error: 'Нельзя закрыть время: в интервале уже есть активная запись' }, 409);
    throw error;
  }
}

async function deleteBlock(request: Request, env: ScopedEnv, body: Row): Promise<Response> {
  if (!admin(request)) return json({ error: 'Открывать время может только администратор' }, 403);
  const companyId = requireCompanyId(env);
  const id = text(body.id);
  if (!id) return json({ error: 'Не указана блокировка' }, 400);
  const rows = await db<Row[]>(env, `waba_clinic_schedule_blocks?company_id=eq.${encodeURIComponent(companyId)}&id=eq.${encodeURIComponent(id)}&select=id`, { method: 'DELETE', headers: { prefer: 'return=representation' } });
  if (!rows.length) return json({ error: 'Блокировка не найдена в выбранной клинике' }, 404);
  return json({ ok: true });
}

async function createAppointment(request: Request, env: ScopedEnv, body: Row): Promise<Response> {
  const companyId = requireCompanyId(env);
  const doctorId = text(body.doctor_id);
  const patientId = text(body.patient_id);
  const leadId = text(body.lead_id);
  const startsAt = iso(body.starts_at);
  const endsAt = iso(body.ends_at);
  if (!doctorId || !startsAt || !endsAt || new Date(endsAt) <= new Date(startsAt)) return json({ error: 'Укажите специалиста и корректное время записи' }, 400);
  const doctor = await doctorInCompany(env, companyId, doctorId);
  if (!doctor || doctor.active === false) return json({ error: 'Специалист недоступен в выбранной клинике' }, 404);
  const workError = await validateDoctorWorkWindow(env, companyId, doctorId, startsAt, endsAt);
  if (workError) return json({ error: workError }, 409);
  const conflict = await appointmentConflict(env, companyId, doctorId, startsAt, endsAt);
  if (conflict) return json({ error: `У специалиста уже есть запись ${text(conflict.patient_name) || ''} в это время`.trim() }, 409);
  const patient = patientId ? await patientInCompany(env, companyId, patientId) : null;
  if (patientId && !patient) return json({ error: 'Пациент не найден в Marketing выбранной клиники' }, 404);
  const patientName = text(body.patient_name) || text(patient?.name);
  if (!patientName) return json({ error: 'Укажите пациента' }, 400);
  const now = new Date().toISOString();
  try {
    const rows = await db<Row[]>(env, 'waba_clinic_appointments?select=*', {
      method: 'POST', headers: { prefer: 'return=representation' },
      body: JSON.stringify({
        company_id: companyId,
        branch_id: text(doctor.branch_id),
        doctor_id: doctorId,
        patient_id: patientId || null,
        lead_id: leadId || null,
        starts_at: startsAt,
        ends_at: endsAt,
        patient_name: patientName,
        phone: text(body.phone) || text(patient?.phone),
        status: 'BOOKED',
        source: 'Clinic Schedule',
        metadata: { ...record(body.metadata), note: text(body.note) || null, created_from: 'clinic_schedule', created_by: text(request.headers.get('x-amanat-auth-user')) || null },
        created_at: now,
        updated_at: now,
      }),
    });
    return json({ ok: true, item: rows[0] || null }, 201);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('В выбранном времени специалист недоступен') || message.includes('Время попадает в перерыв специалиста')) return json({ error: 'В выбранном времени специалист недоступен' }, 409);
    throw error;
  }
}

async function moveAppointment(request: Request, env: ScopedEnv, body: Row): Promise<Response> {
  const companyId = requireCompanyId(env);
  const id = text(body.id);
  const doctorId = text(body.doctor_id);
  const startsAt = iso(body.starts_at);
  const endsAt = iso(body.ends_at);
  if (!id || !doctorId || !startsAt || !endsAt || new Date(endsAt) <= new Date(startsAt)) return json({ error: 'Некорректные данные переноса' }, 400);
  const current = await appointmentInCompany(env, companyId, id);
  if (!current) return json({ error: 'Запись не найдена в выбранной клинике' }, 404);
  if (isMisAppointment(current)) return misReadOnlyError();
  if (!MOVABLE_APPOINTMENT_STATUSES.includes(text(current.status) as AppointmentStatus)) return json({ error: 'Переносить можно только записанного или подтверждённого пациента' }, 409);
  const doctor = await doctorInCompany(env, companyId, doctorId);
  if (!doctor || doctor.active === false) return json({ error: 'Специалист недоступен' }, 404);
  const workError = await validateDoctorWorkWindow(env, companyId, doctorId, startsAt, endsAt);
  if (workError) return json({ error: workError }, 409);
  const conflict = await appointmentConflict(env, companyId, doctorId, startsAt, endsAt, id);
  if (conflict) return json({ error: 'В выбранном времени уже есть другая запись' }, 409);
  const metadata = record(current.metadata);
  const movedAt = new Date().toISOString();
  const history = Array.isArray(metadata.move_history) ? metadata.move_history : [];
  try {
    const rows = await db<Row[]>(env, `waba_clinic_appointments?company_id=eq.${encodeURIComponent(companyId)}&id=eq.${encodeURIComponent(id)}&select=*`, {
      method: 'PATCH', headers: { prefer: 'return=representation' },
      body: JSON.stringify({
        doctor_id: doctorId,
        branch_id: text(doctor.branch_id),
        starts_at: startsAt,
        ends_at: endsAt,
        metadata: { ...metadata, move_history: [...history, { from_doctor_id: text(current.doctor_id), from_starts_at: text(current.starts_at), from_ends_at: text(current.ends_at), to_doctor_id: doctorId, to_starts_at: startsAt, to_ends_at: endsAt, at: movedAt, by: text(request.headers.get('x-amanat-auth-user')) || null }].slice(-50) },
        updated_at: movedAt,
      }),
    });
    return json({ ok: true, item: rows[0] || null });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('В выбранном времени специалист недоступен') || message.includes('Время попадает в перерыв специалиста')) return json({ error: 'В выбранном времени специалист недоступен' }, 409);
    throw error;
  }
}

async function updateAppointment(_request: Request, env: ScopedEnv, body: Row): Promise<Response> {
  const companyId = requireCompanyId(env);
  const id = text(body.id);
  if (!id) return json({ error: 'Не указана запись' }, 400);
  const current = await appointmentInCompany(env, companyId, id);
  if (!current) return json({ error: 'Запись не найдена в выбранной клинике' }, 404);
  if (isMisAppointment(current)) return misReadOnlyError();
  const patientId = body.patient_id === undefined ? text(current.patient_id) : text(body.patient_id);
  const patient = patientId ? await patientInCompany(env, companyId, patientId) : null;
  if (patientId && !patient) return json({ error: 'Пациент не найден в Marketing выбранной клиники' }, 404);
  const metadata = record(current.metadata);
  const rows = await db<Row[]>(env, `waba_clinic_appointments?company_id=eq.${encodeURIComponent(companyId)}&id=eq.${encodeURIComponent(id)}&select=*`, {
    method: 'PATCH', headers: { prefer: 'return=representation' },
    body: JSON.stringify({
      patient_id: patientId || null,
      patient_name: text(body.patient_name) || text(patient?.name) || text(current.patient_name),
      phone: body.phone === undefined ? text(current.phone) : text(body.phone),
      metadata: { ...metadata, note: body.note === undefined ? metadata.note ?? null : text(body.note) || null },
      updated_at: new Date().toISOString(),
    }),
  });
  return json({ ok: true, item: rows[0] || null });
}

async function appointmentStatus(request: Request, env: ScopedEnv, body: Row): Promise<Response> {
  const companyId = requireCompanyId(env);
  const id = text(body.id);
  const status = text(body.status).toUpperCase() as AppointmentStatus;
  if (!id || !ALLOWED_APPOINTMENT_STATUSES.has(status)) return json({ error: 'Некорректный статус записи' }, 400);
  const rows = await db<Row[]>(env, `waba_clinic_appointments?company_id=eq.${encodeURIComponent(companyId)}&id=eq.${encodeURIComponent(id)}&select=id,status,source,metadata,lead_id&limit=1`);
  const current = rows[0];
  if (!current) return json({ error: 'Запись не найдена в выбранной клинике' }, 404);
  if (isMisAppointment(current)) return misReadOnlyError();
  const metadata = record(current.metadata);
  const history = Array.isArray(metadata.status_history) ? metadata.status_history : [];
  const changedAt = new Date().toISOString();
  const updated = await db<Row[]>(env, `waba_clinic_appointments?company_id=eq.${encodeURIComponent(companyId)}&id=eq.${encodeURIComponent(id)}&select=*`, {
    method: 'PATCH', headers: { prefer: 'return=representation' },
    body: JSON.stringify({ status, metadata: { ...metadata, status_history: [...history, { from: text(current.status), to: status, at: changedAt, by: text(request.headers.get('x-amanat-auth-user')) || null }].slice(-50) }, updated_at: changedAt }),
  });
  const leadId = text(current.lead_id);
  if (leadId && (status === 'BOOKED' || status === 'CONFIRMED')) {
    await db(env, `marketing_leads?company_id=eq.${encodeURIComponent(companyId)}&id=eq.${encodeURIComponent(leadId)}`, {
      method: 'PATCH', body: JSON.stringify({ stage: 'Запись', updated_at: changedAt }),
    }).catch(() => null);
  }
  return json({ ok: true, item: updated[0] || null });
}

async function deleteAppointment(request: Request, env: ScopedEnv, body: Row): Promise<Response> {
  if (!admin(request)) return json({ error: 'Удалять запись может только администратор' }, 403);
  const companyId = requireCompanyId(env);
  const id = text(body.id);
  if (!id) return json({ error: 'Не указана запись' }, 400);
  const current = await appointmentInCompany(env, companyId, id);
  if (!current) return json({ error: 'Запись не найдена в выбранной клинике' }, 404);
  if (isMisAppointment(current)) return misReadOnlyError();
  await db(env, `waba_clinic_appointments?company_id=eq.${encodeURIComponent(companyId)}&id=eq.${encodeURIComponent(id)}`, { method: 'DELETE', headers: { prefer: 'return=minimal' } });
  return json({ ok: true });
}

export async function handleClinicSchedule(request: Request, env: Env, url: URL): Promise<Response | null> {
  if (!url.pathname.startsWith('/api/clinic-schedule')) return null;
  const scoped = env as ScopedEnv;
  if (url.pathname === '/api/clinic-schedule/calendar' && request.method === 'GET') return calendarCounts(scoped, url);
  if (url.pathname === '/api/clinic-schedule' && request.method === 'GET') return snapshot(scoped, url);
  if (url.pathname !== '/api/clinic-schedule' || request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const body = record(await request.json().catch(() => ({})));
  const action = text(body.action);
  if (action === 'save_branch') return saveBranch(request, scoped, body);
  if (action === 'save_doctor') return saveDoctor(request, scoped, body);
  if (action === 'save_schedule') return saveSchedule(request, scoped, body);
  if (action === 'set_active') return toggle(request, scoped, body);
  if (action === 'create_block') return createBlock(request, scoped, body);
  if (action === 'delete_block') return deleteBlock(request, scoped, body);
  if (action === 'create_appointment') return createAppointment(request, scoped, body);
  if (action === 'move_appointment') return moveAppointment(request, scoped, body);
  if (action === 'update_appointment') return updateAppointment(request, scoped, body);
  if (action === 'set_appointment_status') return appointmentStatus(request, scoped, body);
  if (action === 'delete_appointment') return deleteAppointment(request, scoped, body);
  return json({ error: 'Неизвестное действие' }, 400);
}
