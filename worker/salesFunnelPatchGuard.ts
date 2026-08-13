import type { Env } from './integrations';
import { requireCompanyId, type TenantScopedEnv } from './tenantScope';
import { handleSalesFunnelV2 } from './salesFunnelV2';

type Row = Record<string, unknown>;
type ScopedEnv = Env & TenantScopedEnv;

const WRITE_ROLES = new Set(['administrator', 'marketer']);
const ROLE_HEADER = 'x-amanat-auth-role';

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(value);
}

function dbHeaders(env: Env, init: RequestInit): Headers {
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error('Supabase server key is missing');
  const headers = new Headers(init.headers);
  headers.set('apikey', key);
  if (!key.startsWith('sb_secret_')) headers.set('authorization', `Bearer ${key}`);
  headers.set('accept', 'application/json');
  if (init.body != null) headers.set('content-type', 'application/json');
  if (init.method && !['GET', 'HEAD'].includes(init.method) && !headers.has('prefer')) headers.set('prefer', 'return=representation');
  return headers;
}

async function db<T>(env: Env, path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${env.SUPABASE_URL.replace(/\/+$/, '')}/rest/v1${path}`, {
    ...init,
    headers: dbHeaders(env, init),
    cache: 'no-store',
  });
  const raw = await response.text();
  if (!response.ok) throw new Error(`Sales funnel patch guard DB ${response.status}: ${raw.slice(0, 1000)}`);
  return (raw ? JSON.parse(raw) : null) as T;
}

export async function handleSalesFunnelWithPatchGuard(request: Request, env: Env, url: URL): Promise<Response | null> {
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const match = request.method === 'PATCH' ? path.match(/^\/api\/funnel\/leads\/([0-9a-f-]+)$/i) : null;
  if (!match) return handleSalesFunnelV2(request, env, url);

  const role = text(request.headers.get(ROLE_HEADER)).toLowerCase();
  if (!WRITE_ROLES.has(role)) return handleSalesFunnelV2(request, env, url);

  const companyId = requireCompanyId(env as ScopedEnv);
  const dealId = match[1];
  const body = await request.clone().json().catch(() => null) as Row | null;
  if (!body) return handleSalesFunnelV2(request, env, url);

  const currentRows = await db<Row[]>(env, `/crm_deals?select=id,pipeline_id,stage_id,marketing_lead_id&company_id=eq.${encodeURIComponent(companyId)}&id=eq.${encodeURIComponent(dealId)}&deleted_at=is.null&limit=1`);
  const current = currentRows[0];
  if (!current) return handleSalesFunnelV2(request, env, url);

  const currentPipelineId = text(current.pipeline_id);
  const currentStageId = text(current.stage_id);
  const currentLeadId = text(current.marketing_lead_id) || null;

  const guardedBody: Row = { ...body };
  if (body.pipelineId === undefined) guardedBody.pipelineId = currentPipelineId;
  if (body.stageId === undefined) guardedBody.stageId = currentStageId;

  const headers = new Headers(request.headers);
  headers.set('content-type', 'application/json');
  const guardedRequest = new Request(request.url, {
    method: request.method,
    headers,
    body: JSON.stringify(guardedBody),
  });

  const response = await handleSalesFunnelV2(guardedRequest, env, url);
  if (!response || !response.ok || body.marketingLeadId === undefined) return response;

  const requestedLead = typeof body.marketingLeadId === 'string' && isUuid(body.marketingLeadId)
    ? body.marketingLeadId
    : null;

  if (currentLeadId && currentLeadId !== requestedLead) {
    await db<Row[]>(env, `/marketing_leads?company_id=eq.${encodeURIComponent(companyId)}&id=eq.${encodeURIComponent(currentLeadId)}&crm_deal_id=eq.${encodeURIComponent(dealId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ crm_deal_id: null, updated_at: new Date().toISOString() }),
    });
  }

  return response;
}
