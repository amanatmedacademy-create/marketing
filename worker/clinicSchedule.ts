import type { Env } from './integrations';
import { requireCompanyId, type TenantScopedEnv } from './tenantScope';

type Row = Record<string, unknown>;
type ScopedEnv = Env & TenantScopedEnv;

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
  if (!response.ok) throw new Error(`Clinic Schedule DB ${response.status}: ${raw.slice(0, 1500)}`);
  return (raw ? JSON.parse(raw) : null) as T;
}

function admin(request: Request): boolean {
  return text(request.headers.get('x-amanat-auth-role')) === 'administrator';
}

async function snapshot(env: ScopedEnv): Promise<Response> {
  const companyId = requireCompanyId(env);
  const now = new Date().toISOString();
  const [branches, doctors, schedules, appointments] = await Promise.all([
    db<Row[]>(env, `waba_clinic_branches?company_id=eq.${encodeURIComponent(companyId)}&select=*&order=sort_order.asc,name.asc`),
    db<Row[]>(env, `waba_clinic_doctors?company_id=eq.${encodeURIComponent(companyId)}&select=*&order=sort_order.asc,name.asc`),
    db<Row[]>(env, `waba_clinic_schedules?company_id=eq.${encodeURIComponent(companyId)}&select=*&order=weekday.asc,start_time.asc`),
    db<Row[]>(env, `waba_clinic_appointments?company_id=eq.${encodeURIComponent(companyId)}&starts_at=gte.${encodeURIComponent(now)}&select=id,branch_id,doctor_id,lead_id,starts_at,ends_at,patient_name,phone,status,source,metadata&order=starts_at.asc&limit=250`),
  ]);
  return json({ branches, doctors, schedules, appointments });
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
  const startTime = text(body.start_time);
  const endTime = text(body.end_time);
  const slotMinutes = Number(body.slot_minutes) || 30;
  if (!doctorId || !Number.isInteger(weekday) || weekday < 0 || weekday > 6 || !startTime || !endTime) return json({ error: 'Заполните врача, день и время' }, 400);
  if (startTime >= endTime) return json({ error: 'Начало смены должно быть раньше окончания' }, 400);
  if (slotMinutes < 5 || slotMinutes > 240) return json({ error: 'Длительность слота должна быть от 5 до 240 минут' }, 400);
  const doctors = await db<Row[]>(env, `waba_clinic_doctors?company_id=eq.${encodeURIComponent(companyId)}&id=eq.${encodeURIComponent(doctorId)}&select=id&limit=1`);
  if (!doctors[0]) return json({ error: 'Врач не принадлежит выбранной клинике' }, 404);

  const existing = await db<Row[]>(env, `waba_clinic_schedules?company_id=eq.${encodeURIComponent(companyId)}&doctor_id=eq.${encodeURIComponent(doctorId)}&weekday=eq.${weekday}&active=eq.true&select=id,start_time,end_time`);
  const overlap = existing.find((row) => text(row.id) !== id && startTime < text(row.end_time) && endTime > text(row.start_time));
  if (overlap) return json({ error: `Интервал пересекается с ${text(overlap.start_time).slice(0, 5)}–${text(overlap.end_time).slice(0, 5)}` }, 409);

  const payload = {
    company_id: companyId,
    doctor_id: doctorId,
    weekday,
    start_time: startTime,
    end_time: endTime,
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
    method: 'PATCH',
    headers: { prefer: 'return=representation' },
    body: JSON.stringify({ active: body.active === true, updated_at: new Date().toISOString() }),
  });
  if (!rows.length) return json({ error: 'Объект не найден в выбранной клинике' }, 404);
  return json({ ok: true });
}

async function appointmentStatus(request: Request, env: ScopedEnv, body: Row): Promise<Response> {
  const companyId = requireCompanyId(env);
  const id = text(body.id);
  const status = text(body.status).toUpperCase();
  const allowed = new Set(['BOOKED', 'CONFIRMED', 'COMPLETED', 'CANCELLED', 'NO_SHOW']);
  if (!id || !allowed.has(status)) return json({ error: 'Некорректный статус записи' }, 400);
  const rows = await db<Row[]>(env, `waba_clinic_appointments?company_id=eq.${encodeURIComponent(companyId)}&id=eq.${encodeURIComponent(id)}&select=id,status,metadata,lead_id&limit=1`);
  const current = rows[0];
  if (!current) return json({ error: 'Запись не найдена в выбранной клинике' }, 404);
  const metadata = record(current.metadata);
  const history = Array.isArray(metadata.status_history) ? metadata.status_history : [];
  const changedAt = new Date().toISOString();
  const nextMetadata = { ...metadata, status_history: [...history, { from: text(current.status), to: status, at: changedAt, by: text(request.headers.get('x-amanat-auth-user')) || null }].slice(-50) };
  const updated = await db<Row[]>(env, `waba_clinic_appointments?company_id=eq.${encodeURIComponent(companyId)}&id=eq.${encodeURIComponent(id)}&select=*`, {
    method: 'PATCH', headers: { prefer: 'return=representation' }, body: JSON.stringify({ status, metadata: nextMetadata, updated_at: changedAt }),
  });
  const leadId = text(current.lead_id);
  if (leadId && (status === 'BOOKED' || status === 'CONFIRMED')) {
    await db(env, `marketing_leads?company_id=eq.${encodeURIComponent(companyId)}&id=eq.${encodeURIComponent(leadId)}`, { method: 'PATCH', body: JSON.stringify({ stage: 'Запись', updated_at: changedAt }) }).catch(() => null);
  }
  return json({ ok: true, item: updated[0] || null });
}

export async function handleClinicSchedule(request: Request, env: Env, url: URL): Promise<Response | null> {
  if (!url.pathname.startsWith('/api/clinic-schedule')) return null;
  const scoped = env as ScopedEnv;
  if (url.pathname === '/api/clinic-schedule' && request.method === 'GET') return snapshot(scoped);
  if (url.pathname !== '/api/clinic-schedule' || request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const body = record(await request.json().catch(() => ({})));
  const action = text(body.action);
  if (action === 'save_branch') return saveBranch(request, scoped, body);
  if (action === 'save_doctor') return saveDoctor(request, scoped, body);
  if (action === 'save_schedule') return saveSchedule(request, scoped, body);
  if (action === 'set_active') return toggle(request, scoped, body);
  if (action === 'set_appointment_status') return appointmentStatus(request, scoped, body);
  return json({ error: 'Неизвестное действие' }, 400);
}
