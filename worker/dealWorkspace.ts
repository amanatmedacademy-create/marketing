import type { Env } from './integrations';
import { requireCompanyId, type TenantScopedEnv } from './tenantScope';

type Row = Record<string, unknown>;
type ScopedEnv = Env & TenantScopedEnv;
type ActivityType = 'comment' | 'task' | 'note';

const ROLE_HEADER = 'x-amanat-auth-role';
const USER_HEADER = 'x-amanat-auth-user';
const WRITE_ROLES = new Set(['administrator', 'marketer']);

class UpstreamError extends Error {
  constructor(readonly status: number, readonly detail: string) {
    super(`Supabase request failed with HTTP ${status}`);
  }
}

function requestId(request: Request): string { return request.headers.get('x-correlation-id') || crypto.randomUUID(); }
function json(id: string, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'x-request-id': id } });
}
function role(request: Request): string { return (request.headers.get(ROLE_HEADER) || '').trim().toLowerCase(); }
function actorId(request: Request): string | null {
  const value = (request.headers.get(USER_HEADER) || '').trim();
  return /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(value) ? value : null;
}
function apiBase(env: Env): string { return `${env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1`; }
async function supabase<T>(env: Env, path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${apiBase(env)}${path}`, { ...init, headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, 'content-type': 'application/json', ...init.headers } });
  const text = await response.text();
  if (!response.ok) throw new UpstreamError(response.status, text.slice(0, 1200));
  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}
function asString(value: unknown): string { return typeof value === 'string' ? value : ''; }
function asNullableString(value: unknown): string | null { const result = asString(value).trim(); return result || null; }
function encodeEq(value: string): string { return encodeURIComponent(value); }
function inFilter(values: string[]): string { return values.map((value) => value.replace(/[^0-9a-f-]/gi, '')).filter(Boolean).join(','); }

function mapActivity(row: Row) {
  return { id: asString(row.id), dealId: asString(row.deal_id), type: asString(row.activity_type), body: asString(row.body), dueAt: asNullableString(row.due_at), completedAt: asNullableString(row.completed_at), actorUserId: asNullableString(row.actor_user_id), createdAt: asString(row.created_at), updatedAt: asString(row.updated_at) };
}
function mapMessage(row: Row) {
  return { id: asString(row.id), conversationId: asString(row.conversation_id), body: asString(row.body), direction: asString(row.direction), senderName: asNullableString(row.sender_name), status: asString(row.status), sentAt: asString(row.sent_at), attachmentName: asNullableString(row.attachment_name), attachmentMimeType: asNullableString(row.attachment_mime_type) };
}
function mapCall(row: Row) {
  return { id: asString(row.id), leadId: asNullableString(row.lead_id), operatorName: asNullableString(row.operator_name) || asNullableString(row.client_name), clientPhone: asNullableString(row.client_phone), channel: asNullableString(row.channel), status: asString(row.call_status), startedAt: asString(row.started_at), scheduledAt: asNullableString(row.scheduled_at), durationSeconds: Number(row.duration_seconds || 0), recordingUrl: asNullableString(row.recording_url), summary: asNullableString(row.summary), result: asNullableString(row.call_result), nextAction: asNullableString(row.next_action) };
}
function mapStageEvent(row: Row) {
  return { id: asString(row.id), dealId: asString(row.deal_id), pipelineId: asString(row.pipeline_id), fromStageId: asNullableString(row.from_stage_id), toStageId: asString(row.to_stage_id), actorUserId: asNullableString(row.actor_user_id), reason: asNullableString(row.reason), createdAt: asString(row.created_at) };
}
function mapConversation(row: Row) {
  return { id: asString(row.id), leadId: asNullableString(row.lead_id), title: asNullableString(row.title), phone: asNullableString(row.phone), channel: asString(row.channel), status: asString(row.status), assignedUserId: asNullableString(row.assigned_user_id), unreadCount: Number(row.unread_count || 0), lastMessageAt: asNullableString(row.last_message_at) };
}
function mapUser(row: Row) { return { id: asString(row.id), fullName: asNullableString(row.full_name) || asNullableString(row.name) || 'Пользователь' }; }

async function readBody(request: Request): Promise<Row> {
  try { const body = await request.json(); return body && typeof body === 'object' && !Array.isArray(body) ? body as Row : {}; }
  catch { return {}; }
}

async function getDeal(env: Env, dealId: string): Promise<Row | null> {
  const companyId = requireCompanyId(env as ScopedEnv);
  const rows = await supabase<Row[]>(env, `/crm_deals?select=id,company_id,marketing_lead_id,phone,pipeline_id,stage_id&company_id=eq.${encodeEq(companyId)}&deleted_at=is.null&id=eq.${encodeEq(dealId)}&limit=1`);
  return rows[0] || null;
}

async function getConversations(env: Env, companyId: string, leadId: string | null, phone: string | null): Promise<Row[]> {
  if (leadId) {
    const rows = await supabase<Row[]>(env, `/marketing_conversations?select=id,lead_id,title,phone,channel,status,assigned_user_id,unread_count,last_message_at&company_id=eq.${encodeEq(companyId)}&lead_id=eq.${encodeEq(leadId)}&archived_at=is.null&order=last_message_at.desc.nullslast&limit=20`);
    if (rows.length) return rows;
  }
  if (phone) return supabase<Row[]>(env, `/marketing_conversations?select=id,lead_id,title,phone,channel,status,assigned_user_id,unread_count,last_message_at&company_id=eq.${encodeEq(companyId)}&phone=eq.${encodeEq(phone)}&archived_at=is.null&order=last_message_at.desc.nullslast&limit=20`);
  return [];
}

async function getCalls(env: Env, companyId: string, leadId: string | null, phone: string | null): Promise<Row[]> {
  if (leadId) {
    const rows = await supabase<Row[]>(env, `/marketing_calls?select=id,lead_id,operator_name,client_name,client_phone,channel,call_status,started_at,scheduled_at,duration_seconds,recording_url,summary,call_result,next_action&company_id=eq.${encodeEq(companyId)}&lead_id=eq.${encodeEq(leadId)}&order=started_at.desc&limit=100`);
    if (rows.length) return rows;
  }
  if (phone) return supabase<Row[]>(env, `/marketing_calls?select=id,lead_id,operator_name,client_name,client_phone,channel,call_status,started_at,scheduled_at,duration_seconds,recording_url,summary,call_result,next_action&company_id=eq.${encodeEq(companyId)}&client_phone=eq.${encodeEq(phone)}&order=started_at.desc&limit=100`);
  return [];
}

async function loadWorkspace(env: Env, deal: Row) {
  const companyId = asString(deal.company_id);
  const dealId = asString(deal.id);
  const leadId = asNullableString(deal.marketing_lead_id);
  const phone = asNullableString(deal.phone);
  const conversations = await getConversations(env, companyId, leadId, phone);
  const conversationIds = conversations.map((row) => asString(row.id)).filter(Boolean);
  const [activities, stageEvents, calls, messages] = await Promise.all([
    supabase<Row[]>(env, `/crm_deal_activities?select=id,deal_id,activity_type,body,due_at,completed_at,actor_user_id,created_at,updated_at&company_id=eq.${encodeEq(companyId)}&deal_id=eq.${encodeEq(dealId)}&order=created_at.desc&limit=200`),
    supabase<Row[]>(env, `/crm_deal_stage_events?select=id,deal_id,pipeline_id,from_stage_id,to_stage_id,actor_user_id,reason,created_at&company_id=eq.${encodeEq(companyId)}&deal_id=eq.${encodeEq(dealId)}&order=created_at.desc&limit=200`),
    getCalls(env, companyId, leadId, phone),
    conversationIds.length ? supabase<Row[]>(env, `/marketing_messages?select=id,conversation_id,body,direction,sender_name,status,sent_at,attachment_name,attachment_mime_type&company_id=eq.${encodeEq(companyId)}&conversation_id=in.(${inFilter(conversationIds)})&order=sent_at.desc&limit=200`) : Promise.resolve([]),
  ]);
  const actorIds = Array.from(new Set([
    ...activities.map((row) => asNullableString(row.actor_user_id)),
    ...stageEvents.map((row) => asNullableString(row.actor_user_id)),
    ...conversations.map((row) => asNullableString(row.assigned_user_id)),
  ].filter((value): value is string => Boolean(value))));
  const users = actorIds.length ? await supabase<Row[]>(env, `/marketing_users?select=id,name,full_name&id=in.(${inFilter(actorIds)})`) : [];
  return { activities: activities.map(mapActivity), messages: messages.map(mapMessage), calls: calls.map(mapCall), stageEvents: stageEvents.map(mapStageEvent), conversations: conversations.map(mapConversation), users: users.map(mapUser) };
}

export async function handleDealWorkspace(request: Request, env: Env, url: URL): Promise<Response | null> {
  if (!url.pathname.startsWith('/api/deal-workspace/')) return null;
  const id = requestId(request);
  const match = url.pathname.match(/^\/api\/deal-workspace\/([0-9a-f-]{36})(?:\/activities(?:\/([0-9a-f-]{36}))?)?\/?$/i);
  if (!match) return json(id, { error: 'Маршрут карточки сделки не найден', requestId: id }, 404);
  const dealId = match[1];
  const activityId = match[2] || null;

  try {
    requireCompanyId(env as ScopedEnv);
    const deal = await getDeal(env, dealId);
    if (!deal) return json(id, { error: 'Сделка не найдена в текущей клинике', requestId: id }, 404);
    if (request.method === 'GET' && !activityId) return json(id, await loadWorkspace(env, deal));
    if (!WRITE_ROLES.has(role(request))) return json(id, { error: 'Недостаточно прав для изменения карточки', requestId: id }, 403);

    if (request.method === 'POST' && url.pathname.endsWith('/activities')) {
      const body = await readBody(request);
      const type = asString(body.type) as ActivityType;
      const text = asString(body.body).trim();
      if (!['comment', 'task', 'note'].includes(type)) return json(id, { error: 'Некорректный тип активности', requestId: id }, 400);
      if (!text) return json(id, { error: 'Текст активности обязателен', requestId: id }, 400);
      const rows = await supabase<Row[]>(env, '/crm_deal_activities', {
        method: 'POST', headers: { prefer: 'return=representation' },
        body: JSON.stringify({ company_id: deal.company_id, deal_id: deal.id, activity_type: type, body: text.slice(0, 5000), due_at: type === 'task' ? asNullableString(body.dueAt) : null, actor_user_id: actorId(request) }),
      });
      return json(id, mapActivity(rows[0]), 201);
    }

    if (request.method === 'PATCH' && activityId) {
      const body = await readBody(request);
      const patch: Row = { updated_at: new Date().toISOString() };
      if (typeof body.body === 'string') patch.body = body.body.trim().slice(0, 5000);
      if ('dueAt' in body) patch.due_at = asNullableString(body.dueAt);
      if (body.completed === true) patch.completed_at = new Date().toISOString();
      if (body.completed === false) patch.completed_at = null;
      const rows = await supabase<Row[]>(env, `/crm_deal_activities?id=eq.${encodeEq(activityId)}&deal_id=eq.${encodeEq(dealId)}&company_id=eq.${encodeEq(asString(deal.company_id))}`, { method: 'PATCH', headers: { prefer: 'return=representation' }, body: JSON.stringify(patch) });
      if (!rows[0]) return json(id, { error: 'Активность не найдена', requestId: id }, 404);
      return json(id, mapActivity(rows[0]));
    }

    return json(id, { error: 'Метод не поддерживается', requestId: id }, 405);
  } catch (error) {
    if (error instanceof UpstreamError) return json(id, { error: 'Ошибка источника данных карточки', detail: error.detail, requestId: id }, 502);
    const message = error instanceof Error ? error.message : 'Неизвестная ошибка карточки';
    return json(id, { error: message, requestId: id }, 500);
  }
}
