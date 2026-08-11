import type { Env } from './integrations';
import type { TenantScopedEnv } from './tenantScope';

type Row = Record<string, unknown>;
export type AppointmentRecoveryEnv = Env & TenantScopedEnv;

export interface AppointmentRecoverySettings {
  appointment_recovery_enabled?: boolean;
  create_tasks?: boolean;
  no_show_grace_minutes?: number;
}

export interface AppointmentRecoveryResult {
  scanned: number;
  noShowCandidates: number;
  unconfirmedCandidates: number;
  tasksCreated: number;
}

const text = (value: unknown): string => typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim();
const num = (value: unknown): number => Number.isFinite(Number(value)) ? Number(value) : 0;

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
  const body = await response.text();
  if (!response.ok) throw new Error(`Appointment Recovery DB ${response.status}: ${body.slice(0, 1200)}`);
  return (body ? JSON.parse(body) : null) as T;
}

async function conversationAssignee(env: AppointmentRecoveryEnv, companyId: string, conversationId: string): Promise<string | null> {
  if (!conversationId) return null;
  const rows = await db<Row[]>(env, `marketing_conversations?id=eq.${encodeURIComponent(conversationId)}&company_id=eq.${encodeURIComponent(companyId)}&select=id,assigned_user_id&limit=1`);
  return text(rows[0]?.assigned_user_id) || null;
}

async function reserveAction(
  env: AppointmentRecoveryEnv,
  companyId: string,
  appointment: Row,
  triggerType: 'appointment_no_show' | 'appointment_unconfirmed',
): Promise<Row | null> {
  const appointmentId = text(appointment.id);
  const dedupeKey = `task:${triggerType}:${appointmentId}`;
  const existing = await db<Row[]>(env, `growth_recovery_actions?company_id=eq.${encodeURIComponent(companyId)}&dedupe_key=eq.${encodeURIComponent(dedupeKey)}&select=id&limit=1`);
  if (existing[0]) return null;

  try {
    const rows = await db<Row[]>(env, 'growth_recovery_actions?select=*', {
      method: 'POST',
      headers: { prefer: 'return=representation' },
      body: JSON.stringify({
        company_id: companyId,
        lead_id: text(appointment.lead_id) || null,
        appointment_id: appointmentId,
        conversation_id: text(appointment.conversation_id) || null,
        trigger_type: triggerType,
        action_type: 'task',
        status: 'pending',
        scheduled_at: new Date().toISOString(),
        dedupe_key: dedupeKey,
        metadata: {
          source: 'appointment_recovery',
          appointment_status: text(appointment.status),
          starts_at: text(appointment.starts_at) || null,
          ends_at: text(appointment.ends_at) || null,
        },
      }),
    });
    return rows[0] || null;
  } catch (error) {
    if (/duplicate|unique/i.test(error instanceof Error ? error.message : String(error))) return null;
    throw error;
  }
}

async function completeAction(env: AppointmentRecoveryEnv, companyId: string, actionId: string, taskId: string): Promise<void> {
  const now = new Date().toISOString();
  await db<Row[]>(env, `growth_recovery_actions?id=eq.${encodeURIComponent(actionId)}&company_id=eq.${encodeURIComponent(companyId)}&select=id`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'completed', task_id: taskId, executed_at: now, last_error: null, updated_at: now }),
  });
}

async function failAction(env: AppointmentRecoveryEnv, companyId: string, actionId: string, error: unknown): Promise<void> {
  await db<Row[]>(env, `growth_recovery_actions?id=eq.${encodeURIComponent(actionId)}&company_id=eq.${encodeURIComponent(companyId)}&select=id`, {
    method: 'PATCH',
    body: JSON.stringify({
      status: 'failed',
      last_error: (error instanceof Error ? error.message : String(error)).slice(0, 1000),
      updated_at: new Date().toISOString(),
    }),
  }).catch(() => undefined);
}

async function createTaskForAppointment(
  env: AppointmentRecoveryEnv,
  companyId: string,
  appointment: Row,
  triggerType: 'appointment_no_show' | 'appointment_unconfirmed',
): Promise<boolean> {
  const action = await reserveAction(env, companyId, appointment, triggerType);
  if (!action) return false;

  try {
    const patient = text(appointment.patient_name) || 'Пациент';
    const planned = text(appointment.starts_at);
    const assigneeId = await conversationAssignee(env, companyId, text(appointment.conversation_id));
    const isNoShow = triggerType === 'appointment_no_show';
    const title = isNoShow
      ? `Вернуть пациента после неявки: ${patient}`
      : `Проверить факт визита: ${patient}`;
    const description = isNoShow
      ? `В записи клиники явно установлен статус NO_SHOW${planned ? ` · визит был запланирован на ${planned}` : ''}. Свяжитесь с пациентом и предложите повторную запись.`
      : `Время визита уже прошло${planned ? ` · запись была на ${planned}` : ''}, но статус остаётся ${text(appointment.status) || 'BOOKED'}. Проверьте факт визита и установите COMPLETED, NO_SHOW или CANCELLED. Система не считает такой визит неявкой автоматически.`;

    const tasks = await db<Row[]>(env, 'crm_tasks?select=*', {
      method: 'POST',
      headers: { prefer: 'return=representation' },
      body: JSON.stringify({
        company_id: companyId,
        title,
        description,
        status: 'todo',
        priority: 'high',
        assignee_id: assigneeId,
        due_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }),
    });
    const taskId = text(tasks[0]?.id);
    if (!taskId) throw new Error('Не удалось создать CRM-задачу по записи');
    await completeAction(env, companyId, text(action.id), taskId);
    return true;
  } catch (error) {
    await failAction(env, companyId, text(action.id), error);
    throw error;
  }
}

export async function runAppointmentRecovery(
  env: AppointmentRecoveryEnv,
  companyId: string,
  cfg: AppointmentRecoverySettings,
): Promise<AppointmentRecoveryResult> {
  if (cfg.appointment_recovery_enabled === false) {
    return { scanned: 0, noShowCandidates: 0, unconfirmedCandidates: 0, tasksCreated: 0 };
  }

  const graceMinutes = Math.min(Math.max(Math.round(num(cfg.no_show_grace_minutes) || 60), 0), 10080);
  const cutoff = new Date(Date.now() - graceMinutes * 60000).toISOString();
  const [noShows, unconfirmed] = await Promise.all([
    db<Row[]>(env, `waba_clinic_appointments?company_id=eq.${encodeURIComponent(companyId)}&source=neq.MIS&status=eq.NO_SHOW&select=id,company_id,lead_id,conversation_id,patient_name,status,starts_at,ends_at&order=ends_at.asc&limit=1000`),
    db<Row[]>(env, `waba_clinic_appointments?company_id=eq.${encodeURIComponent(companyId)}&source=neq.MIS&status=in.(BOOKED,CONFIRMED)&ends_at=lte.${encodeURIComponent(cutoff)}&select=id,company_id,lead_id,conversation_id,patient_name,status,starts_at,ends_at&order=ends_at.asc&limit=1000`),
  ]);

  let tasksCreated = 0;
  if (cfg.create_tasks !== false) {
    for (const appointment of noShows) {
      if (await createTaskForAppointment(env, companyId, appointment, 'appointment_no_show')) tasksCreated += 1;
    }
    for (const appointment of unconfirmed) {
      if (await createTaskForAppointment(env, companyId, appointment, 'appointment_unconfirmed')) tasksCreated += 1;
    }
  }

  return {
    scanned: noShows.length + unconfirmed.length,
    noShowCandidates: noShows.length,
    unconfirmedCandidates: unconfirmed.length,
    tasksCreated,
  };
}
