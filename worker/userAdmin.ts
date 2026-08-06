import { resolveCompanyId } from './companyContext';

type JsonRecord = Record<string, unknown>;

type ManagedRole = 'administrator' | 'marketer' | 'analyst' | 'viewer';
type ManagedStatus = 'active' | 'invited' | 'blocked';
type MembershipRole = 'owner' | 'administrator' | 'manager' | 'viewer';

export interface UserAdminEnv {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  DEFAULT_COMPANY_ID?: string;
}

interface MarketingUserRow {
  id: string;
  auth_user_id?: string | null;
  name: string;
  email: string;
  role: ManagedRole;
  status: ManagedStatus;
  avatar_url?: string | null;
  last_seen_at?: string | null;
  created_at: string;
  updated_at: string;
}

interface MembershipRow {
  company_id: string;
  user_id: string;
  role: MembershipRole;
  status: ManagedStatus;
  created_at: string;
}

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});

const text = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
const record = (value: unknown): JsonRecord => value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {};
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const roles: ManagedRole[] = ['administrator', 'marketer', 'analyst', 'viewer'];
const statuses: ManagedStatus[] = ['active', 'invited', 'blocked'];

function currentUserId(request: Request): string {
  return text(request.headers.get('x-amanat-auth-user'));
}

function isAdministrator(request: Request): boolean {
  return text(request.headers.get('x-amanat-auth-role')) === 'administrator';
}

function roleValue(value: unknown, fallback: ManagedRole = 'viewer'): ManagedRole {
  const role = text(value) as ManagedRole;
  if (!roles.includes(role)) throw new HttpError(400, 'Неизвестная роль пользователя');
  return role || fallback;
}

function statusValue(value: unknown, fallback: ManagedStatus = 'active'): ManagedStatus {
  const status = text(value) as ManagedStatus;
  if (!statuses.includes(status)) throw new HttpError(400, 'Неизвестный статус пользователя');
  return status || fallback;
}

function membershipRole(role: ManagedRole, existing?: MembershipRole): MembershipRole {
  if (role === 'administrator') return existing === 'owner' ? 'owner' : 'administrator';
  if (role === 'marketer') return 'manager';
  return 'viewer';
}

function headers(env: UserAdminEnv, extra: HeadersInit = {}): HeadersInit {
  return {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    'content-type': 'application/json',
    ...extra,
  };
}

async function db<T>(env: UserAdminEnv, path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/${path}`, {
    ...init,
    headers: headers(env, init.headers),
  });
  const body = await response.text();
  if (!response.ok) throw new HttpError(502, `Supabase users: ${response.status} ${body.slice(0, 800)}`);
  return (body ? JSON.parse(body) : null) as T;
}

async function adminCompanyId(request: Request, env: UserAdminEnv): Promise<string> {
  if (!isAdministrator(request)) throw new HttpError(403, 'Управление пользователями доступно только администратору');
  const userId = currentUserId(request);
  if (!uuidPattern.test(userId)) throw new HttpError(401, 'Не удалось определить текущего пользователя');
  const companyId = await resolveCompanyId(env);
  const memberships = await db<MembershipRow[]>(
    env,
    `crm_company_members?company_id=eq.${encodeURIComponent(companyId)}&user_id=eq.${encodeURIComponent(userId)}&status=eq.active&role=in.(owner,administrator)&select=*`,
  );
  if (!memberships.length) throw new HttpError(403, 'Нет прав администратора в текущей компании');
  return companyId;
}

function publicUser(user: MarketingUserRow, membership: MembershipRow) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    status: membership.status,
    membershipRole: membership.role,
    connected: Boolean(user.auth_user_id),
    avatarUrl: user.avatar_url || null,
    lastSeenAt: user.last_seen_at || null,
    createdAt: membership.created_at || user.created_at,
  };
}

async function readCompanyUser(env: UserAdminEnv, companyId: string, userId: string) {
  const memberships = await db<MembershipRow[]>(
    env,
    `crm_company_members?company_id=eq.${encodeURIComponent(companyId)}&user_id=eq.${encodeURIComponent(userId)}&select=*&limit=1`,
  );
  const membership = memberships[0];
  if (!membership) throw new HttpError(404, 'Пользователь не найден в текущей компании');
  const users = await db<MarketingUserRow[]>(env, `marketing_users?id=eq.${encodeURIComponent(userId)}&select=*&limit=1`);
  const user = users[0];
  if (!user) throw new HttpError(404, 'Профиль пользователя не найден');
  return { user, membership };
}

async function listUsers(env: UserAdminEnv, companyId: string) {
  const memberships = await db<MembershipRow[]>(
    env,
    `crm_company_members?company_id=eq.${encodeURIComponent(companyId)}&select=*&order=created_at.asc`,
  );
  if (!memberships.length) return [];
  const ids = memberships.map((item) => item.user_id).filter((item) => uuidPattern.test(item));
  const users = await db<MarketingUserRow[]>(env, `marketing_users?id=in.(${ids.join(',')})&select=*`);
  const byId = new Map(users.map((user) => [user.id, user]));
  return memberships.flatMap((membership) => {
    const user = byId.get(membership.user_id);
    return user ? [publicUser(user, membership)] : [];
  });
}

async function activeAdminCount(env: UserAdminEnv, companyId: string): Promise<number> {
  const rows = await db<Array<{ user_id: string }>>(
    env,
    `crm_company_members?company_id=eq.${encodeURIComponent(companyId)}&status=eq.active&role=in.(owner,administrator)&select=user_id`,
  );
  return rows.length;
}

async function createUser(request: Request, env: UserAdminEnv, companyId: string) {
  const input = record(await request.json().catch(() => ({})));
  const name = text(input.name);
  const email = text(input.email).toLowerCase();
  const role = roleValue(input.role, 'viewer');
  const status = statusValue(input.status, 'active');
  if (name.length < 2) throw new HttpError(400, 'Укажите имя пользователя');
  if (!emailPattern.test(email)) throw new HttpError(400, 'Укажите корректный email');

  const existingUsers = await db<MarketingUserRow[]>(
    env,
    `marketing_users?email=ilike.${encodeURIComponent(email)}&select=*&limit=1`,
  );
  let user = existingUsers[0];

  if (user) {
    const existingMembership = await db<MembershipRow[]>(
      env,
      `crm_company_members?company_id=eq.${encodeURIComponent(companyId)}&user_id=eq.${encodeURIComponent(user.id)}&select=*&limit=1`,
    );
    if (existingMembership.length) throw new HttpError(409, 'Пользователь с таким email уже добавлен');
    const updated = await db<MarketingUserRow[]>(env, `marketing_users?id=eq.${encodeURIComponent(user.id)}`, {
      method: 'PATCH',
      headers: { prefer: 'return=representation' },
      body: JSON.stringify({ name, role, status, updated_at: new Date().toISOString() }),
    });
    user = updated[0] || user;
  } else {
    const created = await db<MarketingUserRow[]>(env, 'marketing_users', {
      method: 'POST',
      headers: { prefer: 'return=representation' },
      body: JSON.stringify({
        auth_user_id: null,
        name,
        email,
        role,
        status,
        provider: 'google',
        provider_metadata: {
          manually_added: true,
          added_by: currentUserId(request),
          added_at: new Date().toISOString(),
        },
      }),
    });
    user = created[0];
  }

  if (!user) throw new HttpError(502, 'Не удалось создать профиль пользователя');
  const membershipRows = await db<MembershipRow[]>(env, 'crm_company_members', {
    method: 'POST',
    headers: { prefer: 'return=representation' },
    body: JSON.stringify({
      company_id: companyId,
      user_id: user.id,
      role: membershipRole(role),
      status,
    }),
  });
  const membership = membershipRows[0];
  if (!membership) throw new HttpError(502, 'Не удалось привязать пользователя к компании');
  return publicUser(user, membership);
}

async function updateUser(request: Request, env: UserAdminEnv, companyId: string, targetId: string) {
  const { user, membership } = await readCompanyUser(env, companyId, targetId);
  const input = record(await request.json().catch(() => ({})));
  const name = input.name === undefined ? user.name : text(input.name);
  const role = input.role === undefined ? user.role : roleValue(input.role);
  const status = input.status === undefined ? membership.status : statusValue(input.status);
  if (name.length < 2) throw new HttpError(400, 'Укажите имя пользователя');

  const actorId = currentUserId(request);
  if (targetId === actorId && (role !== 'administrator' || status !== 'active')) {
    throw new HttpError(400, 'Нельзя снять собственные права администратора или заблокировать себя');
  }

  const nextMembershipRole = membershipRole(role, membership.role);
  const wasAdmin = membership.status === 'active' && ['owner', 'administrator'].includes(membership.role);
  const remainsAdmin = status === 'active' && ['owner', 'administrator'].includes(nextMembershipRole);
  if (wasAdmin && !remainsAdmin && await activeAdminCount(env, companyId) <= 1) {
    throw new HttpError(400, 'В компании должен остаться хотя бы один активный администратор');
  }

  const updatedUsers = await db<MarketingUserRow[]>(env, `marketing_users?id=eq.${encodeURIComponent(targetId)}`, {
    method: 'PATCH',
    headers: { prefer: 'return=representation' },
    body: JSON.stringify({ name, role, status, updated_at: new Date().toISOString() }),
  });
  const updatedMemberships = await db<MembershipRow[]>(
    env,
    `crm_company_members?company_id=eq.${encodeURIComponent(companyId)}&user_id=eq.${encodeURIComponent(targetId)}`,
    {
      method: 'PATCH',
      headers: { prefer: 'return=representation' },
      body: JSON.stringify({ role: nextMembershipRole, status }),
    },
  );
  return publicUser(updatedUsers[0] || { ...user, name, role, status }, updatedMemberships[0] || { ...membership, role: nextMembershipRole, status });
}

async function removeUser(request: Request, env: UserAdminEnv, companyId: string, targetId: string) {
  if (targetId === currentUserId(request)) throw new HttpError(400, 'Нельзя удалить собственный доступ');
  const { membership } = await readCompanyUser(env, companyId, targetId);
  const wasAdmin = membership.status === 'active' && ['owner', 'administrator'].includes(membership.role);
  if (wasAdmin && await activeAdminCount(env, companyId) <= 1) {
    throw new HttpError(400, 'В компании должен остаться хотя бы один активный администратор');
  }

  await db<unknown>(
    env,
    `crm_company_members?company_id=eq.${encodeURIComponent(companyId)}&user_id=eq.${encodeURIComponent(targetId)}`,
    { method: 'DELETE', headers: { prefer: 'return=minimal' } },
  );
  const remaining = await db<Array<{ company_id: string }>>(
    env,
    `crm_company_members?user_id=eq.${encodeURIComponent(targetId)}&select=company_id&limit=1`,
  );
  if (!remaining.length) {
    await db<unknown>(env, `marketing_users?id=eq.${encodeURIComponent(targetId)}`, {
      method: 'PATCH',
      headers: { prefer: 'return=minimal' },
      body: JSON.stringify({ status: 'blocked', updated_at: new Date().toISOString() }),
    });
  }
  return { ok: true, id: targetId };
}

export async function handleUserAdminRequest(request: Request, env: UserAdminEnv, url: URL): Promise<Response | null> {
  if (url.pathname !== '/api/admin/users' && !url.pathname.startsWith('/api/admin/users/')) return null;
  try {
    const companyId = await adminCompanyId(request, env);
    if (url.pathname === '/api/admin/users') {
      if (request.method === 'GET') return json({ users: await listUsers(env, companyId), loginMode: 'google_email_match' });
      if (request.method === 'POST') return json({ user: await createUser(request, env, companyId), loginMode: 'google_email_match' }, 201);
      return json({ error: 'Method not allowed' }, 405);
    }

    const targetId = decodeURIComponent(url.pathname.slice('/api/admin/users/'.length));
    if (!uuidPattern.test(targetId)) throw new HttpError(400, 'Некорректный ID пользователя');
    if (request.method === 'PATCH') return json({ user: await updateUser(request, env, companyId, targetId) });
    if (request.method === 'DELETE') return json(await removeUser(request, env, companyId, targetId));
    return json({ error: 'Method not allowed' }, 405);
  } catch (error) {
    if (error instanceof HttpError) return json({ error: error.message }, error.status);
    return json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
}
