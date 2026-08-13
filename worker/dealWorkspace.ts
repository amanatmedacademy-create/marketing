import type { Env } from './integrations';
import { requireCompanyId, type TenantScopedEnv } from './tenantScope';

type Row = Record<string, unknown>;
type ScopedEnv = Env & TenantScopedEnv;
type ActivityType = 'comment' | 'task' | 'note';
type CustomFieldType = 'text' | 'textarea' | 'number' | 'date' | 'select' | 'checkbox' | 'phone' | 'email';

const ROLE_HEADER = 'x-amanat-auth-role';
const USER_HEADER = 'x-amanat-auth-user';
const WRITE_ROLES = new Set(['administrator', 'marketer']);
const FIELD_TYPES = new Set<CustomFieldType>(['text', 'textarea', 'number', 'date', 'select', 'checkbox', 'phone', 'email']);

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
function bool(value: unknown): boolean { return value === true; }
function numberValue(value: unknown): number { const result = Number(value); return Number.isFinite(result) ? result : 0; }
function arrayStrings(value: unknown): string[] { return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean) : []; }

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
function mapCustomField(row: Row) {
  return {
    id: asString(row.id), key: asString(row.field_key), label: asString(row.label), type: asString(row.field_type) as CustomFieldType,
    options: arrayStrings(row.options), required: bool(row.is_required), active: row.is_active !== false, position: numberValue(row.position),
    createdAt: asString(row.created_at), updatedAt: asString(row.updated_at),
  };
}
function mapCustomValue(row: Row): unknown { return row.value === undefined ? null : row.value; }

async function readBody(request: Request): Promise<Row> {
  try { const body = await request.json(); return body && typeof body === 'object' && !Array.isArray(body) ? body as Row : {}; }
  catch { return {}; }
}

async function getDeal(env: Env, dealId: string): Promise<Row | null> {
  const companyId = requireCompanyId(env as ScopedEnv);
  const rows = await supabase<Row[]>(env, `/crm_deals?select=id,company_id,marketing_lead_id,phone,pipeline_id,stage_id&company_id=eq.${encodeEq(companyId)}&deleted_at=is.null&id=eq.${encodeEq(dealId)}&limit=1`);
  return rows[0] || null;
}

async function isCompanyAdmin(request: Request, env: Env, companyId: string): Promise<boolean> {
  if (role(request) !== 'administrator') return false;
  const userId = actorId(request);
  if (!userId) return false;
  const rows = await supabase<Row[]>(env, `/crm_company_members?select=user_id&company_id=eq.${encodeEq(companyId)}&user_id=eq.${encodeEq(userId)}&status=eq.active&role=in.(owner,administrator)&limit=1`);
  return rows.length > 0;
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

async function loadCustomFields(request: Request, env: Env, companyId: string, dealId: string) {
  const [definitions, values, canManageFields] = await Promise.all([
    supabase<Row[]>(env, `/crm_custom_field_definitions?select=id,field_key,label,field_type,options,is_required,is_active,position,created_at,updated_at&company_id=eq.${encodeEq(companyId)}&entity_type=eq.deal&is_active=eq.true&order=position.asc,created_at.asc`),
    supabase<Row[]>(env, `/crm_custom_field_values?select=field_id,value&company_id=eq.${encodeEq(companyId)}&deal_id=eq.${encodeEq(dealId)}`),
    isCompanyAdmin(request, env, companyId),
  ]);
  const valueMap: Record<string, unknown> = {};
  for (const item of values) valueMap[asString(item.field_id)] = mapCustomValue(item);
  return { definitions: definitions.map(mapCustomField), values: valueMap, canManageFields, canEditValues: WRITE_ROLES.has(role(request)) };
}

async function loadWorkspace(request: Request, env: Env, deal: Row) {
  const companyId = asString(deal.company_id);
  const dealId = asString(deal.id);
  const leadId = asNullableString(deal.marketing_lead_id);
  const phone = asNullableString(deal.phone);
  const conversations = await getConversations(env, companyId, leadId, phone);
  const conversationIds = conversations.map((row) => asString(row.id)).filter(Boolean);
  const [activities, stageEvents, calls, messages, customFields] = await Promise.all([
    supabase<Row[]>(env, `/crm_deal_activities?select=id,deal_id,activity_type,body,due_at,completed_at,actor_user_id,created_at,updated_at&company_id=eq.${encodeEq(companyId)}&deal_id=eq.${encodeEq(dealId)}&order=created_at.desc&limit=200`),
    supabase<Row[]>(env, `/crm_deal_stage_events?select=id,deal_id,pipeline_id,from_stage_id,to_stage_id,actor_user_id,reason,created_at&company_id=eq.${encodeEq(companyId)}&deal_id=eq.${encodeEq(dealId)}&order=created_at.desc&limit=200`),
    getCalls(env, companyId, leadId, phone),
    conversationIds.length ? supabase<Row[]>(env, `/marketing_messages?select=id,conversation_id,body,direction,sender_name,status,sent_at,attachment_name,attachment_mime_type&company_id=eq.${encodeEq(companyId)}&conversation_id=in.(${inFilter(conversationIds)})&order=sent_at.desc&limit=200`) : Promise.resolve([]),
    loadCustomFields(request, env, companyId, dealId),
  ]);
  const actorIds = Array.from(new Set([
    ...activities.map((row) => asNullableString(row.actor_user_id)),
    ...stageEvents.map((row) => asNullableString(row.actor_user_id)),
    ...conversations.map((row) => asNullableString(row.assigned_user_id)),
  ].filter((value): value is string => Boolean(value))));
  const users = actorIds.length ? await supabase<Row[]>(env, `/marketing_users?select=id,name,full_name&id=in.(${inFilter(actorIds)})`) : [];
  return { activities: activities.map(mapActivity), messages: messages.map(mapMessage), calls: calls.map(mapCall), stageEvents: stageEvents.map(mapStageEvent), conversations: conversations.map(mapConversation), users: users.map(mapUser), customFields };
}

function normalizeCustomValue(definition: Row, raw: unknown): unknown {
  const type = asString(definition.field_type) as CustomFieldType;
  if (raw === null || raw === undefined || raw === '') return null;
  if (type === 'checkbox') return raw === true;
  if (type === 'number') {
    const value = Number(raw);
    if (!Number.isFinite(value)) throw new Error(`Поле «${asString(definition.label)}» должно быть числом`);
    return value;
  }
  const value = typeof raw === 'string' ? raw.trim() : String(raw);
  if (type === 'date' && value && !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`Поле «${asString(definition.label)}» содержит некорректную дату`);
  if (type === 'email' && value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) throw new Error(`Поле «${asString(definition.label)}» содержит некорректный email`);
  if (type === 'select') {
    const options = arrayStrings(definition.options);
    if (!options.includes(value)) throw new Error(`Недопустимое значение поля «${asString(definition.label)}»`);
  }
  const max = type === 'textarea' ? 5000 : type === 'email' ? 254 : type === 'phone' ? 60 : 500;
  return value.slice(0, max);
}

async function createCustomField(request: Request, env: Env, deal: Row, id: string): Promise<Response> {
  const companyId = asString(deal.company_id);
  if (!(await isCompanyAdmin(request, env, companyId))) return json(id, { error: 'Создавать поля может только администратор', requestId: id }, 403);
  const body = await readBody(request);
  const label = asString(body.label).trim().slice(0, 80);
  const type = asString(body.type) as CustomFieldType;
  if (!label) return json(id, { error: 'Укажите название поля', requestId: id }, 400);
  if (!FIELD_TYPES.has(type)) return json(id, { error: 'Некорректный тип поля', requestId: id }, 400);
  const options = type === 'select' ? arrayStrings(body.options).slice(0, 50).map((value) => value.slice(0, 80)) : [];
  if (type === 'select' && !options.length) return json(id, { error: 'Для списка добавьте хотя бы один вариант', requestId: id }, 400);
  const existing = await supabase<Row[]>(env, `/crm_custom_field_definitions?select=position&company_id=eq.${encodeEq(companyId)}&entity_type=eq.deal&order=position.desc&limit=1`);
  const baseKey = label.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 32) || 'field';
  const fieldKey = `${baseKey}_${crypto.randomUUID().slice(0, 8)}`;
  const rows = await supabase<Row[]>(env, '/crm_custom_field_definitions', {
    method: 'POST', headers: { prefer: 'return=representation' },
    body: JSON.stringify({ company_id: companyId, entity_type: 'deal', field_key: fieldKey, label, field_type: type, options, is_required: body.required === true, is_active: true, position: numberValue(existing[0]?.position) + 10, created_by: actorId(request) }),
  });
  return json(id, mapCustomField(rows[0]), 201);
}

async function saveCustomValues(request: Request, env: Env, deal: Row, id: string): Promise<Response> {
  if (!WRITE_ROLES.has(role(request))) return json(id, { error: 'Недостаточно прав для заполнения полей', requestId: id }, 403);
  const companyId = asString(deal.company_id);
  const dealId = asString(deal.id);
  const body = await readBody(request);
  const values = body.values && typeof body.values === 'object' && !Array.isArray(body.values) ? body.values as Row : {};
  const definitions = await supabase<Row[]>(env, `/crm_custom_field_definitions?select=id,label,field_type,options,is_required&company_id=eq.${encodeEq(companyId)}&entity_type=eq.deal&is_active=eq.true`);
  const definitionMap = new Map(definitions.map((item) => [asString(item.id), item]));
  const saved: Record<string, unknown> = {};
  for (const [fieldId, raw] of Object.entries(values)) {
    const definition = definitionMap.get(fieldId);
    if (!definition) continue;
    const value = normalizeCustomValue(definition, raw);
    const rows = await supabase<Row[]>(env, `/crm_custom_field_values?on_conflict=company_id,deal_id,field_id`, {
      method: 'POST', headers: { prefer: 'resolution=merge-duplicates,return=representation' },
      body: JSON.stringify({ company_id: companyId, deal_id: dealId, field_id: fieldId, value, updated_by: actorId(request), updated_at: new Date().toISOString() }),
    });
    saved[fieldId] = rows[0]?.value ?? value;
  }
  return json(id, { values: saved });
}

export async function handleDealWorkspace(request: Request, env: Env, url: URL): Promise<Response | null> {
  if (!url.pathname.startsWith('/api/deal-workspace/')) return null;
  const id = requestId(request);
  const base = url.pathname.match(/^\/api\/deal-workspace\/([0-9a-f-]{36})(?:\/(activities|custom-fields|custom-values)(?:\/([0-9a-f-]{36}))?)?\/?$/i);
  if (!base) return json(id, { error: 'Маршрут карточки сделки не найден', requestId: id }, 404);
  const dealId = base[1];
  const resource = base[2] || '';
  const resourceId = base[3] || null;

  try {
    requireCompanyId(env as ScopedEnv);
    const deal = await getDeal(env, dealId);
    if (!deal) return json(id, { error: 'Сделка не найдена в текущей клинике', requestId: id }, 404);
    if (request.method === 'GET' && !resource) return json(id, await loadWorkspace(request, env, deal));
    if (request.method === 'POST' && resource === 'custom-fields' && !resourceId) return createCustomField(request, env, deal, id);
    if ((request.method === 'PATCH' || request.method === 'POST') && resource === 'custom-values' && !resourceId) return saveCustomValues(request, env, deal, id);
    if (!WRITE_ROLES.has(role(request))) return json(id, { error: 'Недостаточно прав для изменения карточки', requestId: id }, 403);

    if (request.method === 'POST' && resource === 'activities' && !resourceId) {
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

    if (request.method === 'PATCH' && resource === 'activities' && resourceId) {
      const body = await readBody(request);
      const patch: Row = { updated_at: new Date().toISOString() };
      if (typeof body.body === 'string') patch.body = body.body.trim().slice(0, 5000);
      if ('dueAt' in body) patch.due_at = asNullableString(body.dueAt);
      if (body.completed === true) patch.completed_at = new Date().toISOString();
      if (body.completed === false) patch.completed_at = null;
      const rows = await supabase<Row[]>(env, `/crm_deal_activities?id=eq.${encodeEq(resourceId)}&deal_id=eq.${encodeEq(dealId)}&company_id=eq.${encodeEq(asString(deal.company_id))}`, { method: 'PATCH', headers: { prefer: 'return=representation' }, body: JSON.stringify(patch) });
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
