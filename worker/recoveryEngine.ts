import type { Env } from './integrations';
import { requireCompanyId, type TenantScopedEnv } from './tenantScope';
import { handleWabaMessagingV2Request, type WabaMessagingV2Env } from './wabaMessagingV2';
import { runAppointmentRecovery } from './appointmentRecovery';

type Row = Record<string, unknown>;
export type RecoveryEnv = Env & TenantScopedEnv & WabaMessagingV2Env;

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});
const text = (value: unknown): string => typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim();
const num = (value: unknown): number => Number.isFinite(Number(value)) ? Number(value) : 0;
const record = (value: unknown): Row => value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {};
const role = (request: Request) => text(request.headers.get('x-amanat-auth-role')).toLowerCase();
const isAdmin = (request: Request) => role(request) === 'administrator';
const canRun = (request: Request) => ['administrator', 'marketer'].includes(role(request));

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
  if (!response.ok) throw new Error(`Recovery Engine DB ${response.status}: ${body.slice(0, 1200)}`);
  return (body ? JSON.parse(body) : null) as T;
}

async function settings(env: RecoveryEnv, companyId: string): Promise<Row> {
  const rows = await db<Row[]>(env, `growth_recovery_settings?company_id=eq.${encodeURIComponent(companyId)}&select=*&limit=1`);
  return rows[0] || {
    company_id: companyId,
    enabled: false,
    create_tasks: true,
    stale_lead_enabled: true,
    lost_opportunity_enabled: true,
    appointment_recovery_enabled: true,
    no_show_grace_minutes: 60,
    whatsapp_enabled: false,
    lost_task_delay_minutes: 15,
    whatsapp_template_name: null,
    whatsapp_template_language: 'ru',
    whatsapp_template_parameters: [],
  };
}

async function responseSettings(env: RecoveryEnv, companyId: string): Promise<Row> {
  const rows = await db<Row[]>(env, `growth_response_settings?company_id=eq.${encodeURIComponent(companyId)}&select=sla_seconds,stale_after_hours&limit=1`);
  return rows[0] || { sla_seconds: 300, stale_after_hours: 24 };
}

async function explicitConversation(env: RecoveryEnv, companyId: string, leadId: string): Promise<Row | null> {
  const rows = await db<Row[]>(env, `marketing_conversations?company_id=eq.${encodeURIComponent(companyId)}&lead_id=eq.${encodeURIComponent(leadId)}&archived_at=is.null&channel=eq.WHATSAPP&select=id,lead_id,assigned_user_id,phone,company_id,last_message_at&order=last_message_at.desc.nullslast&limit=1`);
  return rows[0] || null;
}

async function actionExists(env: RecoveryEnv, companyId: string, dedupeKey: string): Promise<boolean> {
  const rows = await db<Row[]>(env, `growth_recovery_actions?company_id=eq.${encodeURIComponent(companyId)}&dedupe_key=eq.${encodeURIComponent(dedupeKey)}&select=id&limit=1`);
  return Boolean(rows[0]);
}

async function insertAction(env: RecoveryEnv, value: Row): Promise<Row> {
  const rows = await db<Row[]>(env, 'growth_recovery_actions?select=*', {
    method: 'POST',
    headers: { prefer: 'return=representation' },
    body: JSON.stringify(value),
  });
  if (!rows[0]) throw new Error('Не удалось создать recovery action');
  return rows[0];
}

async function createTask(env: RecoveryEnv, companyId: string, input: {
  title: string;
  description: string;
  assigneeId?: string | null;
  dueAt: string;
}): Promise<Row> {
  const rows = await db<Row[]>(env, 'crm_tasks?select=*', {
    method: 'POST',
    headers: { prefer: 'return=representation' },
    body: JSON.stringify({
      company_id: companyId,
      title: input.title,
      description: input.description,
      status: 'todo',
      priority: 'high',
      assignee_id: input.assigneeId || null,
      due_at: input.dueAt,
      updated_at: new Date().toISOString(),
    }),
  });
  if (!rows[0]) throw new Error('Не удалось создать CRM-задачу');
  return rows[0];
}

function isClosedLead(lead: Row): boolean {
  if (lead.sold_at || num(lead.sale_amount) > 0 || lead.rejected_at || lead.deal_rejected_at) return true;
  const stage = text(lead.stage).toLowerCase();
  return /продаж|успеш|закрыт|отказ|нецелев|lost|won|sold|reject/.test(stage);
}

function candidateDue(value: unknown, fallbackMs: number): number {
  const parsed = Date.parse(text(value));
  return Number.isFinite(parsed) ? parsed : fallbackMs;
}

function templateTokens(raw: unknown, lead: Row, lost?: Row): string[] {
  const tokens = Array.isArray(raw) ? raw.map(text) : [];
  const values: Record<string, string> = {
    '$lead_name': text(lead.name) || 'Пациент',
    '$reason': text(lost?.reason),
    '$next_action': text(lost?.next_action) || text(lead.next_action),
    '$source': text(lead.source) || text(lead.platform),
  };
  return tokens.map((token) => values[token] ?? token);
}

async function queueWhatsappAction(env: RecoveryEnv, companyId: string, triggerType: 'stale_lead' | 'lost_opportunity', lead: Row, lost: Row | undefined, cfg: Row): Promise<boolean> {
  if (cfg.whatsapp_enabled !== true || !text(cfg.whatsapp_template_name) || !text(cfg.whatsapp_template_language)) return false;
  const leadId = text(lead.id);
  if (!leadId) return false;
  const conversation = await explicitConversation(env, companyId, leadId);
  if (!conversation) return false;
  const objectId = lost ? text(lost.id) : leadId;
  const dedupeKey = `whatsapp:${triggerType}:${objectId}`;
  if (await actionExists(env, companyId, dedupeKey)) return false;
  await insertAction(env, {
    company_id: companyId,
    lead_id: leadId,
    lost_opportunity_id: lost ? text(lost.id) : null,
    conversation_id: text(conversation.id),
    trigger_type: triggerType,
    action_type: 'whatsapp_template',
    status: 'pending',
    scheduled_at: new Date().toISOString(),
    template_name: text(cfg.whatsapp_template_name),
    template_language: text(cfg.whatsapp_template_language),
    dedupe_key: dedupeKey,
    metadata: { parameters: templateTokens(cfg.whatsapp_template_parameters, lead, lost), source: 'recovery_engine' },
  });
  return true;
}

async function createStaleLeadRecovery(env: RecoveryEnv, companyId: string, lead: Row, cfg: Row): Promise<{ tasks: number; whatsappQueued: number }> {
  let tasks = 0;
  let whatsappQueued = 0;
  const leadId = text(lead.id);
  const conversation = leadId ? await explicitConversation(env, companyId, leadId) : null;
  if (cfg.create_tasks === true && leadId) {
    const dedupeKey = `task:stale_lead:${leadId}`;
    if (!await actionExists(env, companyId, dedupeKey)) {
      const task = await createTask(env, companyId, {
        title: 'Связаться с лидом без ответа',
        description: `Лид ${text(lead.name) || 'Без имени'}${text(lead.source) ? ` · источник: ${text(lead.source)}` : ''}. Клиника ещё не зафиксировала первый ответ.`,
        assigneeId: text(conversation?.assigned_user_id) || null,
        dueAt: new Date().toISOString(),
      });
      await insertAction(env, {
        company_id: companyId,
        lead_id: leadId,
        conversation_id: text(conversation?.id) || null,
        task_id: text(task.id),
        trigger_type: 'stale_lead',
        action_type: 'task',
        status: 'completed',
        scheduled_at: new Date().toISOString(),
        executed_at: new Date().toISOString(),
        dedupe_key: dedupeKey,
        metadata: { source: 'recovery_engine' },
      });
      tasks += 1;
    }
  }
  if (await queueWhatsappAction(env, companyId, 'stale_lead', lead, undefined, cfg)) whatsappQueued += 1;
  return { tasks, whatsappQueued };
}

async function createLostRecovery(env: RecoveryEnv, companyId: string, lost: Row, lead: Row, cfg: Row): Promise<{ tasks: number; whatsappQueued: number }> {
  let tasks = 0;
  let whatsappQueued = 0;
  const lostId = text(lost.id);
  const leadId = text(lead.id);
  if (cfg.create_tasks === true && lostId) {
    const dedupeKey = `task:lost_opportunity:${lostId}`;
    if (!await actionExists(env, companyId, dedupeKey)) {
      const dueMs = candidateDue(lost.next_action_at, Date.parse(text(lost.detected_at)) + Math.max(0, num(cfg.lost_task_delay_minutes)) * 60000);
      const task = await createTask(env, companyId, {
        title: 'Вернуть потерянную возможность',
        description: `${text(lead.name) || 'Пациент'} · причина: ${text(lost.reason) || 'не указана'}${text(lost.next_action) ? ` · действие: ${text(lost.next_action)}` : ''}.`,
        assigneeId: text(lost.owner_user_id) || null,
        dueAt: new Date(Math.max(Date.now(), Number.isFinite(dueMs) ? dueMs : Date.now())).toISOString(),
      });
      await insertAction(env, {
        company_id: companyId,
        lead_id: leadId || null,
        lost_opportunity_id: lostId,
        task_id: text(task.id),
        trigger_type: 'lost_opportunity',
        action_type: 'task',
        status: 'completed',
        scheduled_at: new Date().toISOString(),
        executed_at: new Date().toISOString(),
        dedupe_key: dedupeKey,
        metadata: { source: 'recovery_engine' },
      });
      tasks += 1;
    }
  }
  if (leadId && await queueWhatsappAction(env, companyId, 'lost_opportunity', lead, lost, cfg)) whatsappQueued += 1;
  return { tasks, whatsappQueued };
}

export async function runRecoveryForCurrentCompany(env: RecoveryEnv): Promise<Row> {
  const companyId = requireCompanyId(env);
  const [cfg, responseCfg] = await Promise.all([settings(env, companyId), responseSettings(env, companyId)]);
  if (cfg.enabled !== true) return {
    enabled: false,
    scanned: 0,
    tasksCreated: 0,
    whatsappQueued: 0,
    appointmentNoShowCandidates: 0,
    appointmentUnconfirmedCandidates: 0,
    message: 'Recovery Engine выключен для текущей клиники',
  };

  const now = Date.now();
  const staleHours = Math.max(1, num(responseCfg.stale_after_hours) || 24);
  const staleBefore = new Date(now - staleHours * 3600000).toISOString();
  const [leads, lostRows] = await Promise.all([
    cfg.stale_lead_enabled === true
      ? db<Row[]>(env, `marketing_leads?company_id=eq.${encodeURIComponent(companyId)}&first_response_at=is.null&lead_created_at=lte.${encodeURIComponent(staleBefore)}&select=id,name,source,platform,stage,next_action,lead_created_at,sold_at,rejected_at,deal_rejected_at,sale_amount&order=lead_created_at.asc&limit=1000`)
      : Promise.resolve([]),
    cfg.lost_opportunity_enabled === true
      ? db<Row[]>(env, `lost_opportunities?company_id=eq.${encodeURIComponent(companyId)}&status=in.(open,recovering)&select=id,lead_id,status,reason,owner_user_id,next_action,next_action_at,detected_at,estimated_value,currency&order=detected_at.asc&limit=1000`)
      : Promise.resolve([]),
  ]);

  let tasksCreated = 0;
  let whatsappQueued = 0;
  let eligible = 0;

  for (const lead of leads) {
    if (isClosedLead(lead)) continue;
    eligible += 1;
    const result = await createStaleLeadRecovery(env, companyId, lead, cfg);
    tasksCreated += result.tasks;
    whatsappQueued += result.whatsappQueued;
  }

  for (const lost of lostRows) {
    const dueMs = candidateDue(lost.next_action_at, Date.parse(text(lost.detected_at)) + Math.max(0, num(cfg.lost_task_delay_minutes)) * 60000);
    if (Number.isFinite(dueMs) && dueMs > now) continue;
    const leadId = text(lost.lead_id);
    if (!leadId) continue;
    const leadRows = await db<Row[]>(env, `marketing_leads?company_id=eq.${encodeURIComponent(companyId)}&id=eq.${encodeURIComponent(leadId)}&select=id,name,source,platform,stage,next_action,sold_at,rejected_at,deal_rejected_at,sale_amount&limit=1`);
    const lead = leadRows[0];
    if (!lead || isClosedLead(lead)) continue;
    eligible += 1;
    const result = await createLostRecovery(env, companyId, lost, lead, cfg);
    tasksCreated += result.tasks;
    whatsappQueued += result.whatsappQueued;
  }

  const appointment = await runAppointmentRecovery(env, companyId, {
    appointment_recovery_enabled: cfg.appointment_recovery_enabled !== false,
    create_tasks: cfg.create_tasks === true,
    no_show_grace_minutes: num(cfg.no_show_grace_minutes) || 60,
  });
  tasksCreated += appointment.tasksCreated;
  eligible += appointment.noShowCandidates + appointment.unconfirmedCandidates;

  return {
    enabled: true,
    scanned: leads.length + lostRows.length + appointment.scanned,
    eligible,
    tasksCreated,
    whatsappQueued,
    appointmentNoShowCandidates: appointment.noShowCandidates,
    appointmentUnconfirmedCandidates: appointment.unconfirmedCandidates,
  };
}

async function getSettings(env: RecoveryEnv): Promise<Response> {
  const companyId = requireCompanyId(env);
  return json(await settings(env, companyId));
}

async function putSettings(request: Request, env: RecoveryEnv): Promise<Response> {
  if (!isAdmin(request)) return json({ error: 'Настройки Recovery Engine доступны только администратору' }, 403);
  const companyId = requireCompanyId(env);
  const input = record(await request.json().catch(() => ({})));
  const parameters = Array.isArray(input.whatsappTemplateParameters)
    ? input.whatsappTemplateParameters.map(text).filter(Boolean).slice(0, 20)
    : [];
  const stored = {
    company_id: companyId,
    enabled: input.enabled === true,
    create_tasks: input.createTasks !== false,
    stale_lead_enabled: input.staleLeadEnabled !== false,
    lost_opportunity_enabled: input.lostOpportunityEnabled !== false,
    appointment_recovery_enabled: input.appointmentRecoveryEnabled !== false,
    no_show_grace_minutes: Math.min(Math.max(Math.round(num(input.noShowGraceMinutes) || 60), 0), 10080),
    whatsapp_enabled: input.whatsappEnabled === true,
    lost_task_delay_minutes: Math.min(Math.max(Math.round(num(input.lostTaskDelayMinutes) || 15), 0), 10080),
    whatsapp_template_name: text(input.whatsappTemplateName) || null,
    whatsapp_template_language: text(input.whatsappTemplateLanguage) || 'ru',
    whatsapp_template_parameters: parameters,
    updated_at: new Date().toISOString(),
  };
  if (stored.whatsapp_enabled && !stored.whatsapp_template_name) return json({ error: 'Для WhatsApp Recovery выберите одобренный шаблон' }, 400);
  const rows = await db<Row[]>(env, 'growth_recovery_settings?on_conflict=company_id&select=*', {
    method: 'POST',
    headers: { prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify(stored),
  });
  return json(rows[0] || stored);
}

async function getActions(env: RecoveryEnv, url: URL): Promise<Response> {
  const companyId = requireCompanyId(env);
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit') || 100), 1), 1000);
  return json(await db<Row[]>(env, `growth_recovery_actions?company_id=eq.${encodeURIComponent(companyId)}&select=*&order=created_at.desc&limit=${limit}`));
}

async function runRecovery(request: Request, env: RecoveryEnv): Promise<Response> {
  if (!canRun(request)) return json({ error: 'Recovery Engine доступен администратору и маркетологу' }, 403);
  return json({ ok: true, ...(await runRecoveryForCurrentCompany(env)) });
}

async function sendPendingWhatsapp(request: Request, env: RecoveryEnv, actionId: string): Promise<Response> {
  if (!canRun(request)) return json({ error: 'Recovery follow-up доступен администратору и маркетологу' }, 403);
  const companyId = requireCompanyId(env);
  const rows = await db<Row[]>(env, `growth_recovery_actions?id=eq.${encodeURIComponent(actionId)}&company_id=eq.${encodeURIComponent(companyId)}&action_type=eq.whatsapp_template&select=*&limit=1`);
  const action = rows[0];
  if (!action) return json({ error: 'Recovery action не найден в текущей клинике' }, 404);
  if (text(action.status) === 'sent') return json({ error: 'WhatsApp follow-up уже отправлен' }, 409);
  const conversationId = text(action.conversation_id);
  if (!conversationId) return json({ error: 'Для follow-up нет связанного WhatsApp-диалога' }, 400);
  const conversations = await db<Row[]>(env, `marketing_conversations?id=eq.${encodeURIComponent(conversationId)}&company_id=eq.${encodeURIComponent(companyId)}&channel=eq.WHATSAPP&archived_at=is.null&select=id,company_id&limit=1`);
  if (!conversations[0]) return json({ error: 'WhatsApp-диалог не найден в текущей клинике' }, 404);

  const metadata = record(action.metadata);
  const parameters = Array.isArray(metadata.parameters) ? metadata.parameters.map(text) : [];
  const syntheticUrl = new URL(`/api/callcenter/threads/${encodeURIComponent(conversationId)}/messages`, request.url);
  const synthetic = new Request(syntheticUrl.toString(), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      template: { name: text(action.template_name), languageCode: text(action.template_language), parameters },
      senderName: 'Recovery Engine',
    }),
  });
  const response = await handleWabaMessagingV2Request(synthetic, env, syntheticUrl);
  if (!response) return json({ error: 'WABA handler не обработал Recovery follow-up' }, 500);
  const raw = await response.clone().text();
  let payload: Row = {};
  try { payload = record(raw ? JSON.parse(raw) : {}); } catch { payload = { raw }; }
  const now = new Date().toISOString();
  if (!response.ok) {
    await db<Row[]>(env, `growth_recovery_actions?id=eq.${encodeURIComponent(actionId)}&company_id=eq.${encodeURIComponent(companyId)}&select=id`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'failed', last_error: text(payload.error) || raw.slice(0, 1000), updated_at: now }),
    });
    return json({ error: text(payload.error) || 'WhatsApp follow-up не отправлен' }, response.status);
  }
  await db<Row[]>(env, `growth_recovery_actions?id=eq.${encodeURIComponent(actionId)}&company_id=eq.${encodeURIComponent(companyId)}&select=id`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'sent', executed_at: now, external_message_id: text(payload.externalId) || null, last_error: null, updated_at: now }),
  });
  return json({ ok: true, message: payload });
}

export async function handleRecoveryEngine(request: Request, env: RecoveryEnv, url: URL): Promise<Response | null> {
  if (url.pathname === '/api/growth/recovery/settings') {
    if (request.method === 'GET') return getSettings(env);
    if (request.method === 'PUT') return putSettings(request, env);
    return json({ error: 'Method not allowed' }, 405);
  }
  if (url.pathname === '/api/growth/recovery/actions' && request.method === 'GET') return getActions(env, url);
  if (url.pathname === '/api/growth/recovery/run' && request.method === 'POST') return runRecovery(request, env);
  const sendMatch = url.pathname.match(/^\/api\/growth\/recovery\/actions\/([^/]+)\/send$/);
  if (sendMatch && request.method === 'POST') return sendPendingWhatsapp(request, env, decodeURIComponent(sendMatch[1]));
  return null;
}
