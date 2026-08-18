import { resolveTenantMembershipRole } from './accessControl';
import { resolveCompanyId, type PlatformRole } from './companyContext';
import { localDataJson, localDataRequest, type LocalDataEnv } from './localData';
import { ALL_BRANCHES } from './tenantScope';

type Row = Record<string, unknown>;
export interface BranchManagementEnv extends LocalDataEnv { CURRENT_COMPANY_ID?: string; DEFAULT_COMPANY_ID?: string; CURRENT_BRANCH_ID?: string }
export type BranchSummary = {
  id: string; companyId: string; name: string; code: string | null; status: string; isPrimary: boolean;
  city: string | null; address: string | null; phone: string | null; timezone: string; memberCount: number;
};
const text = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
const num = (value: unknown): number => Number(value || 0) || 0;
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function canManage(env: BranchManagementEnv, userId: string, platformRole?: PlatformRole): Promise<boolean> {
  if (platformRole === 'super_admin') return true;
  const role = await resolveTenantMembershipRole(env, userId);
  return role === 'owner' || role === 'administrator';
}

async function listBranches(env: BranchManagementEnv, companyId: string): Promise<BranchSummary[]> {
  const rows = await localDataJson<Row[]>(env, `crm_branches?company_id=eq.${encodeURIComponent(companyId)}&status=neq.archived&select=id,company_id,name,code,status,is_primary,city,address,phone,timezone&order=is_primary.desc,name.asc`, {}, 'Branches');
  const memberships = await localDataJson<Row[]>(env, `crm_branch_members?company_id=eq.${encodeURIComponent(companyId)}&status=eq.active&select=branch_id`, {}, 'Branch memberships').catch(() => []);
  const counts = new Map<string, number>();
  for (const row of memberships) { const id = text(row.branch_id); if (id) counts.set(id, (counts.get(id) || 0) + 1); }
  return rows.map((row) => ({
    id: text(row.id), companyId: text(row.company_id), name: text(row.name), code: text(row.code) || null,
    status: text(row.status) || 'active', isPrimary: row.is_primary === true, city: text(row.city) || null,
    address: text(row.address) || null, phone: text(row.phone) || null, timezone: text(row.timezone) || 'Asia/Almaty', memberCount: counts.get(text(row.id)) || 0,
  }));
}

async function branchExists(env: BranchManagementEnv, companyId: string, branchId: string): Promise<boolean> {
  const rows = await localDataJson<Row[]>(env, `crm_branches?id=eq.${encodeURIComponent(branchId)}&company_id=eq.${encodeURIComponent(companyId)}&status=neq.archived&select=id&limit=1`, {}, 'Branch');
  return Boolean(rows[0]);
}

async function ensureCompanyMember(env: BranchManagementEnv, companyId: string, userId: string): Promise<void> {
  const rows = await localDataJson<Row[]>(env, `crm_company_members?company_id=eq.${encodeURIComponent(companyId)}&user_id=eq.${encodeURIComponent(userId)}&status=eq.active&select=id&limit=1`, {}, 'Company member');
  if (!rows[0]) throw new Error('Пользователь не является активным сотрудником клиники');
}

export async function resolveRequestedBranchId(request: Request, env: BranchManagementEnv, userId: string, platformRole?: PlatformRole): Promise<string | null> {
  const companyId = await resolveCompanyId(env, userId, platformRole);
  const manage = platformRole === 'super_admin' || await canManage(env, userId, platformRole);
  const requested = text(request.headers.get('x-imds-branch-id'));

  if (requested.toLowerCase() === 'all') {
    if (!manage) throw new Error('Режим «Все филиалы» доступен только владельцу или администратору клиники');
    return ALL_BRANCHES;
  }

  if (requested) {
    if (!UUID.test(requested) || !(await branchExists(env, companyId, requested))) throw new Error('Филиал не найден в текущей клинике');
    if (manage) return requested;
    const assigned = await localDataJson<Row[]>(env, `crm_branch_members?company_id=eq.${encodeURIComponent(companyId)}&branch_id=eq.${encodeURIComponent(requested)}&user_id=eq.${encodeURIComponent(userId)}&status=eq.active&select=id&limit=1`, {}, 'Branch membership');
    if (assigned[0]) return requested;
    const anyAssignments = await localDataJson<Row[]>(env, `crm_branch_members?company_id=eq.${encodeURIComponent(companyId)}&user_id=eq.${encodeURIComponent(userId)}&status=eq.active&select=id&limit=1`, {}, 'Branch membership');
    if (anyAssignments.length) throw new Error('Нет доступа к выбранному филиалу');
    return requested;
  }

  if (!manage) {
    const assigned = await localDataJson<Row[]>(env, `crm_branch_members?company_id=eq.${encodeURIComponent(companyId)}&user_id=eq.${encodeURIComponent(userId)}&status=eq.active&select=branch_id`, {}, 'Branch membership').catch(() => []);
    const allowed = assigned.map((row) => text(row.branch_id)).filter((id) => UUID.test(id));
    if (allowed.length) {
      const primary = await localDataJson<Row[]>(env, `crm_branches?company_id=eq.${encodeURIComponent(companyId)}&is_primary=eq.true&status=eq.active&select=id&limit=1`, {}, 'Primary branch').catch(() => []);
      const primaryId = text(primary[0]?.id);
      return allowed.includes(primaryId) ? primaryId : allowed[0];
    }
  }

  const primary = await localDataJson<Row[]>(env, `crm_branches?company_id=eq.${encodeURIComponent(companyId)}&is_primary=eq.true&status=eq.active&select=id&limit=1`, {}, 'Primary branch').catch(() => []);
  return text(primary[0]?.id) || null;
}

async function analytics(env: BranchManagementEnv, companyId: string): Promise<Response> {
  const branches = await listBranches(env, companyId);
  const [leads, calls, tasks] = await Promise.all([
    localDataJson<Row[]>(env, `marketing_leads?company_id=eq.${encodeURIComponent(companyId)}&select=branch_id,is_target,arrived_at,sold_at,sale_amount&limit=50000`, {}, 'Branch leads').catch(() => []),
    localDataJson<Row[]>(env, `marketing_calls?company_id=eq.${encodeURIComponent(companyId)}&select=branch_id,call_status,appointment_created,duration_seconds&limit=50000`, {}, 'Branch calls').catch(() => []),
    localDataJson<Row[]>(env, `crm_tasks?company_id=eq.${encodeURIComponent(companyId)}&select=branch_id,status&limit=50000`, {}, 'Branch tasks').catch(() => []),
  ]);
  const byId = new Map(branches.map((branch) => [branch.id, {
    branchId: branch.id, name: branch.name, code: branch.code, isPrimary: branch.isPrimary,
    leads: 0, targetLeads: 0, arrivals: 0, sales: 0, revenue: 0, calls: 0, appointments: 0, callMinutes: 0, openTasks: 0, doneTasks: 0,
  }]));
  for (const row of leads) {
    const item = byId.get(text(row.branch_id)); if (!item) continue;
    item.leads += 1; if (row.is_target === true) item.targetLeads += 1; if (row.arrived_at) item.arrivals += 1;
    if (row.sold_at || num(row.sale_amount) > 0) item.sales += 1; item.revenue += num(row.sale_amount);
  }
  for (const row of calls) {
    const item = byId.get(text(row.branch_id)); if (!item) continue;
    item.calls += 1; if (row.appointment_created === true) item.appointments += 1; item.callMinutes += num(row.duration_seconds) / 60;
  }
  for (const row of tasks) {
    const item = byId.get(text(row.branch_id)); if (!item) continue;
    if (text(row.status) === 'done') item.doneTasks += 1; else if (text(row.status) !== 'cancelled') item.openTasks += 1;
  }
  const items = [...byId.values()].map((item) => ({ ...item, revenue: Math.round(item.revenue * 100) / 100, callMinutes: Math.round(item.callMinutes) }));
  return json({ items, totals: items.reduce((acc, item) => ({
    leads: acc.leads + item.leads, targetLeads: acc.targetLeads + item.targetLeads, arrivals: acc.arrivals + item.arrivals,
    sales: acc.sales + item.sales, revenue: acc.revenue + item.revenue, calls: acc.calls + item.calls, appointments: acc.appointments + item.appointments,
    callMinutes: acc.callMinutes + item.callMinutes, openTasks: acc.openTasks + item.openTasks, doneTasks: acc.doneTasks + item.doneTasks,
  }), { leads: 0, targetLeads: 0, arrivals: 0, sales: 0, revenue: 0, calls: 0, appointments: 0, callMinutes: 0, openTasks: 0, doneTasks: 0 }) });
}

export async function handleBranchManagementRequest(request: Request, env: BranchManagementEnv, url: URL, userId: string, platformRole?: PlatformRole): Promise<Response | null> {
  if (!url.pathname.startsWith('/api/branches')) return null;
  const companyId = await resolveCompanyId(env, userId, platformRole);
  const scopedEnv = { ...env, CURRENT_COMPANY_ID: companyId };
  const manage = await canManage(scopedEnv, userId, platformRole);

  if (url.pathname === '/api/branches' && request.method === 'GET') {
    const branches = await listBranches(scopedEnv, companyId);
    const memberships = platformRole === 'super_admin' || manage ? [] : await localDataJson<Row[]>(scopedEnv, `crm_branch_members?company_id=eq.${encodeURIComponent(companyId)}&user_id=eq.${encodeURIComponent(userId)}&status=eq.active&select=branch_id`, {}, 'Branch memberships').catch(() => []);
    const allowed = new Set(memberships.map((row) => text(row.branch_id)).filter(Boolean));
    const restricted = allowed.size > 0;
    return json({ items: restricted ? branches.filter((branch) => allowed.has(branch.id)) : branches, restricted, canManage: manage, allAvailable: manage && !restricted });
  }

  if (url.pathname === '/api/branches/analytics' && request.method === 'GET') {
    if (!manage) return json({ error: 'Сравнение филиалов доступно владельцу или администратору клиники' }, 403);
    return analytics(scopedEnv, companyId);
  }

  if (!manage) return json({ error: 'Управлять филиалами может владелец или администратор клиники' }, 403);

  if (url.pathname === '/api/branches' && request.method === 'POST') {
    const body = await request.json().catch(() => null) as { name?: string; code?: string; city?: string; address?: string; phone?: string; timezone?: string } | null;
    const name = text(body?.name); if (name.length < 2 || name.length > 180) return json({ error: 'Укажите название филиала' }, 400);
    const rows = await localDataJson<Row[]>(scopedEnv, 'crm_branches?select=id', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ company_id: companyId, name, code: text(body?.code).toUpperCase() || null, city: text(body?.city) || null, address: text(body?.address) || null, phone: text(body?.phone) || null, timezone: text(body?.timezone) || 'Asia/Almaty', created_by: userId, updated_by: userId }) }, 'Create branch');
    return json({ branch: rows[0] || null }, 201);
  }

  const match = url.pathname.match(/^\/api\/branches\/([0-9a-f-]+)$/i);
  if (match && request.method === 'PATCH') {
    const branchId = match[1]; if (!UUID.test(branchId) || !(await branchExists(scopedEnv, companyId, branchId))) return json({ error: 'Филиал не найден' }, 404);
    const body = await request.json().catch(() => null) as Row | null; const patch: Row = { updated_by: userId, updated_at: new Date().toISOString() };
    for (const key of ['name','city','address','phone','timezone'] as const) if (key in (body || {})) patch[key] = text(body?.[key]) || null;
    if ('code' in (body || {})) patch.code = text(body?.code).toUpperCase() || null;
    if ('status' in (body || {})) { const status = text(body?.status); if (!['active','inactive'].includes(status)) return json({ error: 'Недопустимый статус филиала' }, 400); patch.status = status; }
    const rows = await localDataJson<Row[]>(scopedEnv, `crm_branches?id=eq.${encodeURIComponent(branchId)}&company_id=eq.${encodeURIComponent(companyId)}&select=*`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(patch) }, 'Update branch');
    return json({ branch: rows[0] || null });
  }
  if (match && request.method === 'DELETE') {
    const branchId = match[1]; const branches = await listBranches(scopedEnv, companyId); const branch = branches.find((item) => item.id === branchId);
    if (!branch) return json({ error: 'Филиал не найден' }, 404); if (branch.isPrimary) return json({ error: 'Основной филиал нельзя архивировать. Сначала назначьте другой основной филиал.' }, 409);
    await localDataRequest(scopedEnv, `crm_branches?id=eq.${encodeURIComponent(branchId)}&company_id=eq.${encodeURIComponent(companyId)}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ status: 'archived', updated_by: userId, updated_at: new Date().toISOString() }) });
    return json({ ok: true });
  }
  const primary = url.pathname.match(/^\/api\/branches\/([0-9a-f-]+)\/primary$/i);
  if (primary && request.method === 'POST') {
    const branchId = primary[1];
    const rows = await localDataJson<Row[]>(scopedEnv, 'rpc/imds_set_primary_branch', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ p_company_id: companyId, p_branch_id: branchId, p_actor_user_id: userId }) }, 'Primary branch');
    return json({ branch: Array.isArray(rows) ? rows[0] || null : rows });
  }
  const member = url.pathname.match(/^\/api\/branches\/([0-9a-f-]+)\/members\/([0-9a-f-]+)$/i);
  if (member && request.method === 'PUT') {
    const [, branchId, memberUserId] = member; if (!(await branchExists(scopedEnv, companyId, branchId))) return json({ error: 'Филиал не найден' }, 404); await ensureCompanyMember(scopedEnv, companyId, memberUserId);
    await localDataRequest(scopedEnv, 'crm_branch_members?on_conflict=branch_id,user_id', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify({ company_id: companyId, branch_id: branchId, user_id: memberUserId, status: 'active', created_by: userId, updated_at: new Date().toISOString() }) });
    return json({ ok: true });
  }
  if (member && request.method === 'DELETE') {
    const [, branchId, memberUserId] = member;
    await localDataRequest(scopedEnv, `crm_branch_members?company_id=eq.${encodeURIComponent(companyId)}&branch_id=eq.${encodeURIComponent(branchId)}&user_id=eq.${encodeURIComponent(memberUserId)}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
    return json({ ok: true });
  }
  return json({ error: 'Not found' }, 404);
}
