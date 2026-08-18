import type { Env } from './integrations';
import { requireCompanyId, type TenantScopedEnv } from './tenantScope';
import { isActiveCompanyUser, listActiveCompanyUsers } from './companyUsers';
import { CrmDataError, crmDataJson } from './crmData';

type Row = Record<string, unknown>;
type ScopedEnv = Env & TenantScopedEnv;
type StageType = 'open' | 'won' | 'lost';
type Priority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';

const ROLE_HEADER = 'x-amanat-auth-role';
const USER_HEADER = 'x-amanat-auth-user';
const WRITE_ROLES = ['administrator', 'marketer'];
const MANAGE_ROLES = ['administrator'];
const PRIORITIES: Priority[] = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'];

const PIPELINE_SELECT = 'id,company_id,name,is_default,position,created_at,updated_at';
const STAGE_SELECT = 'id,company_id,pipeline_id,name,color,position,probability,stage_type,created_at,updated_at';
const DEAL_SELECT = 'id,company_id,pipeline_id,stage_id,contact_id,marketing_lead_id,assignee_id,diagnost_user_id,title,phone,email,source,amount,currency,status,position,priority,description,lost_reason,next_action,next_action_at,stage_entered_at,paid,created_at,updated_at,won_at,lost_at,deleted_at';
const USER_SELECT = 'id,name,full_name,first_name,last_name,role,status';
const CONTACT_SELECT = 'id,name,phone,email,source,first_message,crm_deal_id';
const EVENT_SELECT = 'id,company_id,deal_id,pipeline_id,from_stage_id,to_stage_id,actor_user_id,reason,created_at';

const db = <T>(env: Env, path: string, init: RequestInit = {}) => crmDataJson<T>(env, path, init, 'CRM funnel data request');

function role(request: Request): string { return (request.headers.get(ROLE_HEADER) || '').trim().toLowerCase(); }
function actorId(request: Request): string | null {
  const value = (request.headers.get(USER_HEADER) || '').trim();
  return /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(value) ? value : null;
}
function canWrite(request: Request): boolean { return WRITE_ROLES.includes(role(request)); }
function canManage(request: Request): boolean { return MANAGE_ROLES.includes(role(request)); }
function responseHeaders(requestId: string): HeadersInit { return { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'x-request-id': requestId }; }
function json(requestId: string, body: unknown, status = 200): Response { return new Response(JSON.stringify(body), { status, headers: responseHeaders(requestId) }); }
function text(row: Row, key: string): string { const value = row[key]; return typeof value === 'string' ? value : typeof value === 'number' ? String(value) : ''; }
function optional(row: Row, key: string): string | undefined { const value = text(row, key).trim(); return value || undefined; }
function numberValue(row: Row, key: string): number { const value = row[key]; if (typeof value === 'number' && Number.isFinite(value)) return value; if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value); return 0; }
function bool(row: Row, key: string): boolean { return row[key] === true; }
function nullable(value: unknown, max = 500): string | null { return typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null; }
function isUuid(value: string): boolean { return /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(value); }
function companyId(env: Env): string { return requireCompanyId(env as ScopedEnv); }

function mapStage(row: Row) {
  return { id: text(row, 'id'), pipelineId: text(row, 'pipeline_id'), name: text(row, 'name'), color: text(row, 'color') || '#64748b', position: numberValue(row, 'position'), probability: numberValue(row, 'probability'), stageType: text(row, 'stage_type') as StageType, createdAt: text(row, 'created_at'), updatedAt: text(row, 'updated_at') };
}
function mapPipeline(row: Row, stages: Row[]) {
  return { id: text(row, 'id'), name: text(row, 'name'), isDefault: bool(row, 'is_default'), position: numberValue(row, 'position'), stages: stages.filter((stage) => text(stage, 'pipeline_id') === text(row, 'id')).sort((a, b) => numberValue(a, 'position') - numberValue(b, 'position')).map(mapStage), createdAt: text(row, 'created_at'), updatedAt: text(row, 'updated_at') };
}
function mapDeal(row: Row) {
  return { id: text(row, 'id'), pipelineId: text(row, 'pipeline_id'), stageId: text(row, 'stage_id'), marketingLeadId: optional(row, 'marketing_lead_id'), contactId: optional(row, 'contact_id'), fullName: text(row, 'title'), phone: optional(row, 'phone'), email: optional(row, 'email'), source: optional(row, 'source') || 'Маркетинг', priority: (text(row, 'priority') || 'MEDIUM') as Priority, managerUserId: optional(row, 'assignee_id'), diagnostUserId: optional(row, 'diagnost_user_id'), description: optional(row, 'description'), amount: numberValue(row, 'amount'), currency: text(row, 'currency') || 'KZT', status: text(row, 'status'), position: numberValue(row, 'position'), paid: bool(row, 'paid'), lostReason: optional(row, 'lost_reason'), nextAction: optional(row, 'next_action'), nextActionAt: optional(row, 'next_action_at'), stageEnteredAt: text(row, 'stage_entered_at'), createdAt: text(row, 'created_at'), updatedAt: text(row, 'updated_at'), wonAt: optional(row, 'won_at'), lostAt: optional(row, 'lost_at') };
}
function mapUser(row: Row) { return { id: text(row, 'id'), fullName: optional(row, 'full_name') || text(row, 'name') || [text(row, 'first_name'), text(row, 'last_name')].filter(Boolean).join(' '), role: text(row, 'role') }; }
function mapEvent(row: Row) { return { id: text(row, 'id'), dealId: text(row, 'deal_id'), pipelineId: text(row, 'pipeline_id'), fromStageId: optional(row, 'from_stage_id'), toStageId: text(row, 'to_stage_id'), actorUserId: optional(row, 'actor_user_id'), reason: optional(row, 'reason'), createdAt: text(row, 'created_at') }; }

async function workspace(env: Env, url: URL, requestId: string): Promise<Response> {
  const tenantId = companyId(env);
  const pipelines = await db<Row[]>(env, `crm_pipelines?select=${PIPELINE_SELECT}&company_id=eq.${tenantId}&order=position.asc,created_at.asc&limit=100`);
  const stages = await db<Row[]>(env, `crm_pipeline_stages?select=${STAGE_SELECT}&company_id=eq.${tenantId}&order=pipeline_id.asc,position.asc&limit=1000`);
  const pipelineId = url.searchParams.get('pipelineId') || optional(pipelines.find((item) => bool(item, 'is_default')) || pipelines[0] || {}, 'id') || '';
  const query = (url.searchParams.get('q') || '').trim().slice(0, 120).replace(/[,*()]/g, ' ');
  const managerId = (url.searchParams.get('managerId') || '').trim();
  const diagnostId = (url.searchParams.get('diagnostId') || '').trim();
  const priority = (url.searchParams.get('priority') || '').trim().toUpperCase();
  const stageId = (url.searchParams.get('stageId') || '').trim();
  const params = new URLSearchParams({ select: DEAL_SELECT, company_id: `eq.${tenantId}`, deleted_at: 'is.null', order: 'stage_id.asc,position.asc,updated_at.desc', limit: '2000' });
  if (pipelineId) params.set('pipeline_id', `eq.${pipelineId}`);
  if (managerId) params.set('assignee_id', `eq.${managerId}`);
  if (diagnostId) params.set('diagnost_user_id', `eq.${diagnostId}`);
  if (PRIORITIES.includes(priority as Priority)) params.set('priority', `eq.${priority}`);
  if (stageId) params.set('stage_id', `eq.${stageId}`);
  if (query) params.set('or', `(title.ilike.*${query}*,phone.ilike.*${query}*,email.ilike.*${query}*,source.ilike.*${query}*,description.ilike.*${query}*)`);
  const [deals, users, events] = await Promise.all([
    db<Row[]>(env, `crm_deals?${params.toString()}`),
    listActiveCompanyUsers(env, tenantId, USER_SELECT),
    pipelineId ? db<Row[]>(env, `crm_deal_stage_events?select=${EVENT_SELECT}&company_id=eq.${tenantId}&pipeline_id=eq.${pipelineId}&order=created_at.desc&limit=200`) : Promise.resolve([] as Row[])
  ]);
  const selectedStages = stages.filter((stage) => text(stage, 'pipeline_id') === pipelineId);
  const wonIds = new Set(selectedStages.filter((stage) => text(stage, 'stage_type') === 'won').map((stage) => text(stage, 'id')));
  const lostIds = new Set(selectedStages.filter((stage) => text(stage, 'stage_type') === 'lost').map((stage) => text(stage, 'id')));
  const openDeals = deals.filter((deal) => !wonIds.has(text(deal, 'stage_id')) && !lostIds.has(text(deal, 'stage_id')));
  const wonDeals = deals.filter((deal) => wonIds.has(text(deal, 'stage_id')));
  const lostDeals = deals.filter((deal) => lostIds.has(text(deal, 'stage_id')));
  const weightedAmount = deals.reduce((sum, deal) => { const stage = selectedStages.find((item) => text(item, 'id') === text(deal, 'stage_id')); return sum + numberValue(deal, 'amount') * (numberValue(stage || {}, 'probability') / 100); }, 0);
  const overdue = openDeals.filter((deal) => optional(deal, 'next_action_at') && new Date(text(deal, 'next_action_at')).getTime() < Date.now()).length;
  return json(requestId, { companyId: tenantId, pipelines: pipelines.map((pipeline) => mapPipeline(pipeline, stages)), selectedPipelineId: pipelineId, deals: deals.map(mapDeal), users: users.map(mapUser), events: events.map(mapEvent), stats: { total: deals.length, open: openDeals.length, won: wonDeals.length, lost: lostDeals.length, wonAmount: wonDeals.reduce((sum, deal) => sum + numberValue(deal, 'amount'), 0), weightedAmount, overdue } });
}

async function contacts(env: Env, url: URL, requestId: string): Promise<Response> {
  const tenantId = companyId(env);
  const q = (url.searchParams.get('q') || '').trim().slice(0, 120).replace(/[,*()]/g, ' ');
  const params = new URLSearchParams({ select: CONTACT_SELECT, company_id: `eq.${tenantId}`, order: 'updated_at.desc', limit: '50' });
  if (q) params.set('or', `(name.ilike.*${q}*,phone.ilike.*${q}*,email.ilike.*${q}*)`);
  const rows = await db<Row[]>(env, `marketing_leads?${params.toString()}`);
  return json(requestId, rows.map((row) => ({ id: text(row, 'id'), fullName: text(row, 'name'), phone: optional(row, 'phone'), email: optional(row, 'email'), source: optional(row, 'source'), description: optional(row, 'first_message'), crmDealId: optional(row, 'crm_deal_id') })));
}

async function getPipelineAndStage(env: Env, tenantId: string, pipelineId?: string, stageId?: string): Promise<{ pipelineId: string; stageId: string }> {
  let resolvedPipelineId = pipelineId || '';
  if (!resolvedPipelineId) {
    const rows = await db<Row[]>(env, `crm_pipelines?select=id&company_id=eq.${tenantId}&order=is_default.desc,position.asc&limit=1`);
    resolvedPipelineId = text(rows[0] || {}, 'id');
  } else {
    const rows = await db<Row[]>(env, `crm_pipelines?select=id&company_id=eq.${tenantId}&id=eq.${encodeURIComponent(resolvedPipelineId)}&limit=1`);
    if (!rows[0]) throw new Error('Воронка не принадлежит текущей клинике');
  }
  if (!resolvedPipelineId) throw new Error('Воронка не найдена');
  let resolvedStageId = stageId || '';
  if (!resolvedStageId) {
    const rows = await db<Row[]>(env, `crm_pipeline_stages?select=id&company_id=eq.${tenantId}&pipeline_id=eq.${resolvedPipelineId}&stage_type=eq.open&order=position.asc&limit=1`);
    resolvedStageId = text(rows[0] || {}, 'id');
  } else {
    const rows = await db<Row[]>(env, `crm_pipeline_stages?select=id&company_id=eq.${tenantId}&pipeline_id=eq.${resolvedPipelineId}&id=eq.${encodeURIComponent(resolvedStageId)}&limit=1`);
    if (!rows[0]) throw new Error('Стадия не принадлежит текущей клинике');
  }
  if (!resolvedStageId) throw new Error('Стадия не найдена');
  return { pipelineId: resolvedPipelineId, stageId: resolvedStageId };
}

async function saveDeal(request: Request, env: Env, requestId: string, id?: string): Promise<Response> {
  if (!canWrite(request)) return json(requestId, { error: 'Недостаточно прав для изменения сделок' }, 403);
  const tenantId = companyId(env);
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return json(requestId, { error: 'Тело запроса не распознано' }, 400);
  const current = id ? (await db<Row[]>(env, `crm_deals?select=id,pipeline_id,stage_id,marketing_lead_id&company_id=eq.${tenantId}&id=eq.${encodeURIComponent(id)}&deleted_at=is.null&limit=1`))[0] : null;
  if (id && !current) return json(requestId, { error: 'Сделка не найдена в текущей клинике' }, 404);
  const fullName = nullable(body.fullName, 200);
  if (!id && !fullName) return json(requestId, { error: 'Имя клиента обязательно' }, 400);
  const requestedPipelineId = typeof body.pipelineId === 'string' ? body.pipelineId : optional(current || {}, 'pipeline_id');
  const requestedStageId = typeof body.stageId === 'string' ? body.stageId : optional(current || {}, 'stage_id');
  const pipeline = await getPipelineAndStage(env, tenantId, requestedPipelineId, requestedStageId);
  const priority = typeof body.priority === 'string' && PRIORITIES.includes(body.priority as Priority) ? body.priority : 'MEDIUM';
  const patch: Row = { company_id: tenantId, pipeline_id: pipeline.pipelineId, stage_id: pipeline.stageId, updated_at: new Date().toISOString() };
  if (fullName) patch.title = fullName;
  if (body.phone !== undefined) patch.phone = nullable(body.phone, 60);
  if (body.email !== undefined) patch.email = nullable(body.email, 254);
  if (body.source !== undefined) patch.source = nullable(body.source, 120);
  if (body.description !== undefined) patch.description = nullable(body.description, 3000);
  if (body.priority !== undefined || !id) patch.priority = priority;
  if (body.managerUserId !== undefined) { const managerId = typeof body.managerUserId === 'string' && isUuid(body.managerUserId) ? body.managerUserId : null; if (managerId && !await isActiveCompanyUser(env, tenantId, managerId)) return json(requestId, { error: 'Менеджер не принадлежит текущей клинике' }, 400); patch.assignee_id = managerId; }
  if (body.diagnostUserId !== undefined) { const diagnostId = typeof body.diagnostUserId === 'string' && isUuid(body.diagnostUserId) ? body.diagnostUserId : null; if (diagnostId && !await isActiveCompanyUser(env, tenantId, diagnostId)) return json(requestId, { error: 'Диагност не принадлежит текущей клинике' }, 400); patch.diagnost_user_id = diagnostId; }
  if (body.marketingLeadId !== undefined) {
    if (typeof body.marketingLeadId === 'string' && isUuid(body.marketingLeadId)) {
      const leads = await db<Row[]>(env, `marketing_leads?select=id&company_id=eq.${tenantId}&id=eq.${encodeURIComponent(body.marketingLeadId)}&limit=1`);
      if (!leads[0]) return json(requestId, { error: 'Лид не принадлежит текущей клинике' }, 400);
      patch.marketing_lead_id = body.marketingLeadId;
    } else patch.marketing_lead_id = null;
  }
  if (body.amount !== undefined) { const amount = Number(body.amount); if (!Number.isFinite(amount) || amount < 0) return json(requestId, { error: 'Некорректная сумма' }, 400); patch.amount = amount; }
  if (body.paid !== undefined) patch.paid = body.paid === true;
  if (body.lostReason !== undefined) patch.lost_reason = nullable(body.lostReason, 1000);
  if (body.nextAction !== undefined) patch.next_action = nullable(body.nextAction, 1000);
  if (body.nextActionAt !== undefined) patch.next_action_at = nullable(body.nextActionAt, 80);
  if (!id) { patch.position = Date.now(); patch.currency = 'KZT'; patch.created_by = actorId(request); patch.created_at = new Date().toISOString(); }
  const path = id ? `crm_deals?id=eq.${encodeURIComponent(id)}&company_id=eq.${tenantId}&deleted_at=is.null&select=${DEAL_SELECT}` : `crm_deals?select=${DEAL_SELECT}`;
  const rows = await db<Row[]>(env, path, { method: id ? 'PATCH' : 'POST', body: JSON.stringify(patch) });
  if (!rows[0]) return json(requestId, { error: id ? 'Сделка не обновлена' : 'Сделка не создана' }, 502);
  const dealId = text(rows[0], 'id');
  const previousLeadId = optional(current || {}, 'marketing_lead_id');
  const nextLeadId = typeof patch.marketing_lead_id === 'string' ? patch.marketing_lead_id : body.marketingLeadId === undefined ? previousLeadId : undefined;
  if (previousLeadId && previousLeadId !== nextLeadId) await db<Row[]>(env, `marketing_leads?id=eq.${previousLeadId}&company_id=eq.${tenantId}&crm_deal_id=eq.${dealId}`, { method: 'PATCH', body: JSON.stringify({ crm_deal_id: null, updated_at: new Date().toISOString() }) });
  if (nextLeadId) await db<Row[]>(env, `marketing_leads?id=eq.${nextLeadId}&company_id=eq.${tenantId}`, { method: 'PATCH', body: JSON.stringify({ crm_deal_id: dealId, updated_at: new Date().toISOString() }) });
  return json(requestId, mapDeal(rows[0]), id ? 200 : 201);
}

async function moveDeal(request: Request, env: Env, requestId: string, id: string): Promise<Response> {
  if (!canWrite(request)) return json(requestId, { error: 'Недостаточно прав для перемещения сделки' }, 403);
  const tenantId = companyId(env);
  const body = await request.json().catch(() => null) as { pipelineId?: string; stageId?: string; position?: number; reason?: string } | null;
  if (!body?.pipelineId || !body.stageId || !isUuid(body.pipelineId) || !isUuid(body.stageId)) return json(requestId, { error: 'Не указана целевая воронка или стадия' }, 400);
  const existing = await db<Row[]>(env, `crm_deals?select=id&company_id=eq.${tenantId}&id=eq.${encodeURIComponent(id)}&deleted_at=is.null&limit=1`);
  if (!existing[0]) return json(requestId, { error: 'Сделка не найдена в текущей клинике' }, 404);
  await getPipelineAndStage(env, tenantId, body.pipelineId, body.stageId);
  const rows = await db<Row[] | Row>(env, 'rpc/crm_move_deal', { method: 'POST', body: JSON.stringify({ deal_id_value: id, pipeline_id_value: body.pipelineId, stage_id_value: body.stageId, position_value: Number.isFinite(body.position) ? body.position : null, reason_value: nullable(body.reason, 1000), actor_user_id_value: actorId(request) }) });
  const row = Array.isArray(rows) ? rows[0] : rows;
  if (!row || text(row, 'company_id') !== tenantId) return json(requestId, { error: 'Сделка не перемещена' }, 502);
  return json(requestId, mapDeal(row));
}

async function createPipeline(request: Request, env: Env, requestId: string): Promise<Response> {
  if (!canManage(request)) return json(requestId, { error: 'Управление воронками доступно администратору' }, 403);
  const tenantId = companyId(env);
  const body = await request.json().catch(() => null) as { name?: string; isDefault?: boolean } | null;
  const name = nullable(body?.name, 120);
  if (!name) return json(requestId, { error: 'Название воронки обязательно' }, 400);
  if (body?.isDefault) await db<Row[]>(env, `crm_pipelines?company_id=eq.${tenantId}&is_default=eq.true`, { method: 'PATCH', body: JSON.stringify({ is_default: false, updated_at: new Date().toISOString() }) });
  const rows = await db<Row[]>(env, `crm_pipelines?select=${PIPELINE_SELECT}`, { method: 'POST', body: JSON.stringify({ company_id: tenantId, name, is_default: body?.isDefault === true, position: Date.now(), created_at: new Date().toISOString(), updated_at: new Date().toISOString() }) });
  const pipeline = rows[0];
  if (!pipeline) return json(requestId, { error: 'Воронка не создана' }, 502);
  const defaults = [
    { name: 'Новый лид', color: '#3b82f6', position: 100, probability: 10, stage_type: 'open' },
    { name: 'В работе', color: '#8b5cf6', position: 200, probability: 30, stage_type: 'open' },
    { name: 'Оплата', color: '#22c55e', position: 300, probability: 100, stage_type: 'won' },
    { name: 'Отказ', color: '#ef4444', position: 400, probability: 0, stage_type: 'lost' }
  ].map((stage) => ({ ...stage, company_id: tenantId, pipeline_id: text(pipeline, 'id') }));
  const stages = await db<Row[]>(env, `crm_pipeline_stages?select=${STAGE_SELECT}`, { method: 'POST', body: JSON.stringify(defaults) });
  return json(requestId, mapPipeline(pipeline, stages), 201);
}

async function updatePipeline(request: Request, env: Env, requestId: string, id: string): Promise<Response> {
  if (!canManage(request)) return json(requestId, { error: 'Управление воронками доступно администратору' }, 403);
  const tenantId = companyId(env);
  const body = await request.json().catch(() => null) as { name?: string; isDefault?: boolean; position?: number } | null;
  if (!body) return json(requestId, { error: 'Тело запроса не распознано' }, 400);
  const patch: Row = { updated_at: new Date().toISOString() };
  if (body.name !== undefined) { const name = nullable(body.name, 120); if (!name) return json(requestId, { error: 'Название обязательно' }, 400); patch.name = name; }
  if (body.position !== undefined) patch.position = Math.max(0, Math.trunc(body.position));
  if (body.isDefault === true) { await db<Row[]>(env, `crm_pipelines?company_id=eq.${tenantId}&is_default=eq.true&id=neq.${id}`, { method: 'PATCH', body: JSON.stringify({ is_default: false, updated_at: new Date().toISOString() }) }); patch.is_default = true; }
  const rows = await db<Row[]>(env, `crm_pipelines?id=eq.${id}&company_id=eq.${tenantId}&select=${PIPELINE_SELECT}`, { method: 'PATCH', body: JSON.stringify(patch) });
  return rows[0] ? json(requestId, mapPipeline(rows[0], [])) : json(requestId, { error: 'Воронка не обновлена' }, 404);
}

async function deletePipeline(request: Request, env: Env, requestId: string, id: string): Promise<Response> {
  if (!canManage(request)) return json(requestId, { error: 'Управление воронками доступно администратору' }, 403);
  const tenantId = companyId(env);
  const deals = await db<Row[]>(env, `crm_deals?select=id&company_id=eq.${tenantId}&pipeline_id=eq.${id}&deleted_at=is.null&limit=1`);
  if (deals.length) return json(requestId, { error: 'Нельзя удалить воронку со сделками. Сначала перенесите сделки.' }, 409);
  const pipelines = await db<Row[]>(env, `crm_pipelines?select=id&company_id=eq.${tenantId}&limit=2`);
  if (pipelines.length <= 1) return json(requestId, { error: 'Нельзя удалить единственную воронку' }, 409);
  await db<void>(env, `crm_pipelines?id=eq.${id}&company_id=eq.${tenantId}`, { method: 'DELETE' });
  return new Response(null, { status: 204, headers: responseHeaders(requestId) });
}

async function createStage(request: Request, env: Env, requestId: string): Promise<Response> {
  if (!canManage(request)) return json(requestId, { error: 'Управление стадиями доступно администратору' }, 403);
  const tenantId = companyId(env);
  const body = await request.json().catch(() => null) as { pipelineId?: string; name?: string; color?: string; probability?: number; stageType?: StageType; afterStageId?: string } | null;
  const name = nullable(body?.name, 120);
  if (!body?.pipelineId || !isUuid(body.pipelineId) || !name) return json(requestId, { error: 'Воронка и название стадии обязательны' }, 400);
  const pipelineRows = await db<Row[]>(env, `crm_pipelines?select=id&company_id=eq.${tenantId}&id=eq.${encodeURIComponent(body.pipelineId)}&limit=1`);
  if (!pipelineRows[0]) return json(requestId, { error: 'Воронка не принадлежит текущей клинике' }, 400);
  const type: StageType = ['open', 'won', 'lost'].includes(body.stageType || '') ? body.stageType as StageType : 'open';
  const stages = await db<Row[]>(env, `crm_pipeline_stages?select=${STAGE_SELECT}&company_id=eq.${tenantId}&pipeline_id=eq.${body.pipelineId}&order=position.asc`);
  const afterIndex = body.afterStageId ? stages.findIndex((item) => text(item, 'id') === body.afterStageId) : stages.length - 1;
  const next = stages[afterIndex + 1];
  const previousPosition = afterIndex >= 0 ? numberValue(stages[afterIndex], 'position') : 0;
  const position = next ? Math.floor((previousPosition + numberValue(next, 'position')) / 2) : previousPosition + 100;
  if (next && position === previousPosition) for (let index = 0; index < stages.length; index += 1) await db<Row[]>(env, `crm_pipeline_stages?id=eq.${text(stages[index], 'id')}&company_id=eq.${tenantId}`, { method: 'PATCH', body: JSON.stringify({ position: (index + 1) * 100 }) });
  const rows = await db<Row[]>(env, `crm_pipeline_stages?select=${STAGE_SELECT}`, { method: 'POST', body: JSON.stringify({ company_id: tenantId, pipeline_id: body.pipelineId, name, color: typeof body.color === 'string' && /^#[0-9a-f]{6}$/i.test(body.color) ? body.color : '#64748b', position: next && position === previousPosition ? (afterIndex + 2) * 100 - 50 : position, probability: Math.max(0, Math.min(100, Math.trunc(Number(body.probability) || 0))), stage_type: type }) });
  return rows[0] ? json(requestId, mapStage(rows[0]), 201) : json(requestId, { error: 'Стадия не создана' }, 502);
}

async function updateStage(request: Request, env: Env, requestId: string, id: string): Promise<Response> {
  if (!canManage(request)) return json(requestId, { error: 'Управление стадиями доступно администратору' }, 403);
  const tenantId = companyId(env);
  const body = await request.json().catch(() => null) as { name?: string; color?: string; probability?: number; stageType?: StageType; position?: number } | null;
  if (!body) return json(requestId, { error: 'Тело запроса не распознано' }, 400);
  const patch: Row = { updated_at: new Date().toISOString() };
  if (body.name !== undefined) { const name = nullable(body.name, 120); if (!name) return json(requestId, { error: 'Название обязательно' }, 400); patch.name = name; }
  if (body.color !== undefined) { if (!/^#[0-9a-f]{6}$/i.test(body.color)) return json(requestId, { error: 'Некорректный цвет' }, 400); patch.color = body.color; }
  if (body.probability !== undefined) patch.probability = Math.max(0, Math.min(100, Math.trunc(body.probability)));
  if (body.stageType !== undefined) { if (!['open', 'won', 'lost'].includes(body.stageType)) return json(requestId, { error: 'Некорректный тип стадии' }, 400); patch.stage_type = body.stageType; }
  if (body.position !== undefined) patch.position = Math.max(0, Math.trunc(body.position));
  const rows = await db<Row[]>(env, `crm_pipeline_stages?id=eq.${id}&company_id=eq.${tenantId}&select=${STAGE_SELECT}`, { method: 'PATCH', body: JSON.stringify(patch) });
  return rows[0] ? json(requestId, mapStage(rows[0])) : json(requestId, { error: 'Стадия не обновлена' }, 404);
}

async function deleteStage(request: Request, env: Env, requestId: string, id: string): Promise<Response> {
  if (!canManage(request)) return json(requestId, { error: 'Управление стадиями доступно администратору' }, 403);
  const tenantId = companyId(env);
  const deals = await db<Row[]>(env, `crm_deals?select=id&company_id=eq.${tenantId}&stage_id=eq.${id}&deleted_at=is.null&limit=1`);
  if (deals.length) return json(requestId, { error: 'Нельзя удалить стадию со сделками. Сначала перенесите карточки.' }, 409);
  const stageRows = await db<Row[]>(env, `crm_pipeline_stages?select=pipeline_id&company_id=eq.${tenantId}&id=eq.${id}&limit=1`);
  if (!stageRows[0]) return json(requestId, { error: 'Стадия не найдена' }, 404);
  const siblings = await db<Row[]>(env, `crm_pipeline_stages?select=id&company_id=eq.${tenantId}&pipeline_id=eq.${text(stageRows[0], 'pipeline_id')}&limit=2`);
  if (siblings.length <= 1) return json(requestId, { error: 'В воронке должна остаться хотя бы одна стадия' }, 409);
  await db<void>(env, `crm_pipeline_stages?id=eq.${id}&company_id=eq.${tenantId}`, { method: 'DELETE' });
  return new Response(null, { status: 204, headers: responseHeaders(requestId) });
}

export async function handleSalesFunnelV2(request: Request, env: Env, url: URL): Promise<Response | null> {
  const path = url.pathname.replace(/\/+$/, '') || '/';
  if (!path.startsWith('/api/funnel/')) return null;
  const requestId = crypto.randomUUID();
  try {
    companyId(env);
    if (request.method === 'GET' && path === '/api/funnel/workspace') return workspace(env, url, requestId);
    if (request.method === 'GET' && path === '/api/funnel/contacts') return contacts(env, url, requestId);
    if (request.method === 'POST' && path === '/api/funnel/leads') return saveDeal(request, env, requestId);
    const lead = path.match(/^\/api\/funnel\/leads\/([0-9a-f-]+)$/i);
    if (request.method === 'PATCH' && lead) return saveDeal(request, env, requestId, lead[1]);
    const move = path.match(/^\/api\/funnel\/leads\/([0-9a-f-]+)\/move$/i);
    if (request.method === 'POST' && move) return moveDeal(request, env, requestId, move[1]);
    if (request.method === 'POST' && path === '/api/funnel/pipelines') return createPipeline(request, env, requestId);
    const pipeline = path.match(/^\/api\/funnel\/pipelines\/([0-9a-f-]+)$/i);
    if (request.method === 'PATCH' && pipeline) return updatePipeline(request, env, requestId, pipeline[1]);
    if (request.method === 'DELETE' && pipeline) return deletePipeline(request, env, requestId, pipeline[1]);
    if (request.method === 'POST' && path === '/api/funnel/stages') return createStage(request, env, requestId);
    const stage = path.match(/^\/api\/funnel\/stages\/([0-9a-f-]+)$/i);
    if (request.method === 'PATCH' && stage) return updateStage(request, env, requestId, stage[1]);
    if (request.method === 'DELETE' && stage) return deleteStage(request, env, requestId, stage[1]);
    return json(requestId, { error: 'Маршрут воронки не найден' }, 404);
  } catch (error) {
    if (error instanceof CrmDataError) {
      console.error('CRM funnel data error', error.status, error.detail);
      return json(requestId, { error: error.status === 409 ? 'Конфликт данных воронки' : 'Ошибка локальной базы данных CRM', requestId }, error.status >= 400 && error.status < 500 ? error.status : 502);
    }
    console.error('Sales funnel error', error);
    return json(requestId, { error: error instanceof Error ? error.message : 'Ошибка воронки продаж', requestId }, 500);
  }
}
