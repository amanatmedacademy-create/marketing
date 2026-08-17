import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

type PlatformEnv = Record<string, string | undefined>;
export type PlatformPaymentMethod = {
  method: string;
  displayName: string;
  instructions: string | null;
  isDefault: boolean;
};
export type PlatformBillingState = {
  subscriptionStatus: string | null;
  trialEndsAt: string | null;
  periodEndsAt: string | null;
  graceEndsAt: string | null;
  accessEndsAt: string | null;
  renewalMode: string | null;
  currency: string;
  paymentMethods: PlatformPaymentMethod[];
  defaultPaymentMethod: string | null;
};
export type PlatformEntitlement = {
  organizationId: string;
  tenantId: string;
  revision: number;
  productEnabled: boolean;
  modules: Record<string, boolean>;
  billing?: PlatformBillingState;
  updatedAt: string;
};
type StateFile = { version: 1; tenants: Record<string, PlatformEntitlement> };
type Company = { id?: unknown; name?: unknown; slug?: unknown };

type StandardPlatformCommand = {
  commandId?: string;
  command?: string;
  organizationId?: string;
  externalTenantId?: string | null;
  payload?: Record<string, unknown>;
};

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

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function bool(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function paymentMethods(value: unknown): PlatformPaymentMethod[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || Array.isArray(item) || typeof item !== 'object') return [];
    const row = item as Record<string, unknown>;
    const method = text(row.method);
    if (!method) return [];
    return [{
      method,
      displayName: text(row.displayName) || method,
      instructions: text(row.instructions),
      isDefault: row.isDefault === true,
    }];
  });
}

function billingFromEntitlements(entitlements: Record<string, unknown>, fallback?: PlatformBillingState): PlatformBillingState | undefined {
  const hasBilling = Object.keys(entitlements).some((key) => key.startsWith('billing.'));
  if (!hasBilling && !fallback) return undefined;
  return {
    subscriptionStatus: text(entitlements['billing.subscription_status']) ?? fallback?.subscriptionStatus ?? null,
    trialEndsAt: text(entitlements['billing.trial_ends_at']) ?? fallback?.trialEndsAt ?? null,
    periodEndsAt: text(entitlements['billing.period_ends_at']) ?? fallback?.periodEndsAt ?? null,
    graceEndsAt: text(entitlements['billing.grace_ends_at']) ?? fallback?.graceEndsAt ?? null,
    accessEndsAt: text(entitlements['billing.access_ends_at']) ?? fallback?.accessEndsAt ?? null,
    renewalMode: text(entitlements['billing.renewal_mode']) ?? fallback?.renewalMode ?? null,
    currency: text(entitlements['billing.currency']) ?? fallback?.currency ?? 'KZT',
    paymentMethods: 'billing.payment_methods' in entitlements ? paymentMethods(entitlements['billing.payment_methods']) : fallback?.paymentMethods ?? [],
    defaultPaymentMethod: text(entitlements['billing.payment_method_default']) ?? fallback?.defaultPaymentMethod ?? null,
  };
}

function normalizeBilling(value: unknown): PlatformBillingState | undefined {
  if (!value || Array.isArray(value) || typeof value !== 'object') return undefined;
  const row = value as Record<string, unknown>;
  return {
    subscriptionStatus: text(row.subscriptionStatus),
    trialEndsAt: text(row.trialEndsAt),
    periodEndsAt: text(row.periodEndsAt),
    graceEndsAt: text(row.graceEndsAt),
    accessEndsAt: text(row.accessEndsAt),
    renewalMode: text(row.renewalMode),
    currency: text(row.currency) || 'KZT',
    paymentMethods: paymentMethods(row.paymentMethods),
    defaultPaymentMethod: text(row.defaultPaymentMethod),
  };
}

function billingDenied(billing: PlatformBillingState | undefined, method: string): Response | null {
  if (!billing) return null;
  const status = billing.subscriptionStatus;
  const accessEnd = billing.accessEndsAt ? Date.parse(billing.accessEndsAt) : NaN;
  const expiredByDate = Number.isFinite(accessEnd) && accessEnd <= Date.now();
  const readOnlyRequest = method === 'GET' || method === 'HEAD' || method === 'OPTIONS';

  // past_due is a warning state. The platform can move it to grace_period/suspended
  // when write access must actually change.
  if (status === 'past_due') return null;

  const locked = status === 'suspended' || status === 'cancelled' || status === 'expired' || expiredByDate;
  if (!locked || readOnlyRequest) return null;
  if (status === 'suspended') return json({ error: 'SUBSCRIPTION_SUSPENDED', readOnly: true, billing }, 403);
  return json({ error: 'SUBSCRIPTION_READ_ONLY', readOnly: true, billing }, 402);
}

async function listCompanies(env: PlatformEnv): Promise<Array<{ id: string; name: string; slug: string }>> {
  const base = (env.IMDS_LOCAL_DB_URL || '').trim().replace(/\/$/, '');
  const key = (env.IMDS_LOCAL_SERVICE_ROLE_KEY || '').trim();
  if (!base || !key) throw new Error('LOCAL_DATA_NOT_CONFIGURED');
  const response = await fetch(`${base}/rest/v1/crm_companies?select=id,name,slug&order=name.asc&limit=1000`, {
    headers: { apikey: key, authorization: `Bearer ${key}` },
  });
  const raw = await response.text();
  if (!response.ok) throw new Error(`COMPANY_LIST_${response.status}:${raw.slice(0, 300)}`);
  const rows = (raw ? JSON.parse(raw) : []) as Company[];
  return rows.flatMap((row) => {
    const id = typeof row.id === 'string' ? row.id.trim() : '';
    const name = typeof row.name === 'string' ? row.name.trim() : '';
    const slug = typeof row.slug === 'string' ? row.slug.trim() : '';
    return id ? [{ id, name, slug }] : [];
  });
}

export async function localTrialForTenant(tenantId: string, env: PlatformEnv): Promise<PlatformBillingState | null> {
  const normalized = tenantId.trim();
  const base = (env.IMDS_LOCAL_DB_URL || '').trim().replace(/\/$/, '');
  const key = (env.IMDS_LOCAL_SERVICE_ROLE_KEY || '').trim();
  if (!normalized || !base || !key) return null;
  const response = await fetch(`${base}/rest/v1/rpc/imds_marketing_trial_state`, {
    method: 'POST',
    headers: { apikey: key, authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ target_company_id: normalized }),
  });
  if (!response.ok) return null;
  const raw = await response.text();
  if (!raw || raw === 'null') return null;
  let payload: Record<string, unknown> | null = null;
  try { payload = JSON.parse(raw) as Record<string, unknown>; } catch { return null; }
  if (!payload) return null;
  return {
    subscriptionStatus: text(payload.status),
    trialEndsAt: text(payload.trialEndsAt),
    periodEndsAt: text(payload.periodEndsAt),
    graceEndsAt: null,
    accessEndsAt: text(payload.accessEndsAt),
    renewalMode: 'manual',
    currency: 'KZT',
    paymentMethods: [],
    defaultPaymentMethod: null,
  };
}

export async function platformEntitlementForTenant(tenantId: string): Promise<PlatformEntitlement | null> {
  const normalized = tenantId.trim();
  if (!normalized) return null;
  const state = await readState();
  return state.tenants[normalized] || null;
}

async function applyStandardCommand(command: StandardPlatformCommand): Promise<Response> {
  const organizationId = text(command.organizationId) || '';
  const payload = command.payload && typeof command.payload === 'object' ? command.payload : {};
  const tenantId = text(command.externalTenantId) || text(payload.external_tenant_id) || '';
  const commandName = text(command.command) || '';
  const commandId = text(command.commandId) || crypto.randomUUID();
  if (!organizationId || !tenantId || !commandName) return json({ commandId, status: 'failed', retryable: false, errorCode: 'INVALID_COMMAND', errorMessage: 'Organization, tenant and command are required' }, 400);

  const state = await readState();
  const current = state.tenants[tenantId];
  const rawEntitlements = payload.entitlements;
  const entitlements = rawEntitlements && !Array.isArray(rawEntitlements) && typeof rawEntitlements === 'object'
    ? rawEntitlements as Record<string, unknown>
    : {};
  const modules = { ...(current?.modules || {}) };
  for (const [key, value] of Object.entries(entitlements)) {
    if (key.startsWith('marketing.') && bool(value) !== null) modules[key] = value === true;
  }

  let productEnabled = current?.productEnabled ?? true;
  if (commandName === 'suspendTenant' || commandName === 'revokeTenant') productEnabled = false;
  if (commandName === 'resumeTenant' || commandName === 'provisionTenant') productEnabled = true;
  if (!['syncEntitlements', 'suspendTenant', 'resumeTenant', 'revokeTenant', 'provisionTenant', 'inviteOwner'].includes(commandName)) {
    return json({ commandId, status: 'failed', retryable: false, errorCode: 'UNSUPPORTED_COMMAND', errorMessage: `Unsupported command: ${commandName}` }, 400);
  }

  const tenant: PlatformEntitlement = {
    organizationId,
    tenantId,
    revision: (current?.revision || 0) + 1,
    productEnabled,
    modules,
    billing: billingFromEntitlements(entitlements, current?.billing),
    updatedAt: new Date().toISOString(),
  };
  state.tenants[tenantId] = tenant;
  await writeState(state);
  return json({ commandId, status: 'completed', externalTenantId: tenantId, completedAt: new Date().toISOString(), data: { revision: tenant.revision } });
}

export async function handlePlatformInternalRequest(request: Request, env: PlatformEnv): Promise<Response | null> {
  const url = new URL(request.url);
  const internal = url.pathname.startsWith('/internal/platform/');
  const standardCommand = url.pathname === '/control-plane/v1/commands';
  if (!internal && !standardCommand) return null;
  if (!authorized(request, env)) return json({ error: 'PLATFORM_CONTROL_UNAUTHORIZED' }, 401);

  if (standardCommand && request.method === 'POST') {
    const command = await request.json().catch(() => null) as StandardPlatformCommand | null;
    if (!command) return json({ error: 'INVALID_COMMAND_PAYLOAD' }, 400);
    return applyStandardCommand(command);
  }

  if (url.pathname === '/internal/platform/info' && request.method === 'GET') {
    return json({ product: 'imds-marketing', runtime: 'vps', protocol: 2, pid: process.pid, uptimeSeconds: Math.floor(process.uptime()) });
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
    const tenant: PlatformEntitlement = {
      organizationId,
      tenantId,
      revision,
      productEnabled,
      modules,
      billing: normalizeBilling(body?.billing) ?? current?.billing,
      updatedAt: new Date().toISOString(),
    };
    state.tenants[tenantId] = tenant;
    await writeState(state);
    return json({ applied: true, tenant });
  }

  return json({ error: 'NOT_FOUND' }, 404);
}

export async function enforcePlatformEntitlement(request: Request, env: PlatformEnv = process.env): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith('/api/')) return null;
  if (url.pathname === '/api/health'
    || url.pathname === '/api/platform/entitlements'
    || url.pathname.startsWith('/api/auth/')
    || url.pathname.startsWith('/api/account/')
    || url.pathname === '/api/clinics'
    || url.pathname === '/api/clinics/join'
    || url.pathname.startsWith('/api/webhooks/')
    || url.pathname.startsWith('/api/public/')) return null;

  const tenantId = tenantIdFromRequest(request);
  if (!tenantId) return null;
  const tenant = await platformEntitlementForTenant(tenantId);
  if (tenant) {
    if (!tenant.productEnabled) return json({ error: 'PRODUCT_DISABLED_BY_PLATFORM', billing: tenant.billing || null }, 403);
    const billingAccessDenied = billingDenied(tenant.billing, request.method);
    if (billingAccessDenied) return billingAccessDenied;
    const rule = routeModules.find((item) => item.test(url.pathname));
    if (rule && tenant.modules[rule.module] !== true) return json({ error: 'MODULE_DISABLED_BY_PLATFORM', module: rule.module }, 403);
    return null;
  }

  const localTrial = await localTrialForTenant(tenantId, env);
  const localTrialDenied = billingDenied(localTrial || undefined, request.method);
  if (localTrialDenied) return localTrialDenied;
  return null;
}
