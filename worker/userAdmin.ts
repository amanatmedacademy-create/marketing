import { resolveCompanyId } from './companyContext';
import { resolveUserAccess } from './accessControl';
import { handleAccessAdminRequest } from './accessAdmin';
import { localDataJson, type LocalDataEnv } from './localData';

type Row = Record<string, unknown>;
type ManagedRole = 'administrator' | 'marketer' | 'analyst' | 'viewer';
type ManagedStatus = 'active' | 'invited' | 'blocked';
type MembershipRole = 'owner' | 'administrator' | 'manager' | 'viewer';

export interface UserAdminEnv extends LocalDataEnv {
  DEFAULT_COMPANY_ID?: string;
  CURRENT_COMPANY_ID?: string;
}

class HttpError extends Error { constructor(readonly status: number, message: string) { super(message); } }
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
const text = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
const record = (value: unknown): Row => value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {};
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const roles: ManagedRole[] = ['administrator', 'marketer', 'analyst', 'viewer'];
const statuses: ManagedStatus[] = ['active', 'invited', 'blocked'];

function currentUserId(request: Request): string { return text(request.headers.get('x-amanat-auth-user')); }
function currentRole(request: Request): string { return text(request.headers.get('x-amanat-auth-role')); }
async function db<T>(env: UserAdminEnv, path: string, init: RequestInit = {}): Promise<T> {
  try { return await localDataJson<T>(env, path, init, 'User administration'); }
  catch (error) { throw new HttpError(502, error instanceof Error ? error.message : String(error)); }
}
function roleValue(value: unknown, fallback: ManagedRole = 'viewer'): ManagedRole { const role = text(value) as ManagedRole; if (!role) return fallback; if (!roles.includes(role)) throw new HttpError(400, 'Неизвестная роль пользователя'); return role; }
function statusValue(value: unknown, fallback: ManagedStatus = 'active'): ManagedStatus { const status = text(value) as ManagedStatus; if (!status) return fallback; if (!statuses.includes(status)) throw new HttpError(400, 'Неизвестный статус пользователя'); return status; }
function membershipRole(role: ManagedRole, existing?: MembershipRole): MembershipRole { if (role === 'administrator') return existing === 'owner' ? 'owner' : 'administrator'; if (role === 'marketer') return 'manager'; return 'viewer'; }
async function requireAdmin(request: Request, env: UserAdminEnv): Promise<string> {
  if (!['administrator', 'super_admin'].includes(currentRole(request))) throw new HttpError(403, 'Управление пользователями доступно только администратору');
  const userId = currentUserId(request); if (!uuidPattern.test(userId)) throw new HttpError(401, 'Не удалось определить пользователя');
  const companyId = await resolveCompanyId(env, userId);
  const rows = await db<Row[]>(env, `crm_company_members?company_id=eq.${companyId}&user_id=eq.${userId}&status=eq.active&role=in.(owner,administrator)&select=user_id`);
  if (!rows.length && currentRole(request) !== 'super_admin') throw new HttpError(403, 'Нет административных прав в текущей компании');
  return companyId;
}
async function readCompanyUser(env: UserAdminEnv, companyId: string, userId: string) {
  const memberships = await db<Row[]>(env, `crm_company_members?company_id=eq.${companyId}&user_id=eq.${userId}&select=*&limit=1`);
  const users = await db<Row[]>(env, `marketing_users?id=eq.${userId}&select=*&limit=1`);
  if (!memberships[0] || !users[0]) throw new HttpError(404, 'Пользователь не найден в компании');
  return { user: users[0], membership: memberships[0] };
}
async function assignment(env: UserAdminEnv, companyId: string, userId: string) {
  const rows = await db<Row[]>(env, `crm_access_user_assignments?company_id=eq.${companyId}&user_id=eq.${userId}&select=position_id,job_title&limit=1`);
  return rows[0] || {};
}
function publicUser(user: Row, membership: Row, accessAssignment: Row = {}) {
  return {
    id: text(user.id), name: text(user.name), email: text(user.email), role: text(user.role), status: text(membership.status),
    membershipRole: text(membership.role), connected: Boolean(user.auth_user_id), avatarUrl: user.avatar_url || null,
    lastSeenAt: user.last_seen_at || null, createdAt: membership.created_at || user.created_at,
    positionId: accessAssignment.position_id || null, jobTitle: accessAssignment.job_title || null,
  };
}
async function listUsers(env: UserAdminEnv, companyId: string) {
  const memberships = await db<Row[]>(env, `crm_company_members?company_id=eq.${companyId}&select=*&order=created_at.asc`);
  if (!memberships.length) return [];
  const ids = memberships.map((row) => text(row.user_id)).filter((id) => uuidPattern.test(id));
  const [users, assignments] = await Promise.all([
    db<Row[]>(env, `marketing_users?id=in.(${ids.join(',')})&select=*`),
    db<Row[]>(env, `crm_access_user_assignments?company_id=eq.${companyId}&select=*`),
  ]);
  const userMap = new Map(users.map((row) => [text(row.id), row]));
  const assignmentMap = new Map(assignments.map((row) => [text(row.user_id), row]));
  return memberships.flatMap((membership) => { const id = text(membership.user_id); const user = userMap.get(id); return user ? [publicUser(user, membership, assignmentMap.get(id))] : []; });
}
async function activeAdminCount(env: UserAdminEnv, companyId: string) { const rows = await db<Row[]>(env, `crm_company_members?company_id=eq.${companyId}&status=eq.active&role=in.(owner,administrator)&select=user_id`); return rows.length; }
async function createUser(request: Request, env: UserAdminEnv, companyId: string) {
  const input = record(await request.json().catch(() => ({}))); const name = text(input.name); const email = text(input.email).toLowerCase(); const role = roleValue(input.role); const status = statusValue(input.status);
  if (name.length < 2) throw new HttpError(400, 'Укажите имя пользователя'); if (!emailPattern.test(email)) throw new HttpError(400, 'Укажите корректный email');
  const found = await db<Row[]>(env, `marketing_users?email=ilike.${encodeURIComponent(email)}&select=*&limit=1`); let user = found[0];
  if (user) {
    const exists = await db<Row[]>(env, `crm_company_members?company_id=eq.${companyId}&user_id=eq.${text(user.id)}&select=user_id`); if (exists.length) throw new HttpError(409, 'Пользователь уже добавлен');
    const updated = await db<Row[]>(env, `marketing_users?id=eq.${text(user.id)}`, { method:'PATCH', headers:{prefer:'return=representation'}, body:JSON.stringify({name,role,status,updated_at:new Date().toISOString()}) }); user = updated[0] || user;
  } else {
    const created = await db<Row[]>(env, 'marketing_users', { method:'POST', headers:{prefer:'return=representation'}, body:JSON.stringify({auth_user_id:null,name,email,role,status,provider:'password',provider_metadata:{manually_added:true,added_by:currentUserId(request)}}) }); user = created[0];
  }
  if (!user) throw new HttpError(502, 'Не удалось создать пользователя');
  const memberships = await db<Row[]>(env, 'crm_company_members', { method:'POST', headers:{prefer:'return=representation'}, body:JSON.stringify({company_id:companyId,user_id:user.id,role:membershipRole(role),status}) });
  return publicUser(user, memberships[0], await assignment(env, companyId, text(user.id)));
}
async function updateUser(request: Request, env: UserAdminEnv, companyId: string, targetId: string) {
  const { user, membership } = await readCompanyUser(env, companyId, targetId); const input = record(await request.json().catch(() => ({})));
  const name = input.name === undefined ? text(user.name) : text(input.name); const role = input.role === undefined ? roleValue(user.role) : roleValue(input.role); const status = input.status === undefined ? statusValue(membership.status) : statusValue(input.status);
  if (targetId === currentUserId(request) && (role !== 'administrator' || status !== 'active')) throw new HttpError(400, 'Нельзя снять собственные права или заблокировать себя');
  const nextMembershipRole = membershipRole(role, text(membership.role) as MembershipRole); const wasAdmin = text(membership.status) === 'active' && ['owner','administrator'].includes(text(membership.role)); const remainsAdmin = status === 'active' && ['owner','administrator'].includes(nextMembershipRole);
  if (wasAdmin && !remainsAdmin && await activeAdminCount(env, companyId) <= 1) throw new HttpError(400, 'Должен остаться хотя бы один администратор');
  const updatedUsers = await db<Row[]>(env, `marketing_users?id=eq.${targetId}`, { method:'PATCH', headers:{prefer:'return=representation'}, body:JSON.stringify({name,role,status,updated_at:new Date().toISOString()}) });
  const updatedMemberships = await db<Row[]>(env, `crm_company_members?company_id=eq.${companyId}&user_id=eq.${targetId}`, { method:'PATCH', headers:{prefer:'return=representation'}, body:JSON.stringify({role:nextMembershipRole,status}) });
  return publicUser(updatedUsers[0] || user, updatedMemberships[0] || membership, await assignment(env, companyId, targetId));
}
async function removeUser(request: Request, env: UserAdminEnv, companyId: string, targetId: string) {
  if (targetId === currentUserId(request)) throw new HttpError(400, 'Нельзя удалить собственный доступ'); const { membership } = await readCompanyUser(env, companyId, targetId);
  if (text(membership.status) === 'active' && ['owner','administrator'].includes(text(membership.role)) && await activeAdminCount(env, companyId) <= 1) throw new HttpError(400, 'Должен остаться хотя бы один администратор');
  await db(env, `crm_company_members?company_id=eq.${companyId}&user_id=eq.${targetId}`, { method:'DELETE', headers:{prefer:'return=minimal'} }); return {ok:true,id:targetId};
}

export async function handleUserAdminRequest(request: Request, env: UserAdminEnv, url: URL): Promise<Response | null> {
  if (!url.pathname.startsWith('/api/admin/users')) return null;
  try {
    if (url.pathname === '/api/admin/users/access/me' && request.method === 'GET') return json(await resolveUserAccess(env, currentUserId(request), currentRole(request)));
    if (url.pathname.startsWith('/api/admin/users/access')) {
      const rewritten = new URL(url.toString()); rewritten.pathname = url.pathname.replace('/api/admin/users/access', '/api/admin/access');
      return handleAccessAdminRequest(request, env, rewritten);
    }
    const companyId = await requireAdmin(request, env);
    if (url.pathname === '/api/admin/users') {
      if (request.method === 'GET') return json({ users: await listUsers(env, companyId), loginMode:'native' });
      if (request.method === 'POST') return json({ user: await createUser(request, env, companyId) }, 201);
      return json({error:'Method not allowed'},405);
    }
    const targetId = decodeURIComponent(url.pathname.slice('/api/admin/users/'.length)); if (!uuidPattern.test(targetId)) throw new HttpError(400, 'Некорректный ID пользователя');
    if (request.method === 'PATCH') return json({user:await updateUser(request,env,companyId,targetId)});
    if (request.method === 'DELETE') return json(await removeUser(request,env,companyId,targetId));
    return json({error:'Method not allowed'},405);
  } catch (error) { if (error instanceof HttpError) return json({error:error.message},error.status); return json({error:error instanceof Error?error.message:String(error)},500); }
}
