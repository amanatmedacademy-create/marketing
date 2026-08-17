import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

type PlatformEnv = Record<string, string | undefined>;
export type PlatformEntitlement = {
  organizationId: string;
  tenantId: string;
  revision: number;
  productEnabled: boolean;
  modules: Record<string, boolean>;
  updatedAt: string;
};
type StateFile = { version: 1; tenants: Record<string, PlatformEntitlement> };
type Company = { id?: unknown; name?: unknown; slug?: unknown };

const stateDir = process.env.IMDS_PLATFORM_STATE_DIR || '/opt/imds-marketing/control';
const statePath = path.join(stateDir, 'entitlements.json');
const tmpPath = path.join(stateDir, 'entitlements.json.tmp');

const routeModules: Array<{ test: (pathname: string) => boolean; module: string }> = [
  { test: (p) => p.startsWith('/api/tasks'), module: 'marketing.tasks' },
  { test: (p) => p.startsWith('/api/callcenter') || p.startsWith('/api/chat') || p.startsWith('/api/calls') || p.startsWith('/api/phone-workspace'), module: 'marketing.call-center' },
  { test: (p) => p.startsWith('/api/integrations/waba') || p.startsWith('/api/whatsapp') || p.startsWith('/api/waba'), module: 'marketing.whatsapp-business' },
  { test: (p) => p.startsWith('/api/ads') || p.startsWith('/api/meta'), module: 'marketing.meta-ads' },
  { test: (p) => p.startsWith('/api/analytics') || p.startsWith('/api/conversion') || p.startsWith('/api/web-analytics'), module: 'marketing.analytics' },
  { test: (p) => p.startsWith('/api/automation'), module: 'marketing.automation' },
  { test: (p) => p.startsWith('/api/transcription') || p.startsWith('/api/voice-transcription'), module: 'marketing.voice-transcription' },
  { test: (p) => p.startsWith('/api/funnel') || p.startsWith('/api/deal-workspace') || p.startsWith('/api/leads') || p.startsWith('/api/crm'), module: 'marketing.crm' },
];

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
}

async function readState(): Promise<StateFile> {
  try {
    const raw = await readFile(statePath, 'utf8');
    const parsed = JSON.parse(raw) as StateFile;
    if (parsed.version === 1 && parsed.tenants && typeof parsed.tenants === 'object') return parsed;
  } catch {}
  return { version: 1, tenants: {} };
}

async function writeState(state: StateFile): Promise<void> {
  await mkdir(stateDir, { recursive: true });
  await writeFile(tmpPath, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o640 });
  await rename(tmpPath, statePath);
}

function bearer(request: Request): string {
  const auth = request.headers.get('authorization') || '';
  return auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : '';
}

function authorized(request: Request, env: PlatformEnv): boolean {
  const expected = (env.IMDS_PLATFORM_CONTROL_TOKEN || '').trim();
  return Boolean(expected && bearer(request) === expected);
}

function tenantIdFromRequest(request: Request): string {
  return (request.headers.get('x-imds-company-id') || '').trim();
}

async function listCompanies(env: PlatformEnv): Promise<Array<{ id: string; name: string; slug: string }>> {
  const base = (env.IMDS_LOCAL_DB_URL || '').trim().replace(/\/$/, '');
  const key = (env.IMDS_LOCAL_SERVICE_ROLE_KEY || '').trim();
  if (!base || !key) throw new Error('LOCAL_DATA_NOT_CONFIGURED');
  const response = await fetch(`${base}/rest/v1/crm_companies?select=id,name,slug&order=name.asc&limit=1000`, {
    headers: { apikey: key, authorization: `Bearer ${key}` },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`COMPANY_LIST_${response.status}:${text.slice(0, 300)}`);
  const rows = (text ? JSON.parse(text) : []) as Company[];
  return rows.flatMap((row) => {
    const id = typeof row.id === 'string' ? row.id.trim() : '';
    const name = typeof row.name === 'string' ? row.name.trim() : '';
    const slug = typeof row.slug === 'string' ? row.slug.trim() : '';
    return id ? [{ id, name, slug }] : [];
  });
}

export async function platformEntitlementForTenant(tenantId: string): Promise<PlatformEntitlement | null> {
  const normalized = tenantId.trim();
  if (!normalized) return null;
  const state = await readState();
  return state.tenants[normalized] || null;
}

export async function handlePlatformInternalRequest(request: Request, env: PlatformEnv): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith('/internal/platform/')) return null;
  if (!authorized(request, env)) return json({ error: 'PLATFORM_CONTROL_UNAUTHORIZED' }, 401);

  if (url.pathname === '/internal/platform/info' && request.method === 'GET') {
    return json({ product: 'imds-marketing', runtime: 'vps', protocol: 1, pid: process.pid, uptimeSeconds: Math.floor(process.uptime()) });
  }

  if (url.pathname === '/internal/platform/tenants' && request.method === 'GET') {
    try { return json({ items: await listCompanies(env) }); }
    catch (error) { return json({ error: error instanceof Error ? error.message : String(error) }, 503); }
  }

  if (url.pathname === '/internal/platform/state' && request.method === 'GET') {
    const state = await readState();
    const tenantId = (url.searchParams.get('tenantId') || '').trim();
    return json(tenantId ? { tenant: state.tenants[tenantId] || null } : state);
  }

  if (url.pathname === '/internal/platform/entitlements/apply' && request.method === 'POST') {
    const body = await request.json().catch(() => null) as Partial<PlatformEntitlement> | null;
    const organizationId = String(body?.organizationId || '').trim();
    const tenantId = String(body?.tenantId || '').trim();
    const revision = Number(body?.revision || 0);
    const productEnabled = body?.productEnabled === true;
    const modules = body?.modules && typeof body.modules === 'object' ? body.modules as Record<string, boolean> : null;
    if (!organizationId || !tenantId || !Number.isInteger(revision) || revision < 1 || !modules) return json({ error: 'INVALID_ENTITLEMENT_PAYLOAD' }, 400);

    const state = await readState();
    const current = state.tenants[tenantId];
    if (current && current.revision > revision) return json({ applied: false, stale: true, tenant: current }, 409);
    const tenant: PlatformEntitlement = { organizationId, tenantId, revision, productEnabled, modules, updatedAt: new Date().toISOString() };
    state.tenants[tenantId] = tenant;
    await writeState(state);
    return json({ applied: true, tenant });
  }

  return json({ error: 'NOT_FOUND' }, 404);
}

export async function enforcePlatformEntitlement(request: Request): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith('/api/')) return null;
  if (url.pathname === '/api/health' || url.pathname === '/api/platform/entitlements' || url.pathname.startsWith('/api/auth/') || url.pathname.startsWith('/api/webhooks/') || url.pathname.startsWith('/api/public/')) return null;

  const tenantId = tenantIdFromRequest(request);
  if (!tenantId) return null;
  const tenant = await platformEntitlementForTenant(tenantId);
  if (!tenant) return null;
  if (!tenant.productEnabled) return json({ error: 'PRODUCT_DISABLED_BY_PLATFORM' }, 403);

  const rule = routeModules.find((item) => item.test(url.pathname));
  if (rule && tenant.modules[rule.module] !== true) return json({ error: 'MODULE_DISABLED_BY_PLATFORM', module: rule.module }, 403);
  return null;
}
