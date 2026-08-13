import type { Env } from './integrations';
import { requireCompanyId, type TenantScopedEnv } from './tenantScope';

type Row = Record<string, unknown>;
type ScopedEnv = Env & TenantScopedEnv;

const ROLE_HEADER = 'x-amanat-auth-role';
const USER_HEADER = 'x-amanat-auth-user';
const WRITE_ROLES = new Set(['administrator', 'marketer']);

class UpstreamError extends Error {
  constructor(readonly status: number, readonly detail: string) { super(`Supabase request failed with HTTP ${status}`); }
}

function requestId(request: Request): string { return request.headers.get('x-correlation-id') || crypto.randomUUID(); }
function role(request: Request): string { return (request.headers.get(ROLE_HEADER) || '').trim().toLowerCase(); }
function actorId(request: Request): string | null {
  const value = (request.headers.get(USER_HEADER) || '').trim();
  return /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(value) ? value : null;
}
function json(id: string, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-request-id': id } });
}
function apiBase(env: Env): string { return `${env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1`; }
function dbHeaders(env: Env, init: RequestInit): Headers {
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  const headers = new Headers(init.headers);
  headers.set('apikey', key);
  if (!key.startsWith('sb_secret_')) headers.set('authorization', `Bearer ${key}`);
  headers.set('accept', 'application/json');
  if (init.body != null) headers.set('content-type', 'application/json');
  return headers;
}
async function db<T>(env: Env, path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${apiBase(env)}${path}`, { ...init, headers: dbHeaders(env, init), cache: 'no-store' });
  const text = await response.text();
  if (!response.ok) throw new UpstreamError(response.status, text.slice(0, 1400));
  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}
async function body(request: Request): Promise<Row> {
  try { const value = await request.json(); return value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {}; } catch { return {}; }
}
function text(value: unknown, max = 300): string | null {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null;
}
async function isCompanyAdmin(request: Request, env: Env, companyId: string): Promise<boolean> {
  if (role(request) !== 'administrator') return false;
  const userId = actorId(request); if (!userId) return false;
  const rows = await db<Row[]>(env, `/crm_company_members?select=user_id&company_id=eq.${encodeURIComponent(companyId)}&user_id=eq.${encodeURIComponent(userId)}&status=eq.active&role=in.(owner,administrator)&limit=1`);
  return rows.length > 0;
}

async function listContacts(request: Request, env: Env, url: URL, id: string): Promise<Response> {
  const companyId = requireCompanyId(env as ScopedEnv);
  const q = (url.searchParams.get('q') || '').trim().slice(0, 120);
  const limit = Math.max(1, Math.min(Number(url.searchParams.get('limit') || 250) || 250, 500));
  const rows = await db<unknown[]>(env, '/rpc/crm_customer360_list', {
    method: 'POST', body: JSON.stringify({ p_company_id: companyId, p_query: q || null, p_limit: limit }),
  });
  return json(id, Array.isArray(rows) ? rows : []);
}

async function detail(env: Env, companyId: string, contactId: string): Promise<unknown | null> {
  return db<unknown | null>(env, '/rpc/crm_customer360_detail', {
    method: 'POST', body: JSON.stringify({ p_company_id: companyId, p_contact_id: contactId }),
  });
}

async function updateContact(request: Request, env: Env, contactId: string, id: string): Promise<Response> {
  if (!WRITE_ROLES.has(role(request))) return json(id, { error: 'Недостаточно прав для изменения клиента' }, 403);
  const companyId = requireCompanyId(env as ScopedEnv);
  const input = await body(request);
  const patch: Row = { updated_at: new Date().toISOString() };
  if ('firstName' in input) patch.first_name = text(input.firstName, 120);
  if ('lastName' in input) patch.last_name = text(input.lastName, 120);
  if ('phone' in input) patch.phone = text(input.phone, 60);
  if ('email' in input) patch.email = text(input.email, 254);
  if ('source' in input) patch.source = text(input.source, 120);
  const rows = await db<Row[]>(env, `/crm_contacts?id=eq.${encodeURIComponent(contactId)}&company_id=eq.${encodeURIComponent(companyId)}&deleted_at=is.null`, {
    method: 'PATCH', headers: { prefer: 'return=representation' }, body: JSON.stringify(patch),
  });
  if (!rows[0]) return json(id, { error: 'Клиент не найден' }, 404);
  return json(id, await detail(env, companyId, contactId));
}

async function mergeContacts(request: Request, env: Env, targetId: string, id: string): Promise<Response> {
  const companyId = requireCompanyId(env as ScopedEnv);
  if (!(await isCompanyAdmin(request, env, companyId))) return json(id, { error: 'Объединять клиентов может только администратор' }, 403);
  const input = await body(request); const sourceId = text(input.sourceContactId, 36);
  if (!sourceId || !/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(sourceId)) return json(id, { error: 'Укажите исходного клиента' }, 400);
  await db<unknown>(env, '/rpc/crm_merge_contacts', {
    method: 'POST', body: JSON.stringify({ p_company_id: companyId, p_target_contact_id: targetId, p_source_contact_id: sourceId, p_actor_user_id: actorId(request) }),
  });
  return json(id, await detail(env, companyId, targetId));
}

async function resolveLead(env: Env, companyId: string, leadId: string): Promise<string | null> {
  const rows = await db<Row[]>(env, `/marketing_leads?select=crm_contact_id&id=eq.${encodeURIComponent(leadId)}&company_id=eq.${encodeURIComponent(companyId)}&limit=1`);
  const value = rows[0]?.crm_contact_id; return typeof value === 'string' ? value : null;
}

export async function handleCustomer360(request: Request, env: Env, url: URL): Promise<Response | null> {
  if (!url.pathname.startsWith('/api/customer360')) return null;
  const id = requestId(request);
  try {
    const companyId = requireCompanyId(env as ScopedEnv);
    if (request.method === 'GET' && url.pathname === '/api/customer360') {
      const legacyLeadId = (url.searchParams.get('leadId') || '').trim();
      if (legacyLeadId && /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(legacyLeadId)) return json(id, { contactId: await resolveLead(env, companyId, legacyLeadId) });
      return listContacts(request, env, url, id);
    }
    const match = url.pathname.match(/^\/api\/customer360\/([0-9a-f-]{36})(?:\/(merge))?\/?$/i);
    if (!match) return json(id, { error: 'Маршрут Customer 360 не найден' }, 404);
    const contactId = match[1]; const action = match[2] || '';
    if (request.method === 'GET' && !action) {
      const payload = await detail(env, companyId, contactId); return payload ? json(id, payload) : json(id, { error: 'Клиент не найден' }, 404);
    }
    if (request.method === 'PATCH' && !action) return updateContact(request, env, contactId, id);
    if (request.method === 'POST' && action === 'merge') return mergeContacts(request, env, contactId, id);
    return json(id, { error: 'Метод не поддерживается' }, 405);
  } catch (error) {
    if (error instanceof UpstreamError) return json(id, { error: 'Ошибка источника данных Customer 360', detail: error.detail }, 502);
    return json(id, { error: error instanceof Error ? error.message : 'Ошибка Customer 360' }, 500);
  }
}
