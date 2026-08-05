import type { Env } from './integrations';

// Воронка Продаж: порт CRM-модуля (РОП workspace) из МИС.
// Данные: sales_funnel_leads / sales_funnel_activities / sales_funnel_boards.
// Контакты — marketing_leads, сотрудники — marketing_users.

type Row = Record<string, unknown>;
type LeadStage = 'NEW' | 'QUALIFICATION' | 'APPOINTMENT' | 'DIAGNOSTIC' | 'COURSE' | 'LOST';
type LeadPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
type LeadAction = 'WHATSAPP' | 'BOOK' | 'COURSE' | 'LOST' | 'RESTORE';

type LeadInput = {
  contactId?: string | null;
  fullName?: string;
  phone?: string | null;
  diagnosis?: string | null;
  source?: string;
  priority?: LeadPriority;
  stage?: LeadStage;
  diagnostUserId?: string | null;
  managerUserId?: string | null;
  amount?: number;
  paid?: boolean;
  lostReason?: string | null;
};

type FilterInput = {
  query: string;
  managerId: string;
  diagnostId: string;
  priority: LeadPriority | '';
  stage: LeadStage | '';
};

type PageCursor = { updatedAt: string; id: string };

type FunnelStats = {
  total: number;
  open: number;
  won: number;
  lost: number;
  courseAmount: number;
  byStage: Record<LeadStage, number>;
};

type BoardColumnInput = {
  stage?: LeadStage;
  title?: string;
  subtitle?: string;
  color?: string;
  wipLimit?: number;
  visible?: boolean;
};

type BoardFiltersInput = {
  sources?: string[];
  priorities?: LeadPriority[];
  diagnostUserIds?: string[];
  managerUserIds?: string[];
};

type BoardInput = {
  name?: string;
  description?: string | null;
  columns?: BoardColumnInput[];
  filters?: BoardFiltersInput;
  showTotals?: boolean;
  isDefault?: boolean;
  sortOrder?: number;
};

const ROLE_HEADER = 'x-amanat-auth-role';
const USER_HEADER = 'x-amanat-auth-user';
const WRITE_ROLES = ['administrator', 'marketer'];

const STAGES: LeadStage[] = ['NEW', 'QUALIFICATION', 'APPOINTMENT', 'DIAGNOSTIC', 'COURSE', 'LOST'];
const PRIORITIES: LeadPriority[] = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'];
const LEAD_SELECT = 'id,contact_id,full_name,phone,diagnosis,source,priority,stage,diagnost_user_id,manager_user_id,amount,paid,whatsapp_count,lost_reason,created_at,updated_at,closed_at';
const ACTIVITY_SELECT = 'id,lead_id,type,title,details,actor_user_id,created_at';
const CONTACT_SELECT = 'id,name,phone,first_message,source';
const BOARD_SELECT = 'id,name,description,columns,filters,show_totals,is_default,is_active,sort_order,created_at,updated_at';
const DEFAULT_SOURCE = 'Маркетинг';
const DEFAULT_LIMIT = 500;
const MAX_LIMIT = 1000;
const CONTACT_RESULT_LIMIT = 50;
const CURSOR_SEPARATOR = '~';

const DEFAULT_COLUMNS = [
  { stage: 'NEW', title: 'Новые', subtitle: 'Первичный контакт', color: '#2196f3', wipLimit: 0, visible: true },
  { stage: 'QUALIFICATION', title: 'Квалификация', subtitle: 'Диагност + ТМ', color: '#8b5cf6', wipLimit: 0, visible: true },
  { stage: 'APPOINTMENT', title: 'Запись', subtitle: 'Назначена консультация', color: '#f59e0b', wipLimit: 0, visible: true },
  { stage: 'DIAGNOSTIC', title: 'Диагностика', subtitle: 'Осмотр и решение', color: '#14b8a6', wipLimit: 0, visible: true },
  { stage: 'COURSE', title: 'Курс оплачен', subtitle: 'Продажа завершена', color: '#22c55e', wipLimit: 0, visible: true },
  { stage: 'LOST', title: 'Потеряны', subtitle: 'Отказ / не дозвонились', color: '#ef4444', wipLimit: 0, visible: true }
] satisfies Array<Required<BoardColumnInput>>;

class FunnelUpstreamError extends Error {
  constructor(readonly status: number, readonly detail: string) {
    super(`Supabase request failed with HTTP ${status}`);
  }
}

const stringValue = (row: Row, key: string) => {
  const value = row[key];
  return typeof value === 'string' ? value : typeof value === 'number' && Number.isFinite(value) ? String(value) : '';
};
const optionalString = (row: Row, key: string) => {
  const value = stringValue(row, key).trim();
  return value || undefined;
};
const numberValue = (row: Row, key: string) => {
  const value = row[key];
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return 0;
};

const isUuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

function requestRole(request: Request): string {
  return (request.headers.get(ROLE_HEADER) || '').trim().toLowerCase();
}

function requestActorId(request: Request): string | null {
  const value = (request.headers.get(USER_HEADER) || '').trim();
  return isUuid(value) ? value : null;
}

function canWrite(request: Request): boolean {
  return WRITE_ROLES.includes(requestRole(request));
}

function responseHeaders(requestId: string, timing?: string): HeadersInit {
  const headers: Record<string, string> = {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'x-request-id': requestId
  };
  if (timing) headers['server-timing'] = timing;
  return headers;
}

function json(requestId: string, value: unknown, status = 200, timing?: string): Response {
  return new Response(JSON.stringify(value), { status, headers: responseHeaders(requestId, timing) });
}

async function readLimited(response: Response, limit = 4096): Promise<string> {
  const text = await response.text().catch(() => '');
  return text.slice(0, limit);
}

function databaseHeaders(env: Env, init: RequestInit): Headers {
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error('Supabase server key is missing');
  const headers = new Headers(init.headers);
  headers.set('apikey', key);
  if (!key.startsWith('sb_secret_')) headers.set('Authorization', `Bearer ${key}`);
  headers.set('Accept', 'application/json');
  if (init.body != null) headers.set('Content-Type', 'application/json');
  if (init.method && !['GET', 'HEAD'].includes(init.method) && !headers.has('Prefer')) headers.set('Prefer', 'return=representation');
  return headers;
}

async function db<T>(env: Env, path: string, init: RequestInit = {}): Promise<T> {
  const headers = databaseHeaders(env, init);
  const response = await fetch(`${env.SUPABASE_URL.replace(/\/+$/, '')}/rest/v1${path}`, { ...init, headers, cache: 'no-store' });
  if (!response.ok) throw new FunnelUpstreamError(response.status, await readLimited(response));
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

async function dbPage<T>(env: Env, path: string): Promise<{ rows: T[]; total: number }> {
  const headers = databaseHeaders(env, { headers: { Prefer: 'count=exact' } });
  const response = await fetch(`${env.SUPABASE_URL.replace(/\/+$/, '')}/rest/v1${path}`, { headers, cache: 'no-store' });
  if (!response.ok) throw new FunnelUpstreamError(response.status, await readLimited(response));
  const rows = await response.json() as T[];
  const range = response.headers.get('Content-Range') || '';
  const match = range.match(/\/(\d+|\*)$/);
  const parsed = match && match[1] !== '*' ? Number(match[1]) : rows.length;
  return { rows, total: Number.isFinite(parsed) ? parsed : rows.length };
}

function cleanNullable(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function mapLead(row: Row) {
  return {
    id: stringValue(row, 'id'),
    contactId: optionalString(row, 'contact_id'),
    fullName: stringValue(row, 'full_name'),
    phone: optionalString(row, 'phone'),
    diagnosis: optionalString(row, 'diagnosis'),
    source: stringValue(row, 'source'),
    priority: stringValue(row, 'priority') as LeadPriority,
    stage: stringValue(row, 'stage') as LeadStage,
    diagnostUserId: optionalString(row, 'diagnost_user_id'),
    managerUserId: optionalString(row, 'manager_user_id'),
    amount: numberValue(row, 'amount'),
    paid: row.paid === true,
    whatsappCount: numberValue(row, 'whatsapp_count'),
    lostReason: optionalString(row, 'lost_reason'),
    createdAt: stringValue(row, 'created_at'),
    updatedAt: stringValue(row, 'updated_at'),
    closedAt: optionalString(row, 'closed_at')
  };
}

function mapActivity(row: Row) {
  return {
    id: stringValue(row, 'id'),
    leadId: stringValue(row, 'lead_id'),
    type: stringValue(row, 'type'),
    title: stringValue(row, 'title'),
    details: row.details && typeof row.details === 'object' ? row.details : {},
    actorUserId: optionalString(row, 'actor_user_id'),
    createdAt: stringValue(row, 'created_at')
  };
}

function mapContact(row: Row) {
  return {
    id: stringValue(row, 'id'),
    fullName: stringValue(row, 'name'),
    phone: optionalString(row, 'phone'),
    diagnosis: optionalString(row, 'first_message') || optionalString(row, 'source')
  };
}

function mapUser(row: Row) {
  return {
    id: stringValue(row, 'id'),
    fullName: stringValue(row, 'name'),
    role: stringValue(row, 'role'),
    position: undefined as string | undefined
  };
}

async function ensureUser(env: Env, id?: string | null): Promise<boolean> {
  if (!id) return true;
  if (!isUuid(id)) return false;
  const rows = await db<Row[]>(env, `/marketing_users?select=id&id=eq.${encodeURIComponent(id)}&status=eq.active&limit=1`);
  return rows.length > 0;
}

async function ensureContact(env: Env, id?: string | null): Promise<Row | null> {
  if (!id) return null;
  if (!isUuid(id)) return null;
  const rows = await db<Row[]>(env, `/marketing_leads?select=${CONTACT_SELECT}&id=eq.${encodeURIComponent(id)}&limit=1`);
  return rows[0] || null;
}

async function ensureLead(env: Env, id: string): Promise<Row | null> {
  const rows = await db<Row[]>(env, `/sales_funnel_leads?select=${LEAD_SELECT}&id=eq.${encodeURIComponent(id)}&limit=1`);
  return rows[0] || null;
}

async function logActivity(env: Env, leadId: string, type: string, title: string, details: Row = {}, actorUserId?: string | null): Promise<void> {
  await db<Row[]>(env, '/sales_funnel_activities?select=id', {
    method: 'POST',
    body: JSON.stringify({
      id: `funnel_activity_${crypto.randomUUID()}`,
      lead_id: leadId,
      type,
      title,
      details,
      actor_user_id: actorUserId || null,
      created_at: new Date().toISOString()
    })
  });
}

function validateOwners(stage: LeadStage, diagnostUserId?: string | null, managerUserId?: string | null): boolean {
  return stage === 'NEW' || stage === 'LOST' || Boolean(diagnostUserId && managerUserId);
}

// ---------------------------------------------------------------------------
// Workspace (чтение с keyset-пагинацией и серверными фильтрами)
// ---------------------------------------------------------------------------

function parseInteger(value: string | null, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function parseCursor(value: string | null): PageCursor | null {
  if (!value) return null;
  const separator = value.indexOf(CURSOR_SEPARATOR);
  if (separator <= 0) return null;
  const date = new Date(value.slice(0, separator));
  const id = value.slice(separator + 1).trim().slice(0, 240).replace(/[,*()]/g, '');
  return Number.isFinite(date.getTime()) && id ? { updatedAt: date.toISOString(), id } : null;
}

function cursorValue(row: Row): string | null {
  const updatedAt = stringValue(row, 'updated_at');
  const id = stringValue(row, 'id');
  return updatedAt && id ? `${updatedAt}${CURSOR_SEPARATOR}${id}` : null;
}

function emptyStats(): FunnelStats {
  return { total: 0, open: 0, won: 0, lost: 0, courseAmount: 0, byStage: { NEW: 0, QUALIFICATION: 0, APPOINTMENT: 0, DIAGNOSTIC: 0, COURSE: 0, LOST: 0 } };
}

function normalizeStats(value: unknown): FunnelStats {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw || typeof raw !== 'object') return emptyStats();
  const row = raw as Row;
  const byStageRaw = row.byStage && typeof row.byStage === 'object' ? row.byStage as Row : {};
  return {
    total: numberValue(row, 'total'),
    open: numberValue(row, 'open'),
    won: numberValue(row, 'won'),
    lost: numberValue(row, 'lost'),
    courseAmount: numberValue(row, 'courseAmount'),
    byStage: {
      NEW: numberValue(byStageRaw, 'NEW'),
      QUALIFICATION: numberValue(byStageRaw, 'QUALIFICATION'),
      APPOINTMENT: numberValue(byStageRaw, 'APPOINTMENT'),
      DIAGNOSTIC: numberValue(byStageRaw, 'DIAGNOSTIC'),
      COURSE: numberValue(byStageRaw, 'COURSE'),
      LOST: numberValue(byStageRaw, 'LOST')
    }
  };
}

function safeSearch(value: string | null): string {
  return (value || '').trim().slice(0, 120).replace(/[,*()]/g, ' ').replace(/\s+/g, ' ').trim();
}

function filtersFromUrl(url: URL): FilterInput {
  const priorityValue = (url.searchParams.get('priority') || '').toUpperCase();
  const stageValue = (url.searchParams.get('stage') || '').toUpperCase();
  return {
    query: safeSearch(url.searchParams.get('q')),
    managerId: (url.searchParams.get('managerId') || '').trim().slice(0, 160),
    diagnostId: (url.searchParams.get('diagnostId') || '').trim().slice(0, 160),
    priority: PRIORITIES.includes(priorityValue as LeadPriority) ? priorityValue as LeadPriority : '',
    stage: STAGES.includes(stageValue as LeadStage) ? stageValue as LeadStage : ''
  };
}

function leadPagePath(filters: FilterInput, limit: number, offset: number, cursor: PageCursor | null): string {
  const params = new URLSearchParams();
  params.set('select', LEAD_SELECT);
  params.set('order', 'updated_at.desc,id.desc');
  params.set('limit', String(limit));
  if (!cursor) params.set('offset', String(offset));
  if (filters.managerId) params.set('manager_user_id', `eq.${filters.managerId}`);
  if (filters.diagnostId) params.set('diagnost_user_id', `eq.${filters.diagnostId}`);
  if (filters.priority) params.set('priority', `eq.${filters.priority}`);
  if (filters.stage) params.set('stage', `eq.${filters.stage}`);

  const searchItems = filters.query
    ? [`full_name.ilike.*${filters.query}*`, `phone.ilike.*${filters.query}*`, `diagnosis.ilike.*${filters.query}*`, `source.ilike.*${filters.query}*`]
    : [];
  const cursorItems = cursor
    ? [`updated_at.lt.${cursor.updatedAt}`, `and(updated_at.eq.${cursor.updatedAt},id.lt.${cursor.id})`]
    : [];
  if (searchItems.length && cursorItems.length) {
    params.set('and', `(or(${searchItems.join(',')}),or(${cursorItems.join(',')}))`);
  } else if (searchItems.length) {
    params.set('or', `(${searchItems.join(',')})`);
  } else if (cursorItems.length) {
    params.set('or', `(${cursorItems.join(',')})`);
  }
  return `/sales_funnel_leads?${params.toString()}`;
}

function contactSearchPath(query: string): string {
  const params = new URLSearchParams();
  params.set('select', CONTACT_SELECT);
  params.set('order', 'updated_at.desc,name.asc');
  params.set('limit', String(CONTACT_RESULT_LIMIT));
  if (query) {
    const pattern = `*${query}*`;
    params.set('or', `(name.ilike.${pattern},phone.ilike.${pattern})`);
  }
  return `/marketing_leads?${params.toString()}`;
}

async function contactSearch(env: Env, url: URL, requestId: string): Promise<Response> {
  const started = performance.now();
  const query = safeSearch(url.searchParams.get('q'));
  const rows = await db<Row[]>(env, contactSearchPath(query));
  return json(requestId, rows.map(mapContact), 200, `funnel_contact_search;dur=${(performance.now() - started).toFixed(1)}`);
}

async function workspace(env: Env, url: URL, requestId: string): Promise<Response> {
  const started = performance.now();
  const limit = parseInteger(url.searchParams.get('limit'), DEFAULT_LIMIT, 50, MAX_LIMIT);
  const offset = parseInteger(url.searchParams.get('offset'), 0, 0, 1_000_000);
  const cursor = parseCursor(url.searchParams.get('cursor'));
  const firstPage = !cursor && offset === 0;
  const filters = filtersFromUrl(url);

  const requestedLimit = cursor ? limit + 1 : limit;
  const pathWithPage = leadPagePath(filters, requestedLimit, offset, cursor);
  const leadsPromise = cursor ? db<Row[]>(env, pathWithPage) : dbPage<Row>(env, pathWithPage);
  const statsPromise = firstPage
    ? db<unknown>(env, '/rpc/marketing_funnel_stats', { method: 'POST', body: JSON.stringify({}) })
    : Promise.resolve(undefined);
  const activitiesPromise = firstPage
    ? db<Row[]>(env, `/sales_funnel_activities?select=${ACTIVITY_SELECT}&order=created_at.desc&limit=200`)
    : Promise.resolve([] as Row[]);
  const usersPromise = firstPage
    ? db<Row[]>(env, '/marketing_users?select=id,name,role,status&status=eq.active&order=name.asc&limit=500')
    : Promise.resolve([] as Row[]);
  const contactsPromise = firstPage
    ? db<Row[]>(env, contactSearchPath(''))
    : Promise.resolve([] as Row[]);

  const [leadResult, rawStats, activities, users, contacts] = await Promise.all([
    leadsPromise, statsPromise, activitiesPromise, usersPromise, contactsPromise
  ]);
  const rawRows = Array.isArray(leadResult) ? leadResult : leadResult.rows;
  const rows = cursor ? rawRows.slice(0, limit) : rawRows;
  const total = Array.isArray(leadResult) ? null : leadResult.total;
  const hasMore = cursor ? rawRows.length > limit : offset + rows.length < (total || 0);
  const nextOffset = !cursor && hasMore ? offset + rows.length : null;
  const nextCursor = hasMore && rows.length ? cursorValue(rows.at(-1) as Row) : null;
  const stats = rawStats === undefined ? undefined : normalizeStats(rawStats);
  const elapsed = performance.now() - started;

  return json(requestId, {
    leads: rows.map(mapLead),
    activities: activities.map(mapActivity),
    users: users.map(mapUser),
    contacts: contacts.map(mapContact),
    stats,
    pagination: { offset, limit, loaded: rows.length, total, hasMore, nextOffset, nextCursor },
    filters
  }, 200, `${cursor ? 'funnel_workspace_cursor' : 'funnel_workspace'};dur=${elapsed.toFixed(1)}`);
}

// ---------------------------------------------------------------------------
// Мутации лидов
// ---------------------------------------------------------------------------

async function createLead(request: Request, env: Env, requestId: string): Promise<Response> {
  const input = await request.json().catch(() => null) as LeadInput | null;
  const contact = await ensureContact(env, input?.contactId);
  const fullName = input?.fullName?.trim() || (contact ? stringValue(contact, 'name') : '');
  const phone = cleanNullable(input?.phone) || (contact ? cleanNullable(contact.phone) : null);
  const diagnosis = cleanNullable(input?.diagnosis) || (contact ? cleanNullable(stringValue(contact, 'first_message')) : null);
  const stage = input?.stage || 'NEW';
  const priority = input?.priority || 'MEDIUM';
  if (!fullName) return json(requestId, { error: 'Имя клиента обязательно' }, 400);
  if (!STAGES.includes(stage) || !PRIORITIES.includes(priority)) return json(requestId, { error: 'Недопустимая стадия или приоритет' }, 400);
  if (!await ensureUser(env, input?.diagnostUserId) || !await ensureUser(env, input?.managerUserId)) return json(requestId, { error: 'Выбранный сотрудник не найден или заблокирован' }, 400);
  if (!validateOwners(stage, input?.diagnostUserId, input?.managerUserId)) return json(requestId, { error: 'Перед движением по воронке назначьте диагноста и менеджера' }, 400);
  const now = new Date().toISOString();
  const rows = await db<Row[]>(env, `/sales_funnel_leads?select=${LEAD_SELECT}`, {
    method: 'POST',
    body: JSON.stringify({
      id: `funnel_lead_${crypto.randomUUID()}`,
      contact_id: input?.contactId || null,
      full_name: fullName,
      phone,
      diagnosis,
      source: input?.source?.trim() || DEFAULT_SOURCE,
      priority,
      stage,
      diagnost_user_id: input?.diagnostUserId || null,
      manager_user_id: input?.managerUserId || null,
      amount: Number.isFinite(input?.amount) && Number(input?.amount) >= 0 ? Number(input?.amount) : 0,
      paid: input?.paid === true,
      lost_reason: stage === 'LOST' ? cleanNullable(input?.lostReason) : null,
      created_at: now,
      updated_at: now,
      closed_at: stage === 'COURSE' || stage === 'LOST' ? now : null
    })
  });
  if (!rows[0]) return json(requestId, { error: 'Лид не создан' }, 502);
  const lead = mapLead(rows[0]);
  await logActivity(env, lead.id, 'CREATED', `Создан лид: ${lead.fullName}`, { stage: lead.stage, source: lead.source }, requestActorId(request));
  return json(requestId, lead, 201);
}

async function updateLead(request: Request, env: Env, requestId: string, id: string): Promise<Response> {
  const current = await ensureLead(env, id);
  if (!current) return json(requestId, { error: 'Лид не найден' }, 404);
  const input = await request.json().catch(() => null) as LeadInput | null;
  if (!input) return json(requestId, { error: 'Тело запроса не распознано' }, 400);
  const currentStage = stringValue(current, 'stage') as LeadStage;
  const nextStage = input.stage ?? currentStage;
  const nextDiagnost = input.diagnostUserId === undefined ? optionalString(current, 'diagnost_user_id') : input.diagnostUserId;
  const nextManager = input.managerUserId === undefined ? optionalString(current, 'manager_user_id') : input.managerUserId;
  if (!STAGES.includes(nextStage)) return json(requestId, { error: 'Недопустимая стадия' }, 400);
  if (input.priority !== undefined && !PRIORITIES.includes(input.priority)) return json(requestId, { error: 'Недопустимый приоритет' }, 400);
  if (!await ensureUser(env, nextDiagnost) || !await ensureUser(env, nextManager)) return json(requestId, { error: 'Выбранный сотрудник не найден или заблокирован' }, 400);
  if (!validateOwners(nextStage, nextDiagnost, nextManager)) return json(requestId, { error: 'Перед движением по воронке назначьте диагноста и менеджера' }, 400);
  const patch: Row = { updated_at: new Date().toISOString() };
  if (input.fullName !== undefined) {
    if (!input.fullName.trim()) return json(requestId, { error: 'Имя клиента обязательно' }, 400);
    patch.full_name = input.fullName.trim();
  }
  if (input.contactId !== undefined) patch.contact_id = input.contactId || null;
  if (input.phone !== undefined) patch.phone = cleanNullable(input.phone);
  if (input.diagnosis !== undefined) patch.diagnosis = cleanNullable(input.diagnosis);
  if (input.source !== undefined) patch.source = input.source.trim() || DEFAULT_SOURCE;
  if (input.priority !== undefined) patch.priority = input.priority;
  if (input.stage !== undefined) patch.stage = input.stage;
  if (input.diagnostUserId !== undefined) patch.diagnost_user_id = input.diagnostUserId || null;
  if (input.managerUserId !== undefined) patch.manager_user_id = input.managerUserId || null;
  if (input.amount !== undefined) {
    if (!Number.isFinite(input.amount) || input.amount < 0) return json(requestId, { error: 'Некорректная сумма' }, 400);
    patch.amount = input.amount;
  }
  if (input.paid !== undefined) patch.paid = input.paid;
  if (input.lostReason !== undefined) patch.lost_reason = cleanNullable(input.lostReason);
  if (nextStage === 'COURSE' || nextStage === 'LOST') patch.closed_at = new Date().toISOString();
  else if (currentStage === 'COURSE' || currentStage === 'LOST') patch.closed_at = null;
  const rows = await db<Row[]>(env, `/sales_funnel_leads?id=eq.${encodeURIComponent(id)}&select=${LEAD_SELECT}`, {
    method: 'PATCH', body: JSON.stringify(patch)
  });
  if (!rows[0]) return json(requestId, { error: 'Лид не обновлён' }, 502);
  const lead = mapLead(rows[0]);
  const title = nextStage !== currentStage ? `${lead.fullName} → ${nextStage}` : `Обновлён лид: ${lead.fullName}`;
  await logActivity(env, id, nextStage !== currentStage ? 'STAGE_CHANGED' : 'UPDATED', title, { from: currentStage, to: nextStage }, requestActorId(request));
  return json(requestId, lead);
}

async function leadAction(request: Request, env: Env, requestId: string, id: string): Promise<Response> {
  const current = await ensureLead(env, id);
  if (!current) return json(requestId, { error: 'Лид не найден' }, 404);
  const body = await request.json().catch(() => null) as { action?: LeadAction; lostReason?: string } | null;
  const action = body?.action;
  if (!action || !['WHATSAPP', 'BOOK', 'COURSE', 'LOST', 'RESTORE'].includes(action)) return json(requestId, { error: 'Недопустимое действие' }, 400);
  const lead = mapLead(current);
  if (['WHATSAPP', 'BOOK', 'COURSE'].includes(action) && !validateOwners('QUALIFICATION', lead.diagnostUserId, lead.managerUserId)) {
    return json(requestId, { error: 'Назначьте диагноста и менеджера' }, 400);
  }
  const now = new Date().toISOString();
  const patch: Row = { updated_at: now };
  let title = '';
  if (action === 'WHATSAPP') {
    patch.whatsapp_count = lead.whatsappCount + 1;
    patch.stage = lead.stage === 'NEW' ? 'QUALIFICATION' : lead.stage;
    title = `WhatsApp отправлен: ${lead.fullName}`;
  } else if (action === 'BOOK') {
    patch.stage = 'APPOINTMENT';
    title = `Создана запись: ${lead.fullName}`;
  } else if (action === 'COURSE') {
    patch.stage = 'COURSE';
    patch.paid = true;
    patch.closed_at = now;
    title = `Курс оплачен: ${lead.fullName}`;
  } else if (action === 'LOST') {
    patch.stage = 'LOST';
    patch.lost_reason = body?.lostReason?.trim() || 'Причина не указана';
    patch.closed_at = now;
    title = `Лид потерян: ${lead.fullName}`;
  } else {
    patch.stage = 'NEW';
    patch.lost_reason = null;
    patch.closed_at = null;
    title = `Лид восстановлен: ${lead.fullName}`;
  }
  const rows = await db<Row[]>(env, `/sales_funnel_leads?id=eq.${encodeURIComponent(id)}&select=${LEAD_SELECT}`, {
    method: 'PATCH', body: JSON.stringify(patch)
  });
  if (!rows[0]) return json(requestId, { error: 'Действие не выполнено' }, 502);
  const updated = mapLead(rows[0]);
  await logActivity(env, id, action, title, { stage: updated.stage, lostReason: updated.lostReason }, requestActorId(request));
  return json(requestId, updated);
}

// ---------------------------------------------------------------------------
// Канбан-доски
// ---------------------------------------------------------------------------

const boardText = (row: Row, key: string) => typeof row[key] === 'string' ? row[key] as string : '';
const boardBool = (row: Row, key: string) => row[key] === true;

function mapBoard(row: Row) {
  return {
    id: boardText(row, 'id'),
    name: boardText(row, 'name'),
    description: boardText(row, 'description') || undefined,
    columns: Array.isArray(row.columns) ? row.columns : DEFAULT_COLUMNS,
    filters: row.filters && typeof row.filters === 'object' && !Array.isArray(row.filters) ? row.filters : {},
    showTotals: boardBool(row, 'show_totals'),
    isDefault: boardBool(row, 'is_default'),
    isActive: boardBool(row, 'is_active'),
    sortOrder: numberValue(row, 'sort_order'),
    createdAt: boardText(row, 'created_at'),
    updatedAt: boardText(row, 'updated_at')
  };
}

function cleanStringList(value: unknown, max = 50): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map((item) => typeof item === 'string' ? item.trim() : '').filter(Boolean))).slice(0, max);
}

function normalizeColumns(value: unknown): Array<Required<BoardColumnInput>> | null {
  if (!Array.isArray(value)) return null;
  const seen = new Set<LeadStage>();
  const columns: Array<Required<BoardColumnInput>> = [];
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
    const input = item as BoardColumnInput;
    if (!input.stage || !STAGES.includes(input.stage) || seen.has(input.stage)) return null;
    seen.add(input.stage);
    const fallback = DEFAULT_COLUMNS.find((column) => column.stage === input.stage)!;
    const color = typeof input.color === 'string' && /^#[0-9a-f]{6}$/i.test(input.color) ? input.color : fallback.color;
    columns.push({
      stage: input.stage,
      title: input.title?.trim().slice(0, 80) || fallback.title,
      subtitle: input.subtitle?.trim().slice(0, 160) || fallback.subtitle,
      color,
      wipLimit: Math.max(0, Math.min(999, Math.trunc(Number(input.wipLimit) || 0))),
      visible: input.visible !== false
    });
  }
  return columns.length ? columns : null;
}

function normalizeBoardFilters(value: unknown): Required<BoardFiltersInput> {
  const input = value && typeof value === 'object' && !Array.isArray(value) ? value as BoardFiltersInput : {};
  return {
    sources: cleanStringList(input.sources),
    priorities: cleanStringList(input.priorities).filter((item): item is LeadPriority => PRIORITIES.includes(item as LeadPriority)),
    diagnostUserIds: cleanStringList(input.diagnostUserIds),
    managerUserIds: cleanStringList(input.managerUserIds)
  };
}

async function clearOtherDefaults(env: Env, exceptId?: string): Promise<void> {
  let path = '/sales_funnel_boards?is_default=eq.true';
  if (exceptId) path += `&id=neq.${encodeURIComponent(exceptId)}`;
  await db<Row[]>(env, path, { method: 'PATCH', body: JSON.stringify({ is_default: false, updated_at: new Date().toISOString() }) });
}

async function ensureDefaultBoard(env: Env): Promise<Row[]> {
  const current = await db<Row[]>(env, `/sales_funnel_boards?select=${BOARD_SELECT}&is_active=eq.true&order=sort_order.asc,created_at.asc&limit=200`);
  if (current.length) return current;
  return db<Row[]>(env, `/sales_funnel_boards?select=${BOARD_SELECT}`, {
    method: 'POST',
    body: JSON.stringify({
      id: `funnel_board_${crypto.randomUUID()}`,
      name: 'Основная воронка',
      description: 'Все лиды отдела продаж',
      columns: DEFAULT_COLUMNS,
      filters: { sources: [], priorities: [], diagnostUserIds: [], managerUserIds: [] },
      show_totals: true,
      is_default: true,
      is_active: true,
      sort_order: 10,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    })
  });
}

async function listBoards(env: Env, requestId: string): Promise<Response> {
  const rows = await ensureDefaultBoard(env);
  return json(requestId, rows.map(mapBoard));
}

async function createBoard(request: Request, env: Env, requestId: string): Promise<Response> {
  const input = await request.json().catch(() => null) as BoardInput | null;
  const name = input?.name?.trim().slice(0, 120) || '';
  const columns = normalizeColumns(input?.columns ?? DEFAULT_COLUMNS);
  if (!name) return json(requestId, { error: 'Название канбана обязательно' }, 400);
  if (!columns) return json(requestId, { error: 'Настройка колонок некорректна' }, 400);
  const isDefault = input?.isDefault === true;
  if (isDefault) await clearOtherDefaults(env);
  const now = new Date().toISOString();
  const rows = await db<Row[]>(env, `/sales_funnel_boards?select=${BOARD_SELECT}`, {
    method: 'POST',
    body: JSON.stringify({
      id: `funnel_board_${crypto.randomUUID()}`,
      name,
      description: input?.description?.trim().slice(0, 500) || null,
      columns,
      filters: normalizeBoardFilters(input?.filters),
      show_totals: input?.showTotals !== false,
      is_default: isDefault,
      is_active: true,
      sort_order: Math.max(0, Math.trunc(Number(input?.sortOrder) || Date.now() % 1_000_000)),
      created_at: now,
      updated_at: now
    })
  });
  return rows[0] ? json(requestId, mapBoard(rows[0]), 201) : json(requestId, { error: 'Канбан не создан' }, 502);
}

async function updateBoard(request: Request, env: Env, requestId: string, id: string): Promise<Response> {
  const existing = await db<Row[]>(env, `/sales_funnel_boards?select=${BOARD_SELECT}&id=eq.${encodeURIComponent(id)}&is_active=eq.true&limit=1`);
  if (!existing[0]) return json(requestId, { error: 'Канбан не найден' }, 404);
  const input = await request.json().catch(() => null) as BoardInput | null;
  if (!input) return json(requestId, { error: 'Тело запроса не распознано' }, 400);
  const patch: Row = { updated_at: new Date().toISOString() };
  if (input.name !== undefined) {
    const name = input.name.trim().slice(0, 120);
    if (!name) return json(requestId, { error: 'Название канбана обязательно' }, 400);
    patch.name = name;
  }
  if (input.description !== undefined) patch.description = input.description?.trim().slice(0, 500) || null;
  if (input.columns !== undefined) {
    const columns = normalizeColumns(input.columns);
    if (!columns) return json(requestId, { error: 'Настройка колонок некорректна' }, 400);
    patch.columns = columns;
  }
  if (input.filters !== undefined) patch.filters = normalizeBoardFilters(input.filters);
  if (input.showTotals !== undefined) patch.show_totals = input.showTotals;
  if (input.sortOrder !== undefined) patch.sort_order = Math.max(0, Math.trunc(Number(input.sortOrder) || 0));
  if (input.isDefault === true) {
    await clearOtherDefaults(env, id);
    patch.is_default = true;
  }
  const rows = await db<Row[]>(env, `/sales_funnel_boards?id=eq.${encodeURIComponent(id)}&select=${BOARD_SELECT}`, {
    method: 'PATCH', body: JSON.stringify(patch)
  });
  return rows[0] ? json(requestId, mapBoard(rows[0])) : json(requestId, { error: 'Канбан не обновлён' }, 502);
}

async function archiveBoard(env: Env, requestId: string, id: string): Promise<Response> {
  const rows = await db<Row[]>(env, `/sales_funnel_boards?select=${BOARD_SELECT}&id=eq.${encodeURIComponent(id)}&is_active=eq.true&limit=1`);
  const current = rows[0];
  if (!current) return json(requestId, { error: 'Канбан не найден' }, 404);
  const active = await db<Row[]>(env, `/sales_funnel_boards?select=${BOARD_SELECT}&is_active=eq.true&id=neq.${encodeURIComponent(id)}&order=sort_order.asc,created_at.asc&limit=2`);
  if (!active.length) return json(requestId, { error: 'Нельзя архивировать единственный канбан' }, 409);
  await db<Row[]>(env, `/sales_funnel_boards?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH', body: JSON.stringify({ is_active: false, is_default: false, updated_at: new Date().toISOString() })
  });
  if (boardBool(current, 'is_default')) {
    await db<Row[]>(env, `/sales_funnel_boards?id=eq.${encodeURIComponent(boardText(active[0], 'id'))}`, {
      method: 'PATCH', body: JSON.stringify({ is_default: true, updated_at: new Date().toISOString() })
    });
  }
  return new Response(null, { status: 204, headers: responseHeaders(requestId) });
}

// ---------------------------------------------------------------------------
// Маршрутизация
// ---------------------------------------------------------------------------

export async function handleSalesFunnel(request: Request, env: Env, url: URL): Promise<Response | null> {
  const path = url.pathname.replace(/\/+$/, '') || '/';
  if (!path.startsWith('/api/funnel/')) return null;
  const requestId = crypto.randomUUID();
  const isRead = request.method === 'GET' || request.method === 'HEAD';
  if (!isRead && !canWrite(request)) {
    return json(requestId, { error: 'Изменения в воронке доступны администратору и маркетологу' }, 403);
  }
  try {
    if (request.method === 'GET' && path === '/api/funnel/workspace') return await workspace(env, url, requestId);
    if (request.method === 'GET' && path === '/api/funnel/contacts') return await contactSearch(env, url, requestId);
    if (request.method === 'POST' && path === '/api/funnel/leads') return await createLead(request, env, requestId);
    const leadMatch = path.match(/^\/api\/funnel\/leads\/([^/]+)$/);
    if (request.method === 'PATCH' && leadMatch) return await updateLead(request, env, requestId, decodeURIComponent(leadMatch[1]));
    const actionMatch = path.match(/^\/api\/funnel\/leads\/([^/]+)\/actions$/);
    if (request.method === 'POST' && actionMatch) return await leadAction(request, env, requestId, decodeURIComponent(actionMatch[1]));
    if (request.method === 'GET' && path === '/api/funnel/boards') return await listBoards(env, requestId);
    if (request.method === 'POST' && path === '/api/funnel/boards') return await createBoard(request, env, requestId);
    const boardMatch = path.match(/^\/api\/funnel\/boards\/([^/]+)$/);
    if (request.method === 'PATCH' && boardMatch) return await updateBoard(request, env, requestId, decodeURIComponent(boardMatch[1]));
    if (request.method === 'DELETE' && boardMatch) return await archiveBoard(env, requestId, decodeURIComponent(boardMatch[1]));
    return json(requestId, { error: 'Маршрут воронки не найден' }, 404);
  } catch (error) {
    const upstream = error instanceof FunnelUpstreamError;
    console.error(JSON.stringify({
      level: 'error', area: 'sales-funnel', requestId, path,
      message: error instanceof Error ? error.message : 'Unknown error',
      upstreamStatus: upstream ? error.status : undefined,
      upstreamDetail: upstream ? error.detail : undefined
    }));
    return json(requestId, {
      error: upstream ? 'Ошибка подключения к PostgreSQL/Supabase' : 'Внутренняя ошибка модуля воронки',
      requestId
    }, upstream ? 502 : 500);
  }
}
