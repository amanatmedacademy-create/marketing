import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

type PlatformEnv = Record<string, string | undefined>;
type Entitlement = {
  organizationId: string;
  tenantId: string;
  revision: number;
  productEnabled: boolean;
  modules: Record<string, boolean>;
  updatedAt: string;
};
type StateFile = { version: 1; tenants: Record<string, Entitlement> };

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

export async function handlePlatformInternalRequest(request: Request, env: PlatformEnv): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith('/internal/platform/')) return null;
  if (!authorized(request, env)) return json({ error: 'PLATFORM_CONTROL_UNAUTHORIZED' }, 401);

  if (url.pathname === '/internal/platform/info' && request.method === 'GET') {
    return json({ product: 'imds-marketing', runtime: 'vps', protocol: 1, pid: process.pid, uptimeSeconds: Math.floor(process.uptime()) });
  }

  if (url.pathname === '/internal/platform/state' && request.method === 'GET') {
    const state = await readState();
    const tenantId = (url.searchParams.get('tenantId') || '').trim();
    return json(tenantId ? { tenant: state.tenants[tenantId] || null } : state);
  }

  if (url.pathname === '/internal/platform/entitlements/apply' && request.method === 'POST') {
    const body = await request.json().catch(() => null) as Partial<Entitlement> | null;
    const organizationId = String(body?.organizationId || '').trim();
    const tenantId = String(body?.tenantId || '').trim();
    const revision = Number(body?.revision || 0);
    const productEnabled = body?.productEnabled === true;
    const modules = body?.modules && typeof body.modules === 'object' ? body.modules as Record<string, boolean> : null;
    if (!organizationId || !tenantId || !Number.isInteger(revision) || revision < 1 || !modules) return json({ error: 'INVALID_ENTITLEMENT_PAYLOAD' }, 400);

    const state = await readState();
    const current = state.tenants[tenantId];
    if (current && current.revision > revision) {
      return json({ applied: false, stale: true, tenant: current }, 409);
    }
    const tenant: Entitlement = { organizationId, tenantId, revision, productEnabled, modules, updatedAt: new Date().toISOString() };
    state.tenants[tenantId] = tenant;
    await writeState(state);
    return json({ applied: true, tenant });
  }

  return json({ error: 'NOT_FOUND' }, 404);
}

export async function enforcePlatformEntitlement(request: Request): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith('/api/')) return null;
  if (url.pathname === '/api/health' || url.pathname.startsWith('/api/auth/') || url.pathname.startsWith('/api/webhooks/') || url.pathname.startsWith('/api/public/')) return null;

  const tenantId = tenantIdFromRequest(request);
  if (!tenantId) return null; // Existing auth layer remains responsible for tenant selection.
  const state = await readState();
  const tenant = state.tenants[tenantId];
  if (!tenant) return json({ error: 'PRODUCT_ENTITLEMENT_NOT_SYNCED' }, 503);
  if (!tenant.productEnabled) return json({ error: 'PRODUCT_DISABLED_BY_PLATFORM' }, 403);

  const rule = routeModules.find((item) => item.test(url.pathname));
  if (rule && tenant.modules[rule.module] !== true) return json({ error: 'MODULE_DISABLED_BY_PLATFORM', module: rule.module }, 403);
  return null;
}
