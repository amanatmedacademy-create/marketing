import { resolveCompanyId } from './companyContext';
import { resolveUserAccess, type AccessAction } from './accessControl';

type Row = Record<string, unknown>;
export interface AccessAdminEnv { SUPABASE_URL: string; SUPABASE_SERVICE_ROLE_KEY: string; DEFAULT_COMPANY_ID?: string }
class HttpError extends Error { constructor(readonly status: number, message: string) { super(message); } }
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
const text = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
const record = (value: unknown): Row => value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const actions: AccessAction[] = ['view','create','edit','delete','export','manage'];

function headers(env: AccessAdminEnv, extra: HeadersInit = {}): HeadersInit { return { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, 'content-type': 'application/json', ...extra }; }
async function db<T>(env: AccessAdminEnv, path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/${path}`, { ...init, headers: headers(env, init.headers) });
  const body = await response.text();
  if (!response.ok) throw new HttpError(502, `Supabase access: ${response.status} ${body.slice(0, 900)}`);
  return (body ? JSON.parse(body) : null) as T;
}
function actorId(request: Request): string { return text(request.headers.get('x-amanat-auth-user')); }
function actorRole(request: Request): string { return text(request.headers.get('x-amanat-auth-role')); }
async function requireAdmin(request: Request, env: AccessAdminEnv): Promise<string> {
  if (actorRole(request) !== 'administrator') throw new HttpError(403, 'Матрица прав доступна только администратору');
  const userId = actorId(request); if (!uuid.test(userId)) throw new HttpError(401, 'Не удалось определить пользователя');
  const companyId = await resolveCompanyId(env);
  const rows = await db<Row[]>(env, `crm_company_members?company_id=eq.${companyId}&user_id=eq.${userId}&status=eq.active&role=in.(owner,administrator)&select=user_id`);
  if (!rows.length) throw new HttpError(403, 'Нет административных прав в компании');
  return companyId;
}
function permissionPayload(value: unknown, nullable = false): Row {
  const input = record(value); const output: Row = {};
  for (const action of actions) {
    const key = `can_${action}`;
    const raw = input[action] ?? input[key];
    if (nullable) output[key] = typeof raw === 'boolean' ? raw : null;
    else output[key] = raw === true;
  }
  return output;
}
async function workspace(env: AccessAdminEnv, companyId: string) {
  const [modules, positions, permissions, assignments, overrides, members] = await Promise.all([
    db<Row[]>(env, 'platform_modules?status=eq.active&select=id,name,description,category,route,navigation_label,navigation_order,metadata&order=navigation_order.asc'),
    db<Row[]>(env, `crm_access_positions?company_id=eq.${companyId}&select=*&order=is_system.desc,name.asc`),
    db<Row[]>(env, `crm_access_position_permissions?company_id=eq.${companyId}&select=*`),
    db<Row[]>(env, `crm_access_user_assignments?company_id=eq.${companyId}&select=*`),
    db<Row[]>(env, `crm_access_user_overrides?company_id=eq.${companyId}&select=*`),
    db<Row[]>(env, `crm_company_members?company_id=eq.${companyId}&select=user_id,role,status`),
  ]);
  return { modules, positions, permissions, assignments, overrides, members };
}
async function createPosition(request: Request, env: AccessAdminEnv, companyId: string) {
  const input = record(await request.json().catch(() => ({}))); const name = text(input.name); if (name.length < 2) throw new HttpError(400, 'Укажите название должности');
  const rows = await db<Row[]>(env, 'crm_access_positions?select=*', { method:'POST', headers:{prefer:'return=representation'}, body:JSON.stringify({company_id:companyId,name,description:text(input.description)||null,is_system:false,created_by:actorId(request)}) });
  return rows[0];
}
async function updatePosition(request: Request, env: AccessAdminEnv, companyId: string, positionId: string) {
  const input = record(await request.json().catch(() => ({})));
  const existing = await db<Row[]>(env, `crm_access_positions?company_id=eq.${companyId}&id=eq.${positionId}&select=*&limit=1`); if (!existing[0]) throw new HttpError(404,'Должность не найдена');
  const patch: Row = { updated_at:new Date().toISOString() }; if (input.name !== undefined) patch.name=text(input.name); if (input.description !== undefined) patch.description=text(input.description)||null;
  const rows=await db<Row[]>(env,`crm_access_positions?company_id=eq.${companyId}&id=eq.${positionId}`,{method:'PATCH',headers:{prefer:'return=representation'},body:JSON.stringify(patch)}); return rows[0];
}
async function savePositionPermissions(request: Request, env: AccessAdminEnv, companyId: string, positionId: string) {
  const input = record(await request.json().catch(() => ({}))); const list = Array.isArray(input.permissions) ? input.permissions.map(record) : [];
  for (const item of list) { const moduleId=text(item.moduleId||item.module_id); if (!moduleId) continue; await db(env,'crm_access_position_permissions?on_conflict=position_id,module_id',{method:'POST',headers:{prefer:'resolution=merge-duplicates,return=minimal'},body:JSON.stringify({position_id:positionId,company_id:companyId,module_id:moduleId,...permissionPayload(item)})}); }
  return {ok:true};
}
async function assignUser(request: Request, env: AccessAdminEnv, companyId: string, userId: string) {
  const input=record(await request.json().catch(() => ({}))); const positionId=text(input.positionId)||null; const jobTitle=text(input.jobTitle)||null;
  if (positionId && !uuid.test(positionId)) throw new HttpError(400,'Некорректная должность');
  const rows=await db<Row[]>(env,'crm_access_user_assignments?on_conflict=company_id,user_id&select=*',{method:'POST',headers:{prefer:'resolution=merge-duplicates,return=representation'},body:JSON.stringify({company_id:companyId,user_id:userId,position_id:positionId,job_title:jobTitle,updated_by:actorId(request),updated_at:new Date().toISOString()})}); return rows[0];
}
async function saveOverrides(request: Request, env: AccessAdminEnv, companyId: string, userId: string) {
  const input=record(await request.json().catch(() => ({}))); const list=Array.isArray(input.overrides)?input.overrides.map(record):[];
  await db(env,`crm_access_user_overrides?company_id=eq.${companyId}&user_id=eq.${userId}`,{method:'DELETE',headers:{prefer:'return=minimal'}});
  for (const item of list) { const moduleId=text(item.moduleId||item.module_id); if(!moduleId) continue; const payload=permissionPayload(item,true); if(Object.values(payload).every((v)=>v===null)) continue; await db(env,'crm_access_user_overrides',{method:'POST',headers:{prefer:'return=minimal'},body:JSON.stringify({company_id:companyId,user_id:userId,module_id:moduleId,...payload,updated_by:actorId(request)})}); }
  return {ok:true};
}
export async function handleAccessAdminRequest(request: Request, env: AccessAdminEnv, url: URL): Promise<Response|null> {
  if (!url.pathname.startsWith('/api/admin/access')) return null;
  try {
    const companyId=await requireAdmin(request,env);
    if(url.pathname==='/api/admin/access/workspace'&&request.method==='GET') return json(await workspace(env,companyId));
    if(url.pathname==='/api/admin/access/positions'&&request.method==='POST') return json({position:await createPosition(request,env,companyId)},201);
    const positionMatch=url.pathname.match(/^\/api\/admin\/access\/positions\/([0-9a-f-]+)(?:\/permissions)?$/i);
    if(positionMatch){const id=positionMatch[1]; if(request.method==='PATCH'&&!url.pathname.endsWith('/permissions')) return json({position:await updatePosition(request,env,companyId,id)}); if(request.method==='PUT'&&url.pathname.endsWith('/permissions')) return json(await savePositionPermissions(request,env,companyId,id));}
    const userMatch=url.pathname.match(/^\/api\/admin\/access\/users\/([0-9a-f-]+)\/(assignment|overrides)$/i);
    if(userMatch&&request.method==='PUT'){const [,userId,kind]=userMatch; if(kind==='assignment') return json({assignment:await assignUser(request,env,companyId,userId)}); return json(await saveOverrides(request,env,companyId,userId));}
    if(url.pathname==='/api/admin/access/me'&&request.method==='GET') return json(await resolveUserAccess(env,actorId(request),actorRole(request)));
    return json({error:'Method not allowed'},405);
  } catch(error){ if(error instanceof HttpError) return json({error:error.message},error.status); return json({error:error instanceof Error?error.message:String(error)},500); }
}
