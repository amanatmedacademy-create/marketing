import { resolveTenantMembershipRole } from '../worker/accessControl';
import { authenticateRequest } from '../worker/auth';
import { resolveCompanyId } from '../worker/companyContext';
import { platformEntitlementForTenant } from './platformControl';

type Env = Record<string, string | undefined>;
const text = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });

async function branchCount(env: Env, companyId: string): Promise<number> {
  const base = text(env.IMDS_LOCAL_DB_URL).replace(/\/$/, '');
  const key = text(env.IMDS_LOCAL_SERVICE_ROLE_KEY);
  if (!base || !key) return 0;
  const response = await fetch(`${base}/rest/v1/crm_branches?company_id=eq.${encodeURIComponent(companyId)}&status=neq.archived&select=id`, {
    method: 'HEAD', headers: { apikey: key, authorization: `Bearer ${key}`, prefer: 'count=exact' },
  });
  if (!response.ok) return 0;
  const total = Number((response.headers.get('content-range') || '').split('/').pop());
  return Number.isFinite(total) ? total : 0;
}

export async function enforceBranchQuota(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== '/api/branches' || request.method !== 'POST') return null;
  const user = await authenticateRequest(request, env as never);
  if (!user || user.status !== 'active') return null;
  const requestedCompany = text(request.headers.get('x-imds-company-id'));
  const companyId = await resolveCompanyId(requestedCompany ? { ...env, CURRENT_COMPANY_ID: requestedCompany } as never : env as never, user.id, user.platformRole);
  if (user.platformRole !== 'super_admin') {
    const role = await resolveTenantMembershipRole({ ...env, CURRENT_COMPANY_ID: companyId } as never, user.id);
    if (role !== 'owner' && role !== 'administrator') return null;
  }
  const entitlement = await platformEntitlementForTenant(companyId, env);
  const limit = entitlement?.limits?.branches;
  if (typeof limit !== 'number') return null;
  const used = await branchCount(env, companyId);
  if (used < limit) return null;
  return json({ error: 'QUOTA_EXCEEDED', quota: { key: 'branches', used, limit, remaining: 0, enforcement: 'hard' }, upgradeRequired: true }, 403);
}
