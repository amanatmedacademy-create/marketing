type Row = Record<string, unknown>;

export interface WabaClinicBookingEnv {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
}

const text = (value: unknown): string => typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim();
const record = (value: unknown): Row => value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {};
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});

function headers(env: WabaClinicBookingEnv, extra: HeadersInit = {}): Headers {
  const result = new Headers(extra);
  result.set('apikey', env.SUPABASE_SERVICE_ROLE_KEY);
  result.set('authorization', `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`);
  result.set('accept', 'application/json');
  return result;
}

async function db<T>(env: WabaClinicBookingEnv, path: string, init: RequestInit = {}): Promise<T> {
  const nextHeaders = headers(env, init.headers);
  if (init.body != null) nextHeaders.set('content-type', 'application/json');
  if (init.method && !['GET', 'HEAD'].includes(init.method) && !nextHeaders.has('prefer')) nextHeaders.set('prefer', 'return=representation');
  const response = await fetch(`${env.SUPABASE_URL.replace(/\/+$/, '')}/rest/v1/${path}`, { ...init, headers: nextHeaders, cache: 'no-store' });
  const raw = await response.text();
  if (!response.ok) throw new Error(`Supabase ${response.status}: ${raw.slice(0, 1800)}`);
  return (raw ? JSON.parse(raw) : null) as T;
}

function option(id: string, title: string, description?: string): Row {
  return { id, title, ...(description ? { description } : {}) };
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function dateLabel(date: string): string {
  return new Intl.DateTimeFormat('ru-KZ', { timeZone: 'Asia/Almaty', weekday: 'short', day: '2-digit', month: 'short' })
    .format(new Date(`${date}T12:00:00+05:00`));
}

function timeLabel(iso: string): string {
  return new Intl.DateTimeFormat('ru-KZ', { timeZone: 'Asia/Almaty', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
    .format(new Date(iso));
}

function timeParts(value: string): { hour: number; minute: number } {
  const [hour, minute] = value.split(':').map((part) => Number(part));
  return { hour: Number.isFinite(hour) ? hour : 0, minute: Number.isFinite(minute) ? minute : 0 };
}

function localIso(date: string, hour: number, minute: number): string {
  return `${date}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00+05:00`;
}

function weekdayFor(date: string): number {
  return new Date(`${date}T12:00:00+05:00`).getUTCDay();
}

async function branches(env: WabaClinicBookingEnv, companyId: string): Promise<Row[]> {
  return db<Row[]>(env,
    `waba_clinic_branches?company_id=eq.${encodeURIComponent(companyId)}&active=eq.true&select=id,name,address&order=sort_order.asc,name.asc`,
  );
}

async function doctors(env: WabaClinicBookingEnv, companyId: string, branchId: string): Promise<Row[]> {
  return db<Row[]>(env,
    `waba_clinic_doctors?company_id=eq.${encodeURIComponent(companyId)}&branch_id=eq.${encodeURIComponent(branchId)}&active=eq.true&select=id,name,specialty&order=sort_order.asc,name.asc`,
  );
}

async function buildSlots(env: WabaClinicBookingEnv, companyId: string, doctorId: string): Promise<Row[]> {
  const schedules = await db<Row[]>(env,
    `waba_clinic_schedules?company_id=eq.${encodeURIComponent(companyId)}&doctor_id=eq.${encodeURIComponent(doctorId)}&active=eq.true&select=weekday,start_time,end_time,slot_minutes&order=weekday.asc,start_time.asc`,
  );
  if (!schedules.length) return [];

  const now = new Date();
  const todayAlmaty = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Almaty', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  const base = new Date(`${todayAlmaty}T12:00:00Z`);
  const dates = Array.from({ length: 21 }, (_, index) => isoDate(addDays(base, index)));
  const rangeStart = `${dates[0]}T00:00:00+05:00`;
  const rangeEnd = `${dates[dates.length - 1]}T23:59:59+05:00`;
  const booked = await db<Row[]>(env,
    `waba_clinic_appointments?company_id=eq.${encodeURIComponent(companyId)}&doctor_id=eq.${encodeURIComponent(doctorId)}&status=in.(BOOKED,CONFIRMED)&starts_at=gte.${encodeURIComponent(rangeStart)}&starts_at=lte.${encodeURIComponent(rangeEnd)}&select=starts_at`,
  );
  const occupied = new Set(booked.map((row) => new Date(text(row.starts_at)).toISOString()));
  const output: Row[] = [];

  for (const date of dates) {
    const weekday = weekdayFor(date);
    for (const schedule of schedules.filter((row) => Number(row.weekday) === weekday)) {
      const start = timeParts(text(schedule.start_time));
      const end = timeParts(text(schedule.end_time));
      const slotMinutes = Math.max(5, Number(schedule.slot_minutes) || 30);
      let cursor = start.hour * 60 + start.minute;
      const endMinutes = end.hour * 60 + end.minute;
      while (cursor + slotMinutes <= endMinutes) {
        const startsAt = localIso(date, Math.floor(cursor / 60), cursor % 60);
        const startsDate = new Date(startsAt);
        if (startsDate.getTime() > now.getTime() + 15 * 60 * 1000 && !occupied.has(startsDate.toISOString())) {
          const endsDate = new Date(startsDate.getTime() + slotMinutes * 60 * 1000);
          output.push(option(startsAt, timeLabel(startsAt), `${dateLabel(date)} · ${slotMinutes} мин`));
          (output[output.length - 1] as Row).ends_at = endsDate.toISOString();
        }
        cursor += slotMinutes;
        if (output.length >= 60) return output;
      }
    }
  }
  return output;
}

function carry(data: Row, keys: string[]): Row {
  const result: Row = {};
  for (const key of keys) result[key] = text(data[key]);
  return result;
}

export async function handleClinicBookingExchange(env: WabaClinicBookingEnv, companyId: string, body: Row): Promise<Row | null> {
  const action = text(body.action).toLowerCase();
  const screen = text(body.screen).toUpperCase();
  const data = record(body.data);

  if (action === 'init') {
    const rows = await branches(env, companyId);
    return {
      screen: 'APPOINTMENT',
      data: {
        branches: rows.map((row) => option(text(row.id), text(row.name), text(row.address) || undefined)),
        has_branches: rows.length > 0,
      },
    };
  }

  if (action !== 'data_exchange') return null;

  if (screen === 'APPOINTMENT') {
    const name = text(data.name);
    const phone = text(data.phone);
    const service = text(data.service);
    const branchId = text(data.branch_id);
    if (!name || !phone || !service || !branchId) {
      return { screen: 'APPOINTMENT', data: { error_message: 'Заполните имя, телефон, услугу и филиал.' } };
    }
    const rows = await doctors(env, companyId, branchId);
    return {
      screen: 'DOCTOR',
      data: {
        ...carry(data, ['name', 'phone', 'service', 'branch_id']),
        doctors: rows.map((row) => option(text(row.id), text(row.name), text(row.specialty) || undefined)),
        has_doctors: rows.length > 0,
      },
    };
  }

  if (screen === 'DOCTOR') {
    const doctorId = text(data.doctor_id);
    if (!doctorId) return { screen: 'DOCTOR', data: { ...data, error_message: 'Выберите врача.' } };
    const slots = await buildSlots(env, companyId, doctorId);
    return {
      screen: 'SLOT',
      data: {
        ...carry(data, ['name', 'phone', 'service', 'branch_id', 'doctor_id']),
        slots,
        has_slots: slots.length > 0,
      },
    };
  }

  return null;
}

async function appointmentDisplayNames(
  env: WabaClinicBookingEnv,
  companyId: string,
  branchId: string,
  doctorId: string,
): Promise<{ branchName: string; doctorName: string }> {
  const [branchRows, doctorRows] = await Promise.all([
    db<Row[]>(env, `waba_clinic_branches?id=eq.${encodeURIComponent(branchId)}&company_id=eq.${encodeURIComponent(companyId)}&select=id,name&limit=1`),
    db<Row[]>(env, `waba_clinic_doctors?id=eq.${encodeURIComponent(doctorId)}&company_id=eq.${encodeURIComponent(companyId)}&select=id,name&limit=1`),
  ]);
  return {
    branchName: text(branchRows[0]?.name) || 'Филиал',
    doctorName: text(doctorRows[0]?.name) || 'Врач',
  };
}

async function existingAppointmentByFlowToken(env: WabaClinicBookingEnv, companyId: string, flowToken: string): Promise<Row | null> {
  if (!flowToken) return null;
  const rows = await db<Row[]>(env,
    `waba_clinic_appointments?company_id=eq.${encodeURIComponent(companyId)}&flow_token=eq.${encodeURIComponent(flowToken)}&select=id,branch_id,doctor_id,starts_at,ends_at,status&limit=1`,
  );
  return rows[0] || null;
}

export async function createClinicAppointment(
  env: WabaClinicBookingEnv,
  companyId: string,
  data: Row,
  leadId: string,
  conversationId: string,
  flowToken: string,
): Promise<{ appointmentId: string; startsAt: string; endsAt: string; branchName: string; doctorName: string }> {
  const existing = await existingAppointmentByFlowToken(env, companyId, flowToken);
  if (existing) {
    const names = await appointmentDisplayNames(env, companyId, text(existing.branch_id), text(existing.doctor_id));
    return {
      appointmentId: text(existing.id),
      startsAt: text(existing.starts_at),
      endsAt: text(existing.ends_at),
      ...names,
    };
  }

  const branchId = text(data.branch_id);
  const doctorId = text(data.doctor_id);
  const startsAt = text(data.slot_id);
  if (!branchId || !doctorId || !startsAt) throw new Error('Не выбран филиал, врач или время записи');

  const [branchRows, doctorRows, availableSlots] = await Promise.all([
    db<Row[]>(env, `waba_clinic_branches?id=eq.${encodeURIComponent(branchId)}&company_id=eq.${encodeURIComponent(companyId)}&active=eq.true&select=id,name&limit=1`),
    db<Row[]>(env, `waba_clinic_doctors?id=eq.${encodeURIComponent(doctorId)}&company_id=eq.${encodeURIComponent(companyId)}&branch_id=eq.${encodeURIComponent(branchId)}&active=eq.true&select=id,name,specialty&limit=1`),
    buildSlots(env, companyId, doctorId),
  ]);
  const branch = branchRows[0];
  const doctor = doctorRows[0];
  const slot = availableSlots.find((item) => text(item.id) === startsAt);
  if (!branch || !doctor || !slot) throw new Error('Выбранное время уже недоступно. Вернитесь и выберите другой слот.');
  const endsAt = text(slot.ends_at);
  const payload = {
    company_id: companyId,
    lead_id: leadId || null,
    conversation_id: conversationId || null,
    branch_id: branchId,
    doctor_id: doctorId,
    starts_at: startsAt,
    ends_at: endsAt,
    patient_name: text(data.name),
    phone: text(data.phone),
    status: 'BOOKED',
    source: 'WhatsApp Flow',
    flow_token: flowToken,
    metadata: { service: text(data.service), created_from: 'imds_whatsapp_flow' },
    updated_at: new Date().toISOString(),
  };
  try {
    const rows = await db<Row[]>(env, 'waba_clinic_appointments?select=id,starts_at,ends_at', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    return {
      appointmentId: text(rows[0]?.id),
      startsAt: text(rows[0]?.starts_at) || startsAt,
      endsAt: text(rows[0]?.ends_at) || endsAt,
      branchName: text(branch.name),
      doctorName: text(doctor.name),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('waba_clinic_appointments_flow_token_uidx')) {
      const retry = await existingAppointmentByFlowToken(env, companyId, flowToken);
      if (retry) {
        const names = await appointmentDisplayNames(env, companyId, text(retry.branch_id), text(retry.doctor_id));
        return {
          appointmentId: text(retry.id),
          startsAt: text(retry.starts_at),
          endsAt: text(retry.ends_at),
          ...names,
        };
      }
    }
    if (message.includes('waba_clinic_appointments_doctor_slot_uidx') || message.includes('duplicate key')) {
      throw new Error('Это время только что заняли. Вернитесь и выберите другой слот.');
    }
    throw error;
  }
}

const APPOINTMENT_STATUSES = new Set(['BOOKED', 'CONFIRMED', 'COMPLETED', 'CANCELLED', 'NO_SHOW']);

async function setAppointmentStatus(
  request: Request,
  env: WabaClinicBookingEnv,
  companyId: string,
  id: string,
  nextStatus: string,
): Promise<Response> {
  if (!id || !APPOINTMENT_STATUSES.has(nextStatus)) return json({ error: 'Некорректный статус записи' }, 400);
  const rows = await db<Row[]>(env,
    `waba_clinic_appointments?id=eq.${encodeURIComponent(id)}&company_id=eq.${encodeURIComponent(companyId)}&select=id,status,metadata,lead_id,conversation_id,starts_at,ends_at,branch_id,doctor_id,patient_name,phone&limit=1`,
  );
  const current = rows[0];
  if (!current) return json({ error: 'Запись не найдена' }, 404);

  const previousStatus = text(current.status).toUpperCase() || 'BOOKED';
  const metadata = record(current.metadata);
  const priorHistory = Array.isArray(metadata.status_history) ? metadata.status_history : [];
  const changedAt = new Date().toISOString();
  const changedBy = text(request.headers.get('x-amanat-auth-user')) || null;
  const nextMetadata = {
    ...metadata,
    status_history: [
      ...priorHistory,
      { from: previousStatus, to: nextStatus, at: changedAt, by: changedBy },
    ].slice(-50),
  };
  const updated = await db<Row[]>(env,
    `waba_clinic_appointments?id=eq.${encodeURIComponent(id)}&company_id=eq.${encodeURIComponent(companyId)}&select=id,status,metadata,lead_id,conversation_id,starts_at,ends_at,branch_id,doctor_id,patient_name,phone`,
    {
      method: 'PATCH',
      body: JSON.stringify({ status: nextStatus, metadata: nextMetadata, updated_at: changedAt }),
    },
  );

  const leadId = text(current.lead_id);
  if (leadId && (nextStatus === 'BOOKED' || nextStatus === 'CONFIRMED')) {
    await db<Row[]>(env, `marketing_leads?id=eq.${encodeURIComponent(leadId)}&company_id=eq.${encodeURIComponent(companyId)}&select=id`, {
      method: 'PATCH',
      body: JSON.stringify({ stage: 'Запись', updated_at: changedAt }),
    }).catch((error) => console.error('Unable to sync lead stage from appointment status', error));
  }

  return json({ ok: true, item: updated[0] || null });
}

export async function handleClinicBookingAdminRequest(request: Request, env: WabaClinicBookingEnv, url: URL, companyId: string): Promise<Response | null> {
  if (url.pathname !== '/api/integrations/waba/flows/clinic/booking') return null;
  if (text(request.headers.get('x-amanat-auth-role')) !== 'administrator') return json({ error: 'Требуются права администратора' }, 403);

  if (request.method === 'GET') {
    const branchRows = await db<Row[]>(env, `waba_clinic_branches?company_id=eq.${encodeURIComponent(companyId)}&select=*&order=sort_order.asc,name.asc`);
    const doctorRows = await db<Row[]>(env, `waba_clinic_doctors?company_id=eq.${encodeURIComponent(companyId)}&select=*&order=sort_order.asc,name.asc`);
    const scheduleRows = await db<Row[]>(env, `waba_clinic_schedules?company_id=eq.${encodeURIComponent(companyId)}&select=*&order=weekday.asc,start_time.asc`);
    const upcoming = await db<Row[]>(env, `waba_clinic_appointments?company_id=eq.${encodeURIComponent(companyId)}&starts_at=gte.${encodeURIComponent(new Date().toISOString())}&status=in.(BOOKED,CONFIRMED)&select=id,branch_id,doctor_id,lead_id,conversation_id,starts_at,ends_at,patient_name,phone,status,metadata,created_at,updated_at&order=starts_at.asc&limit=100`);
    return json({ branches: branchRows, doctors: doctorRows, schedules: scheduleRows, upcoming });
  }

  if (request.method === 'POST') {
    const body = record(await request.json().catch(() => ({})));
    const action = text(body.action);
    if (action === 'save_branch') {
      const id = text(body.id);
      const payload = { company_id: companyId, name: text(body.name), address: text(body.address) || null, active: body.active !== false, sort_order: Number(body.sort_order) || 0, updated_at: new Date().toISOString() };
      if (!payload.name) return json({ error: 'Укажите название филиала' }, 400);
      const rows = id
        ? await db<Row[]>(env, `waba_clinic_branches?id=eq.${encodeURIComponent(id)}&company_id=eq.${encodeURIComponent(companyId)}&select=*`, { method: 'PATCH', body: JSON.stringify(payload) })
        : await db<Row[]>(env, 'waba_clinic_branches?select=*', { method: 'POST', body: JSON.stringify(payload) });
      return json({ ok: true, item: rows[0] || null });
    }
    if (action === 'save_doctor') {
      const id = text(body.id);
      const branchId = text(body.branch_id);
      const payload = { company_id: companyId, branch_id: branchId, name: text(body.name), specialty: text(body.specialty) || null, active: body.active !== false, sort_order: Number(body.sort_order) || 0, updated_at: new Date().toISOString() };
      if (!payload.name || !branchId) return json({ error: 'Укажите врача и филиал' }, 400);
      const rows = id
        ? await db<Row[]>(env, `waba_clinic_doctors?id=eq.${encodeURIComponent(id)}&company_id=eq.${encodeURIComponent(companyId)}&select=*`, { method: 'PATCH', body: JSON.stringify(payload) })
        : await db<Row[]>(env, 'waba_clinic_doctors?select=*', { method: 'POST', body: JSON.stringify(payload) });
      return json({ ok: true, item: rows[0] || null });
    }
    if (action === 'save_schedule') {
      const id = text(body.id);
      const doctorId = text(body.doctor_id);
      const payload = { company_id: companyId, doctor_id: doctorId, weekday: Number(body.weekday), start_time: text(body.start_time), end_time: text(body.end_time), slot_minutes: Number(body.slot_minutes) || 30, active: body.active !== false, updated_at: new Date().toISOString() };
      if (!doctorId || !payload.start_time || !payload.end_time || payload.weekday < 0 || payload.weekday > 6) return json({ error: 'Заполните врача, день и время расписания' }, 400);
      const rows = id
        ? await db<Row[]>(env, `waba_clinic_schedules?id=eq.${encodeURIComponent(id)}&company_id=eq.${encodeURIComponent(companyId)}&select=*`, { method: 'PATCH', body: JSON.stringify(payload) })
        : await db<Row[]>(env, 'waba_clinic_schedules?select=*', { method: 'POST', body: JSON.stringify(payload) });
      return json({ ok: true, item: rows[0] || null });
    }
    if (action === 'set_active') {
      const entity = text(body.entity);
      const id = text(body.id);
      const table = entity === 'branch' ? 'waba_clinic_branches' : entity === 'doctor' ? 'waba_clinic_doctors' : entity === 'schedule' ? 'waba_clinic_schedules' : '';
      if (!table || !id) return json({ error: 'Некорректный объект' }, 400);
      await db<Row[]>(env, `${table}?id=eq.${encodeURIComponent(id)}&company_id=eq.${encodeURIComponent(companyId)}&select=id`, { method: 'PATCH', body: JSON.stringify({ active: Boolean(body.active), updated_at: new Date().toISOString() }) });
      return json({ ok: true });
    }
    if (action === 'set_appointment_status') {
      return setAppointmentStatus(request, env, companyId, text(body.id), text(body.status).toUpperCase());
    }
    return json({ error: 'Неизвестное действие' }, 400);
  }

  return json({ error: 'Method not allowed' }, 405);
}
