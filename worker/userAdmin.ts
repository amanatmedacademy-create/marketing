import { resolveCompanyId } from './companyContext';
import { resolveUserAccess } from './accessControl';
import { handleAccessAdminRequest } from './accessAdmin';
import { localDataJson, type LocalDataEnv } from './localData';

type Row = Record<string, unknown>;
type ManagedRole = 'administrator' | 'manager' | 'marketer' | 'operator' | 'analyst' | 'viewer';
type MembershipRole = 'owner' | ManagedRole;
type ManagedStatus = 'active' | 'invited' | 'blocked';

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
const roles: ManagedRole[] = ['administrator', 'manager', 'marketer', 'operator', 'analyst', 'viewer'];
const statuses: ManagedStatus[] = ['active', 'invited', 'blocked'];

function currentUserId(request: Request): string { return text(request.headers.get('x-amanat-auth-user')); }
function currentRole(request: Request): string { return text(request.headers.get('x-amanat-auth-role')); }
async function db<T>(env: UserAdminEnv, path: string, init: RequestInit = {}): Promise<T> {
  try { return await localDataJson<T>(env, path, init, 'User administration'); }
  catch (error) { throw new HttpError(502, error instanceof Error ? error.message : String(error)); }
}
function roleValue(value: unknown, fallback: ManagedRole = 'viewer'): ManagedRole { const role = text(value) as ManagedRole; if (!role) return fallback; if (!roles.includes(role)) throw new HttpError(400, 'Неизвестная роль пользователя'); return role; }
function statusValue(value: unknown, fallback: ManagedStatus = 'active'): ManagedStatus { const status = text(value) as ManagedStatus; if (!status) return fallback; if (!statuses.includes(status)) throw new HttpError(400, 'Неизвестный статус пользователя'); return status; }
function randomCode(): string { return Array.from(crypto.getRandomValues(new Uint8Array(10)), (b) => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[b % 32]).join(''); }
async function sha256Hex(value: string): Promise<string> { const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))); return [...digest].map((b) => b.toString(16).padStart(2, '0')).join(''); }

async function actorMembership(env: UserAdminEnv, companyId: string, userId: string): Promise<Row | null> {
  const rows = await db<Row[]>(env, `crm_company_members?company_id=eq.${companyId}&user_id=eq.${userId}&status=eq.active&select=role,status&limit=1`);
  return rows[0] || null;
}

async function requireAdmin(request: Request, env: UserAdminEnv): Promise<{ companyId: string; actorRole: string; platformAdmin: boolean }> {
  const userId = currentUserId(request);
  if (!uuidPattern.test(userId)) throw new HttpError(401, 'Не удалось определить пользователя');
  const companyId = await resolveCompanyId(env, userId, currentRole(request) === 'super_admin' ? 'super_admin' : undefined);
  const platformAdmin = currentRole(request) === 'super_admin';
  const membership = platformAdmin ? null : await actorMembership(env, companyId, userId);
  const actorRole = platformAdmin ? 'super_admin' : text(membership?.role);
  if (!platformAdmin && !['owner', 'administrator'].includes(actorRole)) throw new HttpError(403, 'Управление командой доступно только владельцу или администратору');
  return { companyId, actorRole, platformAdmin };
}

async function readCompanyUser(env: UserAdminEnv, companyId: string, userId: string) {
  const memberships = await db<Row[]>(env, `crm_company_members?company_id=eq.${companyId}&user_id=eq.${userId}&select=*&limit=1`);
  const users = await db<Row[]>(env, `marketing_users?id=eq.${userId}&select=*&limit=1`);
  if (!memberships[0] || !users[0]) throw new HttpError(404, 'Пользователь не найден в клинике');
  return { user: users[0], membership: memberships[0] };
}
async function assignment(env: UserAdminEnv, companyId: string, userId: string) {
  const rows = await db<Row[]>(env, `crm_access_user_assignments?company_id=eq.${companyId}&user_id=eq.${userId}&select=position_id,job_title&limit=1`);
  return rows[0] || {};
}
function publicUser(user: Row, membership: Row, accessAssignment: Row = {}) {
  return {
    id: text(user.id), name: text(user.name) || text(user.full_name), email: text(user.email), role: text(membership.role) as MembershipRole, status: text(membership.status) as ManagedStatus,
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

async function listInvitations(env: UserAdminEnv, companyId: string) {
  const rows = await db<Row[]>(env, `crm_company_invitations?company_id=eq.${companyId}&select=id,email,phone,role,status,expires_at,created_at,updated_at&order=created_at.desc&limit=200`);
  const now = Date.now();
  return rows.map((row) => ({
    id: text(row.id), email: text(row.email), phone: text(row.phone) || null, role: text(row.role),
    status: text(row.status) === 'pending' && Date.parse(String(row.expires_at || '')) <= now ? 'expired' : text(row.status),
    expiresAt: row.expires_at || null, createdAt: row.created_at || null,
  }));
}

async function revokeInvitation(env: UserAdminEnv, companyId: string, invitationId: string) {
  const rows = await db<Row[]>(env, `crm_company_invitations?company_id=eq.${companyId}&id=eq.${invitationId}&select=id,join_code_id,status&limit=1`);
  const invitation = rows[0];
  if (!invitation) throw new HttpError(404, 'Приглашение не найдено');
  await db(env, `crm_company_invitations?id=eq.${invitationId}`, { method: 'PATCH', headers: { prefer: 'return=minimal' }, body: JSON.stringify({ status: 'revoked', revoked_at: new Date().toISOString(), updated_at: new Date().toISOString() }) });
  const joinCodeId = text(invitation.join_code_id);
  if (joinCodeId) await db(env, `crm_company_join_codes?id=eq.${joinCodeId}`, { method: 'PATCH', headers: { prefer: 'return=minimal' }, body: JSON.stringify({ active: false, updated_at: new Date().toISOString() }) });
  return { ok: true };
}

async function createInvitation(request: Request, env: UserAdminEnv, companyId: string) {
  const input = record(await request.json().catch(() => ({})));
  const email = text(input.email).toLowerCase();
  const phone = text(input.phone) || null;
  const role = roleValue(input.role);
  if (!emailPattern.test(email)) throw new HttpError(400, 'Укажите корректный email');
  const existingMembers = await db<Row[]>(env, `marketing_users?email=ilike.${encodeURIComponent(email)}&select=id&limit=1`);
  if (existingMembers[0]) {
    const membership = await db<Row[]>(env, `crm_company_members?company_id=eq.${companyId}&user_id=eq.${text(existingMembers[0].id)}&status=eq.active&select=user_id&limit=1`);
    if (membership.length) throw new HttpError(409, 'Пользователь уже состоит в клинике');
  }
  const oldInvites = await db<Row[]>(env, `crm_company_invitations?company_id=eq.${companyId}&email=ilike.${encodeURIComponent(email)}&status=eq.pending&select=id,join_code_id`);
  for (const old of oldInvites) await revokeInvitation(env, companyId, text(old.id));

  const code = randomCode();
  const codeHash = await sha256Hex(code);
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const joinRows = await db<Row[]>(env, 'crm_company_join_codes', { method: 'POST', headers: { prefer: 'return=representation' }, body: JSON.stringify({ company_id: companyId, code_hash: codeHash, label: `Invitation: ${email}`, active: true, expires_at: expiresAt, max_uses: 1, created_by: currentUserId(request) }) });
  const joinCodeId = text(joinRows[0]?.id);
  if (!joinCodeId) throw new HttpError(502, 'Не удалось создать код приглашения');
  const rows = await db<Row[]>(env, 'crm_company_invitations', { method: 'POST', headers: { prefer: 'return=representation' }, body: JSON.stringify({ company_id: companyId, email, phone, role, status: 'pending', code_hash: codeHash, join_code_id: joinCodeId, invited_by: currentUserId(request), expires_at: expiresAt }) });
  const row = rows[0];
  if (!row) throw new HttpError(502, 'Не удалось создать приглашение');
  return { invitation: { id: text(row.id), email, phone, role, status: 'pending', expiresAt }, code };
}

async function listOnboarding(env: UserAdminEnv, companyId: string) {
  const rows = await db<Row[]>(env, `crm_company_onboarding?company_id=eq.${companyId}&status=in.(needs_profile,pending_approval,rejected)&select=*&order=updated_at.desc&limit=200`);
  if (!rows.length) return [];
  const ids = rows.map((row) => text(row.user_id)).filter((id) => uuidPattern.test(id));
  const users = ids.length ? await db<Row[]>(env, `marketing_users?id=in.(${ids.join(',')})&select=id,name,full_name,email,avatar_url`) : [];
  const userMap = new Map(users.map((row) => [text(row.id), row]));
  const invites = await db<Row[]>(env, `crm_company_invitations?company_id=eq.${companyId}&status=eq.pending&select=id,email,role`);
  const inviteMap = new Map(invites.map((row) => [text(row.email).toLowerCase(), row]));
  return rows.map((row) => {
    const user = userMap.get(text(row.user_id)) || {};
    const invite = inviteMap.get(text(user.email).toLowerCase());
    return {
      id: text(row.id), userId: text(row.user_id), name: text(row.full_name) || text(user.name) || text(user.full_name), email: text(user.email), phone: text(row.phone) || null,
      position: text(row.position) || null, notes: text(row.notes) || null, status: text(row.status), requestedRole: text(invite?.role) || text(row.requested_role) || 'viewer', rejectionReason: text(row.rejection_reason) || null,
      submittedAt: row.submitted_at || null, updatedAt: row.updated_at || null,
    };
  });
}

async function approveOnboarding(request: Request, env: UserAdminEnv, companyId: string, onboardingId: string) {
  const input = record(await request.json().catch(() => ({})));
  const rows = await db<Row[]>(env, `crm_company_onboarding?company_id=eq.${companyId}&id=eq.${onboardingId}&select=*&limit=1`);
  const onboarding = rows[0];
  if (!onboarding) throw new HttpError(404, 'Заявка не найдена');
  if (!['needs_profile', 'pending_approval', 'rejected'].includes(text(onboarding.status))) throw new HttpError(409, 'Заявка уже обработана');
  const userId = text(onboarding.user_id);
  const users = await db<Row[]>(env, `marketing_users?id=eq.${userId}&select=email&limit=1`);
  const email = text(users[0]?.email).toLowerCase();
  const invitations = email ? await db<Row[]>(env, `crm_company_invitations?company_id=eq.${companyId}&email=ilike.${encodeURIComponent(email)}&status=eq.pending&select=id,role&limit=1`) : [];
  const role = roleValue(input.role, roleValue(invitations[0]?.role || onboarding.requested_role));
  await db(env, `crm_company_members?company_id=eq.${companyId}&user_id=eq.${userId}`, { method: 'PATCH', headers: { prefer: 'return=minimal' }, body: JSON.stringify({ role, status: 'active' }) });
  await db(env, `crm_company_onboarding?id=eq.${onboardingId}`, { method: 'PATCH', headers: { prefer: 'return=minimal' }, body: JSON.stringify({ status: 'approved', requested_role: role, reviewed_at: new Date().toISOString(), reviewed_by: currentUserId(request), rejection_reason: null, updated_at: new Date().toISOString() }) });
  if (invitations[0]) await db(env, `crm_company_invitations?id=eq.${text(invitations[0].id)}`, { method: 'PATCH', headers: { prefer: 'return=minimal' }, body: JSON.stringify({ status: 'accepted', accepted_by: userId, accepted_at: new Date().toISOString(), updated_at: new Date().toISOString() }) });
  return { ok: true, userId, role };
}

async function rejectOnboarding(request: Request, env: UserAdminEnv, companyId: string, onboardingId: string) {
  const input = record(await request.json().catch(() => ({})));
  const reason = text(input.reason) || 'Отклонено администратором';
  const rows = await db<Row[]>(env, `crm_company_onboarding?company_id=eq.${companyId}&id=eq.${onboardingId}&select=user_id&limit=1`);
  if (!rows[0]) throw new HttpError(404, 'Заявка не найдена');
  const userId = text(rows[0].user_id);
  await db(env, `crm_company_members?company_id=eq.${companyId}&user_id=eq.${userId}`, { method: 'PATCH', headers: { prefer: 'return=minimal' }, body: JSON.stringify({ status: 'invited' }) });
  await db(env, `crm_company_onboarding?id=eq.${onboardingId}`, { method: 'PATCH', headers: { prefer: 'return=minimal' }, body: JSON.stringify({ status: 'rejected', reviewed_at: new Date().toISOString(), reviewed_by: currentUserId(request), rejection_reason: reason, updated_at: new Date().toISOString() }) });
  return { ok: true };
}

async function updateUser(request: Request, env: UserAdminEnv, companyId: string, targetId: string, actorRole: string, platformAdmin: boolean) {
  const { user, membership } = await readCompanyUser(env, companyId, targetId);
  const input = record(await request.json().catch(() => ({})));
  const existingRole = text(membership.role) as MembershipRole;
  if (existingRole === 'owner' && !platformAdmin) throw new HttpError(403, 'Роль владельца меняется только через передачу владения');
  const role = input.role === undefined ? (existingRole === 'owner' ? 'administrator' : roleValue(existingRole)) : roleValue(input.role);
  const status = input.status === undefined ? statusValue(membership.status) : statusValue(input.status);
  if (targetId === currentUserId(request) && status !== 'active') throw new HttpError(400, 'Нельзя заблокировать собственный доступ');
  if (actorRole !== 'owner' && !platformAdmin && role === 'administrator' && existingRole !== 'administrator') throw new HttpError(403, 'Назначать администраторов может только владелец');
  const updatedMemberships = await db<Row[]>(env, `crm_company_members?company_id=eq.${companyId}&user_id=eq.${targetId}`, { method: 'PATCH', headers: { prefer: 'return=representation' }, body: JSON.stringify({ role, status }) });
  return publicUser(user, updatedMemberships[0] || membership, await assignment(env, companyId, targetId));
}

async function removeUser(request: Request, env: UserAdminEnv, companyId: string, targetId: string, platformAdmin: boolean) {
  if (targetId === currentUserId(request)) throw new HttpError(400, 'Нельзя удалить собственный доступ');
  const { membership } = await readCompanyUser(env, companyId, targetId);
  if (text(membership.role) === 'owner' && !platformAdmin) throw new HttpError(403, 'Сначала передайте владение другому пользователю');
  await db(env, `crm_company_members?company_id=eq.${companyId}&user_id=eq.${targetId}`, { method: 'DELETE', headers: { prefer: 'return=minimal' } });
  return { ok: true, id: targetId };
}

async function transferOwnership(request: Request, env: UserAdminEnv, companyId: string, targetId: string, actorRole: string, platformAdmin: boolean) {
  if (!platformAdmin && actorRole !== 'owner') throw new HttpError(403, 'Передавать владение может только владелец');
  const target = await readCompanyUser(env, companyId, targetId);
  if (text(target.membership.status) !== 'active') throw new HttpError(400, 'Новый владелец должен быть активным участником клиники');
  const rows = await db<Row[]>(env, 'rpc/imds_transfer_company_ownership', { method: 'POST', headers: { prefer: 'return=representation' }, body: JSON.stringify({ p_company_id: companyId, p_actor_user_id: currentUserId(request), p_new_owner_user_id: targetId, p_platform_override: platformAdmin }) });
  return rows[0] || { ok: true, ownerId: targetId };
}

export async function handleUserAdminRequest(request: Request, env: UserAdminEnv, url: URL): Promise<Response | null> {
  if (!url.pathname.startsWith('/api/admin/users')) return null;
  try {
    if (url.pathname === '/api/admin/users/access/me' && request.method === 'GET') return json(await resolveUserAccess(env, currentUserId(request), currentRole(request)));
    if (url.pathname.startsWith('/api/admin/users/access')) {
      const rewritten = new URL(url.toString()); rewritten.pathname = url.pathname.replace('/api/admin/users/access', '/api/admin/access');
      return handleAccessAdminRequest(request, env, rewritten);
    }
    const { companyId, actorRole, platformAdmin } = await requireAdmin(request, env);
    if (url.pathname === '/api/admin/users' && request.method === 'GET') return json({ users: await listUsers(env, companyId), loginMode: 'native' });

    if (url.pathname === '/api/admin/users/invitations') {
      if (request.method === 'GET') return json({ invitations: await listInvitations(env, companyId) });
      if (request.method === 'POST') return json(await createInvitation(request, env, companyId), 201);
    }
    const inviteMatch = url.pathname.match(/^\/api\/admin\/users\/invitations\/([0-9a-f-]+)(?:\/(resend))?$/i);
    if (inviteMatch) {
      const id = inviteMatch[1];
      if (request.method === 'DELETE') return json(await revokeInvitation(env, companyId, id));
      if (request.method === 'POST' && inviteMatch[2] === 'resend') {
        const rows = await db<Row[]>(env, `crm_company_invitations?company_id=eq.${companyId}&id=eq.${id}&select=email,phone,role&limit=1`);
        if (!rows[0]) throw new HttpError(404, 'Приглашение не найдено');
        await revokeInvitation(env, companyId, id);
        const retry = new Request(request.url, { method: 'POST', headers: request.headers, body: JSON.stringify({ email: rows[0].email, phone: rows[0].phone, role: rows[0].role }) });
        return json(await createInvitation(retry, env, companyId), 201);
      }
    }

    if (url.pathname === '/api/admin/users/onboarding' && request.method === 'GET') return json({ onboarding: await listOnboarding(env, companyId) });
    const onboardingMatch = url.pathname.match(/^\/api\/admin\/users\/onboarding\/([0-9a-f-]+)\/(approve|reject)$/i);
    if (onboardingMatch && request.method === 'POST') {
      return json(onboardingMatch[2] === 'approve' ? await approveOnboarding(request, env, companyId, onboardingMatch[1]) : await rejectOnboarding(request, env, companyId, onboardingMatch[1]));
    }

    const transferMatch = url.pathname.match(/^\/api\/admin\/users\/([0-9a-f-]+)\/transfer-ownership$/i);
    if (transferMatch && request.method === 'POST') return json(await transferOwnership(request, env, companyId, transferMatch[1], actorRole, platformAdmin));

    const targetId = decodeURIComponent(url.pathname.slice('/api/admin/users/'.length));
    if (!uuidPattern.test(targetId)) throw new HttpError(400, 'Некорректный ID пользователя');
    if (request.method === 'PATCH') return json({ user: await updateUser(request, env, companyId, targetId, actorRole, platformAdmin) });
    if (request.method === 'DELETE') return json(await removeUser(request, env, companyId, targetId, platformAdmin));
    return json({ error: 'Method not allowed' }, 405);
  } catch (error) {
    if (error instanceof HttpError) return json({ error: error.message }, error.status);
    return json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
}
