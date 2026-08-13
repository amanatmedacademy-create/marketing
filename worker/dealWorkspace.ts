import type { Env } from './integrations';
import { requireCompanyId, type TenantScopedEnv } from './tenantScope';

type Row = Record<string, unknown>;
type ScopedEnv = Env & TenantScopedEnv;
type ActivityType = 'comment' | 'task' | 'note';
type CustomFieldType = 'text' | 'textarea' | 'number' | 'date' | 'select' | 'checkbox' | 'phone' | 'email';
type CrmRole = 'administrator' | 'marketer' | 'analyst' | 'viewer';

const ROLE_HEADER = 'x-amanat-auth-role';
const USER_HEADER = 'x-amanat-auth-user';
const WRITE_ROLES = new Set<CrmRole>(['administrator', 'marketer']);
const FIELD_TYPES = new Set<CustomFieldType>(['text', 'textarea', 'number', 'date', 'select', 'checkbox', 'phone', 'email']);
const CRM_ROLES = new Set<CrmRole>(['administrator', 'marketer', 'analyst', 'viewer']);

class UpstreamError extends Error {
  constructor(readonly status: number, readonly detail: string) {
    super(`Supabase request failed with HTTP ${status}`);
  }
}

function requestId(request: Request): string { return request.headers.get('x-correlation-id') || crypto.randomUUID(); }
function json(id: string, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'x-request-id': id } });
}
function role(request: Request): CrmRole {
  const value = (request.headers.get(ROLE_HEADER) || '').trim().toLowerCase() as CrmRole;
  return CRM_ROLES.has(value) ? value : 'viewer';
}
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
function uuidStrings(value: unknown): string[] { return arrayStrings(value).filter((item) => /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(item)); }
function roleStrings(value: unknown, fallback: CrmRole[]): CrmRole[] {
  const result = arrayStrings(value).filter((item): item is CrmRole => CRM_ROLES.has(item as CrmRole));
  return Array.from(new Set((result.length ? result : fallback).concat('administrator')));
}
function isMissing(value: unknown): boolean { return value === null || value === undefined || (typeof value === 'string' && value.trim() === ''); }

function mapActivity(row: Row) { return { id: asString(row.id), dealId: asString(row.deal_id), type: asString(row.activity_type), body: asString(row.body), dueAt: asNullableString(row.due_at), completedAt: asNullableString(row.completed_at), actorUserId: asNullableString(row.actor_user_id), createdAt: asString(row.created_at), updatedAt: asString(row.updated_at) }; }
function mapMessage(row: Row) { return { id: asString(row.id), conversationId: asString(row.conversation_id), body: asString(row.body), direction: asString(row.direction), senderName: asNullableString(row.sender_name), status: asString(row.status), sentAt: asString(row.sent_at), attachmentName: asNullableString(row.attachment_name), attachmentMimeType: asNullableString(row.attachment_mime_type) }; }
function mapCall(row: Row) { return { id: asString(row.id), leadId: asNullableString(row.lead_id), operatorName: asNullableString(row.operator_name) || asNullableString(row.client_name), clientPhone: asNullableString(row.client_phone), channel: asNullableString(row.channel), status: asString(row.call_status), startedAt: asString(row.started_at), scheduledAt: asNullableString(row.scheduled_at), durationSeconds: Number(row.duration_seconds || 0), recordingUrl: asNullableString(row.recording_url), summary: asNullableString(row.summary), result: asNullableString(row.call_result), nextAction: asNullableString(row.next_action) }; }
function mapStageEvent(row: Row) { return { id: asString(row.id), dealId: asString(row.deal_id), pipelineId: asString(row.pipeline_id), fromStageId: asNullableString(row.from_stage_id), toStageId: asString(row.to_stage_id), actorUserId: asNullableString(row.actor_user_id), reason: asNullableString(row.reason), createdAt: asString(row.created_at) }; }
function mapConversation(row: Row) { return { id: asString(row.id), leadId: asNullableString(row.lead_id), title: asNullableString(row.title), phone: asNullableString(row.phone), channel: asString(row.channel), status: asString(row.status), assignedUserId: asNullableString(row.assigned_user_id), unreadCount: Number(row.unread_count || 0), lastMessageAt: asNullableString(row.last_message_at) }; }
function mapUser(row: Row) { return { id: asString(row.id), fullName: asNullableString(row.full_name) || asNullableString(row.name) || 'Пользователь' }; }
function mapSection(row: Row) {
  return { id: asString(row.id), name: asString(row.name), description: asNullableString(row.description), position: numberValue(row.position), active: row.is_active !== false, createdAt: asString(row.created_at), updatedAt: asString(row.updated_at) };
}
function mapCustomField(row: Row, currentRole: CrmRole, typeLocked: boolean) {
  const visibleRoles = roleStrings(row.visible_roles, ['administrator', 'marketer', 'analyst', 'viewer']);
  const editableRoles = roleStrings(row.editable_roles, ['administrator', 'marketer']);
  return {
    id: asString(row.id), key: asString(row.field_key), label: asString(row.label), type: asString(row.field_type) as CustomFieldType,
    options: arrayStrings(row.options), required: bool(row.is_required), active: row.is_active !== false, position: numberValue(row.position),
    sectionId: asNullableString(row.section_id), helpText: asNullableString(row.help_text), visibleRoles, editableRoles,
    requiredStageIds: uuidStrings(row.required_stage_ids), showInSummary: bool(row.show_in_summary), archivedAt: asNullableString(row.archived_at),
    canEditValue: editableRoles.includes(currentRole) && row.is_active !== false && !row.archived_at,
    typeLocked, createdAt: asString(row.created_at), updatedAt: asString(row.updated_at),
  };
}
function mapCustomValue(row: Row): unknown { return row.value === undefined ? null : row.value; }

async function readBody(request: Request): Promise<Row> {
  try { const body = await request.json(); return body && typeof body === 'object' && !Array.isArray(body) ? body as Row : {}; } catch { return {}; }
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
  if (leadId) { const rows = await supabase<Row[]>(env, `/marketing_conversations?select=id,lead_id,title,phone,channel,status,assigned_user_id,unread_count,last_message_at&company_id=eq.${encodeEq(companyId)}&lead_id=eq.${encodeEq(leadId)}&archived_at=is.null&order=last_message_at.desc.nullslast&limit=20`); if (rows.length) return rows; }
  if (phone) return supabase<Row[]>(env, `/marketing_conversations?select=id,lead_id,title,phone,channel,status,assigned_user_id,unread_count,last_message_at&company_id=eq.${encodeEq(companyId)}&phone=eq.${encodeEq(phone)}&archived_at=is.null&order=last_message_at.desc.nullslast&limit=20`);
  return [];
}
async function getCalls(env: Env, companyId: string, leadId: string | null, phone: string | null): Promise<Row[]> {
  if (leadId) { const rows = await supabase<Row[]>(env, `/marketing_calls?select=id,lead_id,operator_name,client_name,client_phone,channel,call_status,started_at,scheduled_at,duration_seconds,recording_url,summary,call_result,next_action&company_id=eq.${encodeEq(companyId)}&lead_id=eq.${encodeEq(leadId)}&order=started_at.desc&limit=100`); if (rows.length) return rows; }
  if (phone) return supabase<Row[]>(env, `/marketing_calls?select=id,lead_id,operator_name,client_name,client_phone,channel,call_status,started_at,scheduled_at,duration_seconds,recording_url,summary,call_result,next_action&company_id=eq.${encodeEq(companyId)}&client_phone=eq.${encodeEq(phone)}&order=started_at.desc&limit=100`);
  return [];
}

async function loadCustomFields(request: Request, env: Env, companyId: string, deal: Row) {
  const currentRole = role(request);
  const canManageFields = await isCompanyAdmin(request, env, companyId);
  const [definitionRows, valueRows, sectionRows, usedRows, stageRows] = await Promise.all([
    supabase<Row[]>(env, `/crm_custom_field_definitions?select=id,field_key,label,field_type,options,is_required,is_active,position,section_id,help_text,visible_roles,editable_roles,required_stage_ids,show_in_summary,archived_at,created_at,updated_at&company_id=eq.${encodeEq(companyId)}&entity_type=eq.deal&order=position.asc,created_at.asc`),
    supabase<Row[]>(env, `/crm_custom_field_values?select=field_id,value&company_id=eq.${encodeEq(companyId)}&deal_id=eq.${encodeEq(asString(deal.id))}`),
    supabase<Row[]>(env, `/crm_custom_field_sections?select=id,name,description,position,is_active,created_at,updated_at&company_id=eq.${encodeEq(companyId)}&entity_type=eq.deal&order=position.asc,created_at.asc`),
    supabase<Row[]>(env, `/crm_custom_field_values?select=field_id&company_id=eq.${encodeEq(companyId)}&limit=10000`),
    asString(deal.pipeline_id) ? supabase<Row[]>(env, `/crm_pipeline_stages?select=id,name,position,stage_type&company_id=eq.${encodeEq(companyId)}&pipeline_id=eq.${encodeEq(asString(deal.pipeline_id))}&order=position.asc`) : Promise.resolve([]),
  ]);
  const valueMap: Record<string, unknown> = {};
  for (const item of valueRows) valueMap[asString(item.field_id)] = mapCustomValue(item);
  const usedIds = new Set(usedRows.map((row) => asString(row.field_id)).filter(Boolean));
  const mapped = definitionRows.map((row) => mapCustomField(row, currentRole, usedIds.has(asString(row.id))));
  const definitions = mapped.filter((field) => canManageFields || (field.active && !field.archivedAt && field.visibleRoles.includes(currentRole)));
  const visibleSectionIds = new Set(definitions.map((field) => field.sectionId).filter(Boolean));
  const sections = sectionRows.map(mapSection).filter((section) => canManageFields || (section.active && visibleSectionIds.has(section.id)));
  const activeVisible = definitions.filter((field) => field.active && !field.archivedAt);
  const required = activeVisible.filter((field) => field.required || field.requiredStageIds.includes(asString(deal.stage_id)));
  const missingRequired = required.filter((field) => isMissing(valueMap[field.id]));
  const filled = activeVisible.filter((field) => !isMissing(valueMap[field.id])).length;
  const completion = activeVisible.length ? Math.round((filled / activeVisible.length) * 100) : 100;
  return {
    definitions, sections, values: valueMap, currentRole, canManageFields, canEditValues: WRITE_ROLES.has(currentRole),
    stages: stageRows.map((row) => ({ id: asString(row.id), name: asString(row.name), position: numberValue(row.position), type: asString(row.stage_type) })),
    quality: { completion, totalFields: activeVisible.length, filledFields: filled, requiredFields: required.length, missingRequiredFieldIds: missingRequired.map((field) => field.id) },
  };
}

async function loadWorkspace(request: Request, env: Env, deal: Row) {
  const companyId = asString(deal.company_id); const dealId = asString(deal.id); const leadId = asNullableString(deal.marketing_lead_id); const phone = asNullableString(deal.phone);
  const conversations = await getConversations(env, companyId, leadId, phone); const conversationIds = conversations.map((row) => asString(row.id)).filter(Boolean);
  const [activities, stageEvents, calls, messages, customFields] = await Promise.all([
    supabase<Row[]>(env, `/crm_deal_activities?select=id,deal_id,activity_type,body,due_at,completed_at,actor_user_id,created_at,updated_at&company_id=eq.${encodeEq(companyId)}&deal_id=eq.${encodeEq(dealId)}&order=created_at.desc&limit=200`),
    supabase<Row[]>(env, `/crm_deal_stage_events?select=id,deal_id,pipeline_id,from_stage_id,to_stage_id,actor_user_id,reason,created_at&company_id=eq.${encodeEq(companyId)}&deal_id=eq.${encodeEq(dealId)}&order=created_at.desc&limit=200`),
    getCalls(env, companyId, leadId, phone),
    conversationIds.length ? supabase<Row[]>(env, `/marketing_messages?select=id,conversation_id,body,direction,sender_name,status,sent_at,attachment_name,attachment_mime_type&company_id=eq.${encodeEq(companyId)}&conversation_id=in.(${inFilter(conversationIds)})&order=sent_at.desc&limit=200`) : Promise.resolve([]),
    loadCustomFields(request, env, companyId, deal),
  ]);
  const actorIds = Array.from(new Set([...activities.map((row) => asNullableString(row.actor_user_id)), ...stageEvents.map((row) => asNullableString(row.actor_user_id)), ...conversations.map((row) => asNullableString(row.assigned_user_id))].filter((value): value is string => Boolean(value))));
  const users = actorIds.length ? await supabase<Row[]>(env, `/marketing_users?select=id,name,full_name&id=in.(${inFilter(actorIds)})`) : [];
  return { activities: activities.map(mapActivity), messages: messages.map(mapMessage), calls: calls.map(mapCall), stageEvents: stageEvents.map(mapStageEvent), conversations: conversations.map(mapConversation), users: users.map(mapUser), customFields };
}

function normalizeCustomValue(definition: Row, raw: unknown): unknown {
  const type = asString(definition.field_type) as CustomFieldType;
  if (raw === null || raw === undefined || raw === '') return null;
  if (type === 'checkbox') return raw === true;
  if (type === 'number') { const value = Number(raw); if (!Number.isFinite(value)) throw new Error(`Поле «${asString(definition.label)}» должно быть числом`); return value; }
  const value = typeof raw === 'string' ? raw.trim() : String(raw);
  if (type === 'date' && value && !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`Поле «${asString(definition.label)}» содержит некорректную дату`);
  if (type === 'email' && value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) throw new Error(`Поле «${asString(definition.label)}» содержит некорректный email`);
  if (type === 'select') { const options = arrayStrings(definition.options); if (!options.includes(value)) throw new Error(`Недопустимое значение поля «${asString(definition.label)}»`); }
  const max = type === 'textarea' ? 5000 : type === 'email' ? 254 : type === 'phone' ? 60 : 500;
  return value.slice(0, max);
}
async function validateSection(env: Env, companyId: string, sectionId: string | null): Promise<string | null> {
  if (!sectionId) return null;
  const rows = await supabase<Row[]>(env, `/crm_custom_field_sections?select=id&company_id=eq.${encodeEq(companyId)}&entity_type=eq.deal&id=eq.${encodeEq(sectionId)}&limit=1`);
  if (!rows[0]) throw new Error('Раздел не принадлежит текущей клинике');
  return sectionId;
}
async function validateStages(env: Env, companyId: string, stageIds: string[]): Promise<string[]> {
  const unique = Array.from(new Set(stageIds));
  if (!unique.length) return [];
  const rows = await supabase<Row[]>(env, `/crm_pipeline_stages?select=id&company_id=eq.${encodeEq(companyId)}&id=in.(${inFilter(unique)})`);
  if (rows.length !== unique.length) throw new Error('Одна из выбранных стадий не принадлежит текущей клинике');
  return unique;
}

async function createCustomField(request: Request, env: Env, deal: Row, id: string): Promise<Response> {
  const companyId = asString(deal.company_id); if (!(await isCompanyAdmin(request, env, companyId))) return json(id, { error: 'Создавать поля может только администратор', requestId: id }, 403);
  const body = await readBody(request); const label = asString(body.label).trim().slice(0, 80); const type = asString(body.type) as CustomFieldType;
  if (!label) return json(id, { error: 'Укажите название поля', requestId: id }, 400); if (!FIELD_TYPES.has(type)) return json(id, { error: 'Некорректный тип поля', requestId: id }, 400);
  const options = type === 'select' ? arrayStrings(body.options).slice(0, 50).map((value) => value.slice(0, 80)) : []; if (type === 'select' && !options.length) return json(id, { error: 'Для списка добавьте хотя бы один вариант', requestId: id }, 400);
  try {
    const sectionId = await validateSection(env, companyId, asNullableString(body.sectionId));
    const requiredStageIds = await validateStages(env, companyId, uuidStrings(body.requiredStageIds));
    const visibleRoles = roleStrings(body.visibleRoles, ['administrator', 'marketer', 'analyst', 'viewer']);
    const editableRoles = roleStrings(body.editableRoles, ['administrator', 'marketer']).filter((item) => visibleRoles.includes(item));
    const existing = await supabase<Row[]>(env, `/crm_custom_field_definitions?select=position&company_id=eq.${encodeEq(companyId)}&entity_type=eq.deal&order=position.desc&limit=1`);
    const baseKey = label.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 32) || 'field'; const fieldKey = `${baseKey}_${crypto.randomUUID().slice(0, 8)}`;
    const rows = await supabase<Row[]>(env, '/crm_custom_field_definitions', { method: 'POST', headers: { prefer: 'return=representation' }, body: JSON.stringify({ company_id: companyId, entity_type: 'deal', field_key: fieldKey, label, field_type: type, options, is_required: body.required === true, is_active: true, position: numberValue(existing[0]?.position) + 10, section_id: sectionId, help_text: asNullableString(body.helpText)?.slice(0, 300) || null, visible_roles: visibleRoles, editable_roles: editableRoles, required_stage_ids: requiredStageIds, show_in_summary: body.showInSummary === true, created_by: actorId(request) }) });
    return json(id, mapCustomField(rows[0], role(request), false), 201);
  } catch (error) { return json(id, { error: error instanceof Error ? error.message : 'Не удалось создать поле', requestId: id }, 400); }
}

async function updateCustomField(request: Request, env: Env, deal: Row, fieldId: string, id: string): Promise<Response> {
  const companyId = asString(deal.company_id); if (!(await isCompanyAdmin(request, env, companyId))) return json(id, { error: 'Настраивать поля может только администратор', requestId: id }, 403);
  const existingRows = await supabase<Row[]>(env, `/crm_custom_field_definitions?select=*&id=eq.${encodeEq(fieldId)}&company_id=eq.${encodeEq(companyId)}&entity_type=eq.deal&limit=1`);
  const existing = existingRows[0]; if (!existing) return json(id, { error: 'Поле не найдено', requestId: id }, 404);
  const body = await readBody(request);
  try {
    if ('type' in body && asString(body.type) && asString(body.type) !== asString(existing.field_type)) throw new Error('Тип поля нельзя менять после создания. Создайте новое поле, чтобы сохранить совместимость данных.');
    const patch: Row = { updated_at: new Date().toISOString() };
    if ('label' in body) { const label = asString(body.label).trim().slice(0, 80); if (!label) throw new Error('Название поля не может быть пустым'); patch.label = label; }
    const fieldType = asString(existing.field_type) as CustomFieldType;
    if ('options' in body) { const options = fieldType === 'select' ? arrayStrings(body.options).slice(0, 50).map((value) => value.slice(0, 80)) : []; if (fieldType === 'select' && !options.length) throw new Error('Для списка добавьте хотя бы один вариант'); patch.options = options; }
    if ('required' in body) patch.is_required = body.required === true;
    if ('active' in body) patch.is_active = body.active === true;
    if ('position' in body) patch.position = Math.max(0, Math.round(numberValue(body.position)));
    if ('sectionId' in body) patch.section_id = await validateSection(env, companyId, asNullableString(body.sectionId));
    if ('helpText' in body) patch.help_text = asNullableString(body.helpText)?.slice(0, 300) || null;
    if ('visibleRoles' in body) patch.visible_roles = roleStrings(body.visibleRoles, ['administrator', 'marketer', 'analyst', 'viewer']);
    if ('editableRoles' in body) {
      const visible = (patch.visible_roles as CrmRole[] | undefined) || roleStrings(existing.visible_roles, ['administrator', 'marketer', 'analyst', 'viewer']);
      patch.editable_roles = roleStrings(body.editableRoles, ['administrator', 'marketer']).filter((item) => visible.includes(item));
    }
    if ('requiredStageIds' in body) patch.required_stage_ids = await validateStages(env, companyId, uuidStrings(body.requiredStageIds));
    if ('showInSummary' in body) patch.show_in_summary = body.showInSummary === true;
    if ('archived' in body) patch.archived_at = body.archived === true ? new Date().toISOString() : null;
    const rows = await supabase<Row[]>(env, `/crm_custom_field_definitions?id=eq.${encodeEq(fieldId)}&company_id=eq.${encodeEq(companyId)}&entity_type=eq.deal`, { method: 'PATCH', headers: { prefer: 'return=representation' }, body: JSON.stringify(patch) });
    const usedRows = await supabase<Row[]>(env, `/crm_custom_field_values?select=field_id&company_id=eq.${encodeEq(companyId)}&field_id=eq.${encodeEq(fieldId)}&limit=1`);
    return json(id, mapCustomField(rows[0], role(request), usedRows.length > 0));
  } catch (error) { return json(id, { error: error instanceof Error ? error.message : 'Некорректные настройки поля', requestId: id }, 400); }
}

async function createSection(request: Request, env: Env, deal: Row, id: string): Promise<Response> {
  const companyId = asString(deal.company_id); if (!(await isCompanyAdmin(request, env, companyId))) return json(id, { error: 'Создавать разделы может только администратор', requestId: id }, 403);
  const body = await readBody(request); const name = asString(body.name).trim().slice(0, 80); if (!name) return json(id, { error: 'Укажите название раздела', requestId: id }, 400);
  const existing = await supabase<Row[]>(env, `/crm_custom_field_sections?select=position&company_id=eq.${encodeEq(companyId)}&entity_type=eq.deal&order=position.desc&limit=1`);
  const rows = await supabase<Row[]>(env, '/crm_custom_field_sections', { method: 'POST', headers: { prefer: 'return=representation' }, body: JSON.stringify({ company_id: companyId, entity_type: 'deal', name, description: asNullableString(body.description)?.slice(0, 300) || null, position: numberValue(existing[0]?.position) + 10, is_active: true, created_by: actorId(request) }) });
  return json(id, mapSection(rows[0]), 201);
}
async function updateSection(request: Request, env: Env, deal: Row, sectionId: string, id: string): Promise<Response> {
  const companyId = asString(deal.company_id); if (!(await isCompanyAdmin(request, env, companyId))) return json(id, { error: 'Настраивать разделы может только администратор', requestId: id }, 403);
  const body = await readBody(request); const patch: Row = { updated_at: new Date().toISOString() };
  if ('name' in body) { const name = asString(body.name).trim().slice(0, 80); if (!name) return json(id, { error: 'Название раздела не может быть пустым', requestId: id }, 400); patch.name = name; }
  if ('description' in body) patch.description = asNullableString(body.description)?.slice(0, 300) || null;
  if ('position' in body) patch.position = Math.max(0, Math.round(numberValue(body.position)));
  if ('active' in body) patch.is_active = body.active === true;
  const rows = await supabase<Row[]>(env, `/crm_custom_field_sections?id=eq.${encodeEq(sectionId)}&company_id=eq.${encodeEq(companyId)}&entity_type=eq.deal`, { method: 'PATCH', headers: { prefer: 'return=representation' }, body: JSON.stringify(patch) });
  if (!rows[0]) return json(id, { error: 'Раздел не найден', requestId: id }, 404);
  return json(id, mapSection(rows[0]));
}

async function saveCustomValues(request: Request, env: Env, deal: Row, id: string): Promise<Response> {
  const currentRole = role(request); if (!WRITE_ROLES.has(currentRole)) return json(id, { error: 'Недостаточно прав для заполнения полей', requestId: id }, 403);
  const companyId = asString(deal.company_id); const dealId = asString(deal.id); const body = await readBody(request); const values = body.values && typeof body.values === 'object' && !Array.isArray(body.values) ? body.values as Row : {};
  const definitions = await supabase<Row[]>(env, `/crm_custom_field_definitions?select=id,label,field_type,options,is_required,editable_roles,is_active,archived_at&company_id=eq.${encodeEq(companyId)}&entity_type=eq.deal&is_active=eq.true&archived_at=is.null`); const definitionMap = new Map(definitions.map((item) => [asString(item.id), item])); const saved: Record<string, unknown> = {};
  for (const [fieldId, raw] of Object.entries(values)) {
    const definition = definitionMap.get(fieldId); if (!definition) continue;
    const editableRoles = roleStrings(definition.editable_roles, ['administrator', 'marketer']);
    if (!editableRoles.includes(currentRole)) return json(id, { error: `Нет прав на изменение поля «${asString(definition.label)}»`, requestId: id }, 403);
    const value = normalizeCustomValue(definition, raw);
    const rows = await supabase<Row[]>(env, `/crm_custom_field_values?on_conflict=company_id,deal_id,field_id`, { method: 'POST', headers: { prefer: 'resolution=merge-duplicates,return=representation' }, body: JSON.stringify({ company_id: companyId, deal_id: dealId, field_id: fieldId, value, updated_by: actorId(request), updated_at: new Date().toISOString() }) }); saved[fieldId] = rows[0]?.value ?? value;
  }
  return json(id, { values: saved });
}

export async function handleDealWorkspace(request: Request, env: Env, url: URL): Promise<Response | null> {
  if (!url.pathname.startsWith('/api/deal-workspace/')) return null;
  const id = requestId(request); const base = url.pathname.match(/^\/api\/deal-workspace\/([0-9a-f-]{36})(?:\/(activities|custom-fields|custom-values|custom-sections)(?:\/([0-9a-f-]{36}))?)?\/?$/i);
  if (!base) return json(id, { error: 'Маршрут карточки сделки не найден', requestId: id }, 404);
  const dealId = base[1]; const resource = base[2] || ''; const resourceId = base[3] || null;
  try {
    requireCompanyId(env as ScopedEnv); const deal = await getDeal(env, dealId); if (!deal) return json(id, { error: 'Сделка не найдена в текущей клинике', requestId: id }, 404);
    if (request.method === 'GET' && !resource) return json(id, await loadWorkspace(request, env, deal));
    if (request.method === 'POST' && resource === 'custom-fields' && !resourceId) return createCustomField(request, env, deal, id);
    if (request.method === 'PATCH' && resource === 'custom-fields' && resourceId) return updateCustomField(request, env, deal, resourceId, id);
    if (request.method === 'POST' && resource === 'custom-sections' && !resourceId) return createSection(request, env, deal, id);
    if (request.method === 'PATCH' && resource === 'custom-sections' && resourceId) return updateSection(request, env, deal, resourceId, id);
    if ((request.method === 'PATCH' || request.method === 'POST') && resource === 'custom-values' && !resourceId) return saveCustomValues(request, env, deal, id);
    if (!WRITE_ROLES.has(role(request))) return json(id, { error: 'Недостаточно прав для изменения карточки', requestId: id }, 403);
    if (request.method === 'POST' && resource === 'activities' && !resourceId) { const body = await readBody(request); const type = asString(body.type) as ActivityType; const text = asString(body.body).trim(); if (!['comment', 'task', 'note'].includes(type)) return json(id, { error: 'Некорректный тип активности', requestId: id }, 400); if (!text) return json(id, { error: 'Текст активности обязателен', requestId: id }, 400); const rows = await supabase<Row[]>(env, '/crm_deal_activities', { method: 'POST', headers: { prefer: 'return=representation' }, body: JSON.stringify({ company_id: deal.company_id, deal_id: deal.id, activity_type: type, body: text.slice(0, 5000), due_at: type === 'task' ? asNullableString(body.dueAt) : null, actor_user_id: actorId(request) }) }); return json(id, mapActivity(rows[0]), 201); }
    if (request.method === 'PATCH' && resource === 'activities' && resourceId) { const body = await readBody(request); const patch: Row = { updated_at: new Date().toISOString() }; if (typeof body.body === 'string') patch.body = body.body.trim().slice(0, 5000); if ('dueAt' in body) patch.due_at = asNullableString(body.dueAt); if (body.completed === true) patch.completed_at = new Date().toISOString(); if (body.completed === false) patch.completed_at = null; const rows = await supabase<Row[]>(env, `/crm_deal_activities?id=eq.${encodeEq(resourceId)}&deal_id=eq.${encodeEq(dealId)}&company_id=eq.${encodeEq(asString(deal.company_id))}`, { method: 'PATCH', headers: { prefer: 'return=representation' }, body: JSON.stringify(patch) }); if (!rows[0]) return json(id, { error: 'Активность не найдена', requestId: id }, 404); return json(id, mapActivity(rows[0])); }
    return json(id, { error: 'Метод не поддерживается', requestId: id }, 405);
  } catch (error) {
    if (error instanceof UpstreamError) return json(id, { error: 'Ошибка источника данных карточки', detail: error.detail, requestId: id }, 502);
    return json(id, { error: error instanceof Error ? error.message : 'Неизвестная ошибка карточки', requestId: id }, 500);
  }
}
