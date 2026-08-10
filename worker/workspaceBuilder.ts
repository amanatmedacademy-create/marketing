import { resolveCompanyId } from './companyContext';

type Row = Record<string, unknown>;
type BlockKind = 'system' | 'metric' | 'table' | 'chart' | 'funnel';

export interface WorkspaceBuilderEnv {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  DEFAULT_COMPANY_ID?: string;
}

class HttpError extends Error { constructor(readonly status: number, message: string) { super(message); } }
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
const text = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
const record = (value: unknown): Row => value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {};
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const allowedKinds: BlockKind[] = ['system', 'metric', 'table', 'chart', 'funnel'];
const allowedSources = new Set(['dashboard', 'leads', 'calls', 'ads', 'sources']);

function userId(request: Request) { return text(request.headers.get('x-amanat-auth-user')); }
function userRole(request: Request) { return text(request.headers.get('x-amanat-auth-role')); }
function headers(env: WorkspaceBuilderEnv, extra: HeadersInit = {}): HeadersInit { return { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, 'content-type': 'application/json', ...extra }; }
async function db<T>(env: WorkspaceBuilderEnv, path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/${path}`, { ...init, headers: headers(env, init.headers) });
  const body = await response.text();
  if (!response.ok) throw new HttpError(502, `Workspace storage: ${response.status} ${body.slice(0, 700)}`);
  return (body ? JSON.parse(body) : null) as T;
}

async function companyForUser(request: Request, env: WorkspaceBuilderEnv, adminOnly = false): Promise<string> {
  const uid = userId(request);
  if (!uuidPattern.test(uid)) throw new HttpError(401, 'Не удалось определить пользователя');
  if (adminOnly && userRole(request) !== 'administrator') throw new HttpError(403, 'Настройка рабочего пространства доступна только администратору');
  const companyId = await resolveCompanyId(env);
  const roleFilter = adminOnly ? '&role=in.(owner,administrator)' : '';
  const rows = await db<Row[]>(env, `crm_company_members?company_id=eq.${companyId}&user_id=eq.${uid}&status=eq.active${roleFilter}&select=user_id,role&limit=1`);
  if (!rows.length) throw new HttpError(403, adminOnly ? 'Нет административных прав в текущей компании' : 'Нет доступа к текущей компании');
  return companyId;
}

function cleanRoute(value: unknown): string {
  const route = text(value) || '/';
  if (!route.startsWith('/') || route.length > 180) throw new HttpError(400, 'Некорректный route');
  return route;
}
function cleanKey(value: unknown): string {
  const key = text(value).replace(/[^a-zA-Z0-9:_-]/g, '').slice(0, 160);
  if (!key) throw new HttpError(400, 'block_key обязателен');
  return key;
}
function cleanKind(value: unknown): BlockKind {
  const kind = text(value) as BlockKind;
  if (!allowedKinds.includes(kind)) throw new HttpError(400, 'Неизвестный тип блока');
  return kind;
}
function cleanSource(value: unknown): string | null {
  const source = text(value);
  if (!source) return null;
  if (!allowedSources.has(source)) throw new HttpError(400, 'Источник данных не разрешён');
  return source;
}
function publicBlock(row: Row) {
  return {
    id: text(row.id), route: text(row.route), blockKey: text(row.block_key), kind: text(row.kind), title: text(row.title),
    dataSource: row.data_source ? text(row.data_source) : null, config: record(row.config), layout: record(row.layout),
    isVisible: row.is_visible !== false, isSystem: row.is_system === true, updatedAt: row.updated_at || null,
  };
}

async function listBlocks(request: Request, env: WorkspaceBuilderEnv, url: URL) {
  const companyId = await companyForUser(request, env);
  const route = cleanRoute(url.searchParams.get('route') || '/');
  const rows = await db<Row[]>(env, `marketing_workspace_blocks?company_id=eq.${companyId}&route=eq.${encodeURIComponent(route)}&select=*&order=created_at.asc`);
  return { route, blocks: rows.map(publicBlock), editable: userRole(request) === 'administrator' };
}

async function saveBlock(request: Request, env: WorkspaceBuilderEnv) {
  const companyId = await companyForUser(request, env, true);
  const input = record(await request.json().catch(() => ({})));
  const route = cleanRoute(input.route);
  const blockKey = cleanKey(input.blockKey ?? input.block_key);
  const kind = cleanKind(input.kind);
  const title = text(input.title).slice(0, 180);
  const dataSource = cleanSource(input.dataSource ?? input.data_source);
  const config = record(input.config);
  const layout = record(input.layout);
  const now = new Date().toISOString();
  const uid = userId(request);
  const payload = { company_id: companyId, route, block_key: blockKey, kind, title, data_source: dataSource, config, layout, is_visible: input.isVisible !== false, is_system: input.isSystem === true || kind === 'system', created_by: uid, updated_by: uid, updated_at: now };
  const rows = await db<Row[]>(env, 'marketing_workspace_blocks?on_conflict=company_id,route,block_key', { method: 'POST', headers: { prefer: 'resolution=merge-duplicates,return=representation' }, body: JSON.stringify(payload) });
  return publicBlock(rows[0] || payload);
}

async function patchBlock(request: Request, env: WorkspaceBuilderEnv, id: string) {
  const companyId = await companyForUser(request, env, true);
  if (!uuidPattern.test(id)) throw new HttpError(400, 'Некорректный ID блока');
  const input = record(await request.json().catch(() => ({})));
  const patch: Row = { updated_by: userId(request), updated_at: new Date().toISOString() };
  if (input.title !== undefined) patch.title = text(input.title).slice(0, 180);
  if (input.dataSource !== undefined || input.data_source !== undefined) patch.data_source = cleanSource(input.dataSource ?? input.data_source);
  if (input.config !== undefined) patch.config = record(input.config);
  if (input.layout !== undefined) patch.layout = record(input.layout);
  if (input.isVisible !== undefined) patch.is_visible = input.isVisible !== false;
  const rows = await db<Row[]>(env, `marketing_workspace_blocks?id=eq.${id}&company_id=eq.${companyId}`, { method: 'PATCH', headers: { prefer: 'return=representation' }, body: JSON.stringify(patch) });
  if (!rows.length) throw new HttpError(404, 'Блок не найден');
  return publicBlock(rows[0]);
}

async function deleteBlock(request: Request, env: WorkspaceBuilderEnv, id: string) {
  const companyId = await companyForUser(request, env, true);
  if (!uuidPattern.test(id)) throw new HttpError(400, 'Некорректный ID блока');
  const rows = await db<Row[]>(env, `marketing_workspace_blocks?id=eq.${id}&company_id=eq.${companyId}&select=id,is_system`);
  if (!rows.length) throw new HttpError(404, 'Блок не найден');
  if (rows[0].is_system === true) throw new HttpError(400, 'Системный блок нельзя удалить — его можно скрыть');
  await db(env, `marketing_workspace_blocks?id=eq.${id}&company_id=eq.${companyId}`, { method: 'DELETE', headers: { prefer: 'return=minimal' } });
  return { ok: true, id };
}

export async function handleWorkspaceBuilderRequest(request: Request, env: WorkspaceBuilderEnv, url: URL): Promise<Response | null> {
  if (!url.pathname.startsWith('/api/workspace/blocks')) return null;
  try {
    if (url.pathname === '/api/workspace/blocks') {
      if (request.method === 'GET') return json(await listBlocks(request, env, url));
      if (request.method === 'POST') return json({ block: await saveBlock(request, env) }, 201);
      return json({ error: 'Method not allowed' }, 405);
    }
    const id = decodeURIComponent(url.pathname.slice('/api/workspace/blocks/'.length));
    if (request.method === 'PATCH') return json({ block: await patchBlock(request, env, id) });
    if (request.method === 'DELETE') return json(await deleteBlock(request, env, id));
    return json({ error: 'Method not allowed' }, 405);
  } catch (error) {
    if (error instanceof HttpError) return json({ error: error.message }, error.status);
    return json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
}
