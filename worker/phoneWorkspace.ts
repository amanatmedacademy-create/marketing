import type { Env } from './integrations';
import { requireCompanyId, type TenantScopedEnv } from './tenantScope';

type Row = Record<string, unknown>;
export type PhoneWorkspaceEnv = Env & TenantScopedEnv;

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});
const text = (value: unknown): string => typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim();
const record = (value: unknown): Row => value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {};

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
  if (!response.ok) throw new Error(`Phone Workspace DB ${response.status}: ${raw.slice(0, 1400)}`);
  return (raw ? JSON.parse(raw) : null) as T;
}

function normalizePhone(value: string): string {
  let digits = value.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('8')) digits = `7${digits.slice(1)}`;
  if (digits.length === 10) digits = `7${digits}`;
  return digits ? `+${digits.slice(0, 15)}` : '';
}

async function findCall(env: PhoneWorkspaceEnv, companyId: string, callId?: string): Promise<Row | null> {
  if (callId) {
    const rows = await db<Row[]>(env, `marketing_calls?company_id=eq.${encodeURIComponent(companyId)}&id=eq.${encodeURIComponent(callId)}&select=*&limit=1`);
    return rows[0] || null;
  }
  const active = await db<Row[]>(env, `marketing_calls?company_id=eq.${encodeURIComponent(companyId)}&call_direction=eq.INBOUND&call_status=eq.PENDING&select=*&order=started_at.desc&limit=1`);
  if (active[0]) return active[0];
  const inbound = await db<Row[]>(env, `marketing_calls?company_id=eq.${encodeURIComponent(companyId)}&call_direction=eq.INBOUND&select=*&order=started_at.desc&limit=1`);
  if (inbound[0]) return inbound[0];
  const latest = await db<Row[]>(env, `marketing_calls?company_id=eq.${encodeURIComponent(companyId)}&select=*&order=started_at.desc&limit=1`);
  return latest[0] || null;
}

async function findLead(env: PhoneWorkspaceEnv, companyId: string, call: Row | null): Promise<Row | null> {
  if (!call) return null;
  const leadId = text(call.lead_id);
  if (leadId) {
    const rows = await db<Row[]>(env, `marketing_leads?company_id=eq.${encodeURIComponent(companyId)}&id=eq.${encodeURIComponent(leadId)}&select=*&limit=1`);
    if (rows[0]) return rows[0];
  }
  const phone = normalizePhone(text(call.client_phone));
  if (!phone) return null;
  const rows = await db<Row[]>(env, `marketing_leads?company_id=eq.${encodeURIComponent(companyId)}&phone=eq.${encodeURIComponent(phone)}&select=*&order=lead_created_at.desc&limit=1`);
  return rows[0] || null;
}

async function recentCalls(env: PhoneWorkspaceEnv, companyId: string): Promise<Row[]> {
  return db<Row[]>(env, `marketing_calls?company_id=eq.${encodeURIComponent(companyId)}&select=*&order=started_at.desc&limit=50`);
}

async function patientCalls(env: PhoneWorkspaceEnv, companyId: string, lead: Row | null, call: Row | null): Promise<Row[]> {
  const leadId = text(lead?.id);
  if (leadId) return db<Row[]>(env, `marketing_calls?company_id=eq.${encodeURIComponent(companyId)}&lead_id=eq.${encodeURIComponent(leadId)}&select=*&order=started_at.desc&limit=30`);
  const phone = normalizePhone(text(call?.client_phone));
  if (!phone) return [];
  return db<Row[]>(env, `marketing_calls?company_id=eq.${encodeURIComponent(companyId)}&client_phone=eq.${encodeURIComponent(phone)}&select=*&order=started_at.desc&limit=30`);
}

async function patientJourney(env: PhoneWorkspaceEnv, companyId: string, lead: Row | null): Promise<Row[]> {
  const leadId = text(lead?.id);
  if (!leadId) return [];
  return db<Row[]>(env, `patient_journey_events?company_id=eq.${encodeURIComponent(companyId)}&lead_id=eq.${encodeURIComponent(leadId)}&select=*&order=occurred_at.desc&limit=50`);
}

async function patientAppointments(env: PhoneWorkspaceEnv, companyId: string, lead: Row | null, call: Row | null): Promise<Row[]> {
  const leadId = text(lead?.id);
  const phone = normalizePhone(text(lead?.phone) || text(call?.client_phone));
  const marketingOnly = '&source=neq.MIS';
  if (leadId && phone) {
    return db<Row[]>(env, `waba_clinic_appointments?company_id=eq.${encodeURIComponent(companyId)}${marketingOnly}&or=(lead_id.eq.${encodeURIComponent(leadId)},phone.eq.${encodeURIComponent(phone)})&select=*&order=starts_at.desc&limit=30`);
  }
  if (leadId) return db<Row[]>(env, `waba_clinic_appointments?company_id=eq.${encodeURIComponent(companyId)}${marketingOnly}&lead_id=eq.${encodeURIComponent(leadId)}&select=*&order=starts_at.desc&limit=30`);
  if (phone) return db<Row[]>(env, `waba_clinic_appointments?company_id=eq.${encodeURIComponent(companyId)}${marketingOnly}&phone=eq.${encodeURIComponent(phone)}&select=*&order=starts_at.desc&limit=30`);
  return [];
}

async function patientTasks(env: PhoneWorkspaceEnv, companyId: string, call: Row | null): Promise<Row[]> {
  if (!call) return [];
  const callId = text(call.id);
  const pbxCallId = text(call.pbx_call_id);
  const phone = normalizePhone(text(call.client_phone));
  const rows = await db<Row[]>(env, `crm_tasks?company_id=eq.${encodeURIComponent(companyId)}&source=in.(zadarma_missed_call,call_ai)&select=*&order=created_at.desc&limit=80`);
  return rows.filter((row) => {
    const externalKey = text(row.external_key);
    const description = text(row.description);
    return (callId && externalKey.includes(callId)) || (pbxCallId && externalKey.includes(pbxCallId)) || (phone && description.includes(phone));
  }).slice(0, 20);
}

async function clinicDirectory(env: PhoneWorkspaceEnv, companyId: string): Promise<{ branches: Row[]; doctors: Row[] }> {
  const [branches, doctors] = await Promise.all([
    db<Row[]>(env, `waba_clinic_branches?company_id=eq.${encodeURIComponent(companyId)}&active=eq.true&select=id,name,address,sort_order&order=sort_order.asc,name.asc`),
    db<Row[]>(env, `waba_clinic_doctors?company_id=eq.${encodeURIComponent(companyId)}&active=eq.true&select=id,branch_id,name,specialty,sort_order&order=sort_order.asc,name.asc`),
  ]);
  return { branches, doctors };
}

function isoDate(date: Date): string { return date.toISOString().slice(0, 10); }
function addDays(date: Date, days: number): Date { const next = new Date(date); next.setUTCDate(next.getUTCDate() + days); return next; }
function timeParts(value: string): { hour: number; minute: number } {
  const [hour, minute] = value.split(':').map(Number);
  return { hour: Number.isFinite(hour) ? hour : 0, minute: Number.isFinite(minute) ? minute : 0 };
}
function weekdayFor(date: string): number { return new Date(`${date}T12:00:00+05:00`).getUTCDay(); }
function localIso(date: string, hour: number, minute: number): string {
  return `${date}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00+05:00`;
}
function overlaps(start: Date, end: Date, row: Row): boolean {
  const rowStart = new Date(text(row.starts_at));
  const rowEnd = new Date(text(row.ends_at));
  if (!Number.isFinite(rowStart.getTime()) || !Number.isFinite(rowEnd.getTime())) return false;
  return start < rowEnd && end > rowStart;
}
function overlapsScheduleBreak(startMinute: number, endMinute: number, schedule: Row): boolean {
  const rawStart = text(schedule.break_start);
  const rawEnd = text(schedule.break_end);
  if (!rawStart || !rawEnd) return false;
  const breakStart = timeParts(rawStart);
  const breakEnd = timeParts(rawEnd);
  const breakStartMinute = breakStart.hour * 60 + breakStart.minute;
  const breakEndMinute = breakEnd.hour * 60 + breakEnd.minute;
  return startMinute < breakEndMinute && endMinute > breakStartMinute;
}

async function buildSlots(env: PhoneWorkspaceEnv, companyId: string, doctorId: string): Promise<Row[]> {
  const doctors = await db<Row[]>(env, `waba_clinic_doctors?company_id=eq.${encodeURIComponent(companyId)}&id=eq.${encodeURIComponent(doctorId)}&active=eq.true&select=id,branch_id,name,specialty&limit=1`);
  if (!doctors[0]) throw new Error('Врач не найден в выбранной клинике');
  const schedules = await db<Row[]>(env, `waba_clinic_schedules?company_id=eq.${encodeURIComponent(companyId)}&doctor_id=eq.${encodeURIComponent(doctorId)}&active=eq.true&select=weekday,start_time,end_time,break_start,break_end,slot_minutes&order=weekday.asc,start_time.asc`);
  if (!schedules.length) return [];

  const now = new Date();
  const todayAlmaty = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Almaty', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  const base = new Date(`${todayAlmaty}T12:00:00Z`);
  const dates = Array.from({ length: 21 }, (_, index) => isoDate(addDays(base, index)));
  const rangeStart = `${dates[0]}T00:00:00+05:00`;
  const rangeEnd = `${dates[dates.length - 1]}T23:59:59+05:00`;
  const [appointments, blocks] = await Promise.all([
    db<Row[]>(env, `waba_clinic_appointments?company_id=eq.${encodeURIComponent(companyId)}&doctor_id=eq.${encodeURIComponent(doctorId)}&status=in.(BOOKED,CONFIRMED,ARRIVED)&starts_at=lt.${encodeURIComponent(rangeEnd)}&ends_at=gt.${encodeURIComponent(rangeStart)}&select=starts_at,ends_at`),
    db<Row[]>(env, `waba_clinic_schedule_blocks?company_id=eq.${encodeURIComponent(companyId)}&doctor_id=eq.${encodeURIComponent(doctorId)}&starts_at=lt.${encodeURIComponent(rangeEnd)}&ends_at=gt.${encodeURIComponent(rangeStart)}&select=starts_at,ends_at`).catch(() => []),
  ]);
  const result: Row[] = [];

  for (const date of dates) {
    const weekday = weekdayFor(date);
    for (const schedule of schedules.filter((row) => Number(row.weekday) === weekday)) {
      const start = timeParts(text(schedule.start_time));
      const end = timeParts(text(schedule.end_time));
      const slotMinutes = Math.max(5, Number(schedule.slot_minutes) || 30);
      let cursor = start.hour * 60 + start.minute;
      const endMinutes = end.hour * 60 + end.minute;
      while (cursor + slotMinutes <= endMinutes) {
        const slotEndMinute = cursor + slotMinutes;
        const startsAt = localIso(date, Math.floor(cursor / 60), cursor % 60);
        const startsDate = new Date(startsAt);
        const endsDate = new Date(startsDate.getTime() + slotMinutes * 60_000);
        const occupied = appointments.some((row) => overlaps(startsDate, endsDate, row));
        const blocked = blocks.some((row) => overlaps(startsDate, endsDate, row));
        const onBreak = overlapsScheduleBreak(cursor, slotEndMinute, schedule);
        if (startsDate.getTime() > now.getTime() + 15 * 60 * 1000 && !occupied && !blocked && !onBreak) {
          result.push({ id: startsAt, starts_at: startsAt, ends_at: endsDate.toISOString(), slot_minutes: slotMinutes });
        }
        cursor += slotMinutes;
        if (result.length >= 80) return result;
      }
    }
  }
  return result;
}

async function context(env: PhoneWorkspaceEnv, url: URL): Promise<Response> {
  const companyId = requireCompanyId(env);
  const selectedCall = await findCall(env, companyId, url.searchParams.get('call_id') || undefined);
  const lead = await findLead(env, companyId, selectedCall);
  const [recent, calls, journey, appointments, tasks, directory] = await Promise.all([
    recentCalls(env, companyId),
    patientCalls(env, companyId, lead, selectedCall),
    patientJourney(env, companyId, lead),
    patientAppointments(env, companyId, lead, selectedCall),
    patientTasks(env, companyId, selectedCall),
    clinicDirectory(env, companyId),
  ]);
  const active = recent.find((row) => text(row.call_direction) === 'INBOUND' && text(row.call_status) === 'PENDING') || null;
  return json({ companyId, activeCall: active, selectedCall, recentCalls: recent, patient: { lead, calls, journey, appointments, tasks }, clinic: directory });
}

async function slots(env: PhoneWorkspaceEnv, url: URL): Promise<Response> {
  const companyId = requireCompanyId(env);
  const doctorId = text(url.searchParams.get('doctor_id'));
  if (!doctorId) return json({ error: 'doctor_id обязателен' }, 400);
  return json({ doctorId, slots: await buildSlots(env, companyId, doctorId) });
}

async function createAppointment(request: Request, env: PhoneWorkspaceEnv): Promise<Response> {
  const companyId = requireCompanyId(env);
  const body = record(await request.json().catch(() => ({})));
  const branchId = text(body.branchId);
  const doctorId = text(body.doctorId);
  const startsAt = text(body.startsAt);
  const callId = text(body.callId);
  const requestedLeadId = text(body.leadId);
  if (!branchId || !doctorId || !startsAt) return json({ error: 'Выберите филиал, врача и время' }, 400);

  const [branches, doctors, availableSlots, callRows, leadRows] = await Promise.all([
    db<Row[]>(env, `waba_clinic_branches?company_id=eq.${encodeURIComponent(companyId)}&id=eq.${encodeURIComponent(branchId)}&active=eq.true&select=id,name,address&limit=1`),
    db<Row[]>(env, `waba_clinic_doctors?company_id=eq.${encodeURIComponent(companyId)}&id=eq.${encodeURIComponent(doctorId)}&branch_id=eq.${encodeURIComponent(branchId)}&active=eq.true&select=id,name,specialty&limit=1`),
    buildSlots(env, companyId, doctorId),
    callId ? db<Row[]>(env, `marketing_calls?company_id=eq.${encodeURIComponent(companyId)}&id=eq.${encodeURIComponent(callId)}&select=*&limit=1`) : Promise.resolve([]),
    requestedLeadId ? db<Row[]>(env, `marketing_leads?company_id=eq.${encodeURIComponent(companyId)}&id=eq.${encodeURIComponent(requestedLeadId)}&select=*&limit=1`) : Promise.resolve([]),
  ]);
  const branch = branches[0];
  const doctor = doctors[0];
  const slot = availableSlots.find((item) => text(item.starts_at) === startsAt);
  if (!branch || !doctor) return json({ error: 'Филиал или врач не принадлежат выбранной клинике' }, 404);
  if (!slot) return json({ error: 'Выбранное время уже недоступно. Обновите слоты.' }, 409);

  const call: Row | null = callRows[0] ?? null;
  let lead: Row | null = leadRows[0] ?? null;
  if (!lead && call) lead = await findLead(env, companyId, call);
  const patientName = text(body.patientName) || text(lead?.name) || text(call?.client_name) || 'Пациент';
  const phone = normalizePhone(text(body.phone) || text(lead?.phone) || text(call?.client_phone));
  if (!phone) return json({ error: 'У пациента нет телефона' }, 400);
  const leadId = text(lead?.id) || null;
  const now = new Date().toISOString();
  const payload = {
    company_id: companyId,
    lead_id: leadId,
    conversation_id: text(call?.conversation_id) || null,
    branch_id: branchId,
    doctor_id: doctorId,
    starts_at: startsAt,
    ends_at: text(slot.ends_at),
    patient_name: patientName,
    phone,
    status: 'BOOKED',
    source: 'Phone Workspace',
    flow_token: null,
    metadata: { service: text(body.service) || null, created_from: 'imds_phone_workspace', call_id: callId || null, pbx_call_id: text(call?.pbx_call_id) || null },
    updated_at: now,
  };

  try {
    const created = await db<Row[]>(env, 'waba_clinic_appointments?select=*', {
      method: 'POST', headers: { prefer: 'return=representation' }, body: JSON.stringify(payload),
    });
    if (callId && call) {
      await db(env, `marketing_calls?company_id=eq.${encodeURIComponent(companyId)}&id=eq.${encodeURIComponent(callId)}`, {
        method: 'PATCH', body: JSON.stringify({ appointment_created: true, appointment_at: startsAt, updated_at: now }),
      });
    }
    if (leadId) {
      await db(env, `marketing_leads?company_id=eq.${encodeURIComponent(companyId)}&id=eq.${encodeURIComponent(leadId)}`, {
        method: 'PATCH', body: JSON.stringify({ appointment_at: startsAt, updated_at: now }),
      });
    }
    return json({
      ok: true,
      appointment: created[0] || payload,
      branch: { id: text(branch.id), name: text(branch.name) },
      doctor: { id: text(doctor.id), name: text(doctor.name), specialty: text(doctor.specialty) || null },
    }, 201);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('В выбранном времени специалист недоступен')) return json({ error: 'Это время больше недоступно. Выберите другой слот.' }, 409);
    if (message.includes('waba_clinic_appointments_doctor_slot_uidx') || message.includes('duplicate key')) return json({ error: 'Это время только что заняли. Выберите другой слот.' }, 409);
    throw error;
  }
}

export async function handlePhoneWorkspace(request: Request, env: PhoneWorkspaceEnv, url: URL): Promise<Response | null> {
  if (url.pathname === '/api/phone-workspace' && request.method === 'GET') return context(env, url);
  if (url.pathname === '/api/phone-workspace/slots' && request.method === 'GET') return slots(env, url);
  if (url.pathname === '/api/phone-workspace/appointments' && request.method === 'POST') return createAppointment(request, env);
  if (url.pathname.startsWith('/api/phone-workspace')) return json({ error: 'Method not allowed' }, 405);
  return null;
}
