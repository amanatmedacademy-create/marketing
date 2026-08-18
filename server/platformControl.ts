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
export type PlatformLimitKey = 'clinics' | 'users' | 'leads' | 'openTasks' | 'integrations';
export type PlatformLimits = Partial<Record<PlatformLimitKey, number>>;
export type PlatformUsageState = Record<PlatformLimitKey, number>;
export type PlatformQuotaLevel = 'ok' | 'warning' | 'critical' | 'exceeded';
export type PlatformQuotaMetric = {
  key: PlatformLimitKey;
  used: number;
  limit: number;
  remaining: number;
  percent: number;
  level: PlatformQuotaLevel;
  enforcement: 'hard' | 'soft';
};
export type PlatformQuotaSnapshot = { usage: PlatformUsageState; quotas: PlatformQuotaMetric[] };
export type PlatformEntitlement = {
  organizationId: string;
  tenantId: string;
  revision: number;
  productEnabled: boolean;
  modules: Record<string, boolean>;
  limits?: PlatformLimits;
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

type UsageCacheEntry = { expiresAt: number; usage: PlatformUsageState };

const stateDir = process.env.IMDS_PLATFORM_STATE_DIR || '/opt/imds-marketing/control';
const statePath = path.join(stateDir, 'entitlements.json');
const tmpPath = path.join(stateDir, 'entitlements.json.tmp');
const usageCache = new Map<string, UsageCacheEntry>();
const usageCacheTtlMs = 10_000;
const limitKeys: PlatformLimitKey[] = ['clinics', 'users', 'leads', 'openTasks', 'integrations'];
const entitlementLimitKeys: Array<[string, PlatformLimitKey]> = [
  ['limits.clinics', 'clinics'], ['marketing.limits.clinics', 'clinics'],
  ['limits.users', 'users'], ['marketing.limits.users', 'users'],
  ['limits.leads', 'leads'], ['marketing.limits.leads', 'leads'],
  ['limits.open_tasks', 'openTasks'], ['marketing.limits.open_tasks', 'openTasks'],
  ['limits.integrations', 'integrations'], ['marketing.limits.integrations', 'integrations'],
];
const quotaLabels: Record<PlatformLimitKey, string> = {
  clinics: 'Клиники', users: 'Пользователи', leads: 'Лиды', openTasks: 'Открытые задачи', integrations: 'Интеграции',
};

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

function numericLimit(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.floor(parsed);
}

function limitsFromEntitlements(entitlements: Record<string, unknown>, fallback: PlatformLimits = {}): PlatformLimits {
  const next: PlatformLimits = { ...fallback };
  for (const [externalKey, key] of entitlementLimitKeys) {
    if (!(externalKey in entitlements)) continue;
    if (entitlements[externalKey] === null) {
      delete next[key];
      continue;
    }
    const value = numericLimit(entitlements[externalKey]);
    if (value !== null) next[key] = value;
  }
  return next;
}

function normalizeLimits(value: unknown): PlatformLimits | undefined {
  if (!value || Array.isArray(value) || typeof value !== 'object') return undefined;
  const raw = value as Record<string, unknown>;
  const next: PlatformLimits = {};
  for (const key of limitKeys) {
    const value = numericLimit(raw[key]);
    if (value !== null) next[key] = value;
  }
  return next;
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
  if (status === 'past_due') return null;
  const locked = status === 'suspended' || status === 'cancelled' || status === 'expired' || expiredByDate;
  if (!locked || readOnlyRequest) return null;
  if (status === 'suspended') return json({ error: 'SUBSCRIPTION_SUSPENDED', readOnly: true, billing }, 403);
  return json({ error: 'SUBSCRIPTION_READ_ONLY', readOnly: true, billing }, 402);
}

function dataConfig(env: PlatformEnv): { base: string; key: string } | null {
  const base = (env.IMDS_LOCAL_DB_URL || '').trim().replace(/\/$/, '');
  const key = (env.IMDS_LOCAL_SERVICE_ROLE_KEY || '').trim();
  return base && key ? { base, key } : null;
}

async function dataRows<T>(env: PlatformEnv, pathName: string): Promise<T> {
  const config = dataConfig(env);
  if (!config) throw new Error('LOCAL_DATA_NOT_CONFIGURED');
  const response = await fetch(`${config.base}/rest/v1/${pathName.replace(/^\/+/, '')}`, {
    headers: { apikey: config.key, authorization: `Bearer ${config.key}`, 'content-type': 'application/json' },
  });
  const raw = await response.text();
  if (!response.ok) throw new Error(`LOCAL_DATA_${response.status}:${raw.slice(0, 300)}`);
  return (raw ? JSON.parse(raw) : null) as T;
}

async function dataCount(env: PlatformEnv, pathName: string): Promise<number> {
  const config = dataConfig(env);
  if (!config) throw new Error('LOCAL_DATA_NOT_CONFIGURED');
  const response = await fetch(`${config.base}/rest/v1/${pathName.replace(/^\/+/, '')}`, {
    method: 'HEAD',
    headers: { apikey: config.key, authorization: `Bearer ${config.key}`, prefer: 'count=exact' },
  });
  if (!response.ok) throw new Error(`LOCAL_COUNT_${response.status}`);
  const total = Number((response.headers.get('content-range') || '').split('/').pop());
  return Number.isFinite(total) ? total : 0;
}

async function dataPost(env: PlatformEnv, pathName: string, body: unknown): Promise<void> {
  const config = dataConfig(env);
  if (!config) throw new Error('LOCAL_DATA_NOT_CONFIGURED');
  const response = await fetch(`${config.base}/rest/v1/${pathName.replace(/^\/+/, '')}`, {
    method: 'POST',
    headers: { apikey: config.key, authorization: `Bearer ${config.key}`, 'content-type': 'application/json', prefer: 'return=minimal' },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`LOCAL_POST_${response.status}:${(await response.text()).slice(0, 300)}`);
}

async function listCompanies(env: PlatformEnv): Promise<Array<{ id: string; name: string; slug: string }>> {
  const rows = await dataRows<Company[]>(env, 'crm_companies?select=id,name,slug&order=name.asc&limit=1000');
  return rows.flatMap((row) => {
    const id = typeof row.id === 'string' ? row.id.trim() : '';
    const name = typeof row.name === 'string' ? row.name.trim() : '';
    const slug = typeof row.slug === 'string' ? row.slug.trim() : '';
    return id ? [{ id, name, slug }] : [];
  });
}

async function organizationIdForTenant(tenantId: string, env: PlatformEnv): Promise<string | null> {
  const rows = await dataRows<Array<{ organization_id?: unknown }>>(env, `crm_companies?id=eq.${encodeURIComponent(tenantId)}&select=organization_id&limit=1`).catch(() => []);
  return text(rows[0]?.organization_id);
}

export async function platformUsageForTenant(tenantId: string, env: PlatformEnv, organizationId?: string | null, fresh = false): Promise<PlatformUsageState> {
  const normalized = tenantId.trim();
  if (!normalized) return { clinics: 0, users: 0, leads: 0, openTasks: 0, integrations: 0 };
  const cached = usageCache.get(normalized);
  if (!fresh && cached && cached.expiresAt > Date.now()) return cached.usage;
  const orgId = organizationId || await organizationIdForTenant(normalized, env);
  const [clinics, users, leads, openTasks, integrations] = await Promise.all([
    orgId ? dataCount(env, `crm_companies?organization_id=eq.${encodeURIComponent(orgId)}&select=id&limit=1`).catch(() => 1) : Promise.resolve(1),
    dataCount(env, `crm_company_members?company_id=eq.${encodeURIComponent(normalized)}&status=eq.active&select=id&limit=1`).catch(() => 0),
    dataCount(env, `marketing_leads?company_id=eq.${encodeURIComponent(normalized)}&select=id&limit=1`).catch(() => 0),
    dataCount(env, `crm_tasks?company_id=eq.${encodeURIComponent(normalized)}&source=eq.work_tasks&status=not.in.(done,cancelled)&select=id&limit=1`).catch(() => 0),
    dataCount(env, `integration_credentials?company_id=eq.${encodeURIComponent(normalized)}&user_id=is.null&status=in.(connected,active,configured,verified)&select=id&limit=1`).catch(() => 0),
  ]);
  const usage = { clinics, users, leads, openTasks, integrations };
  usageCache.set(normalized, { expiresAt: Date.now() + usageCacheTtlMs, usage });
  return usage;
}

function quotaLevel(used: number, limit: number): PlatformQuotaLevel {
  const percent = limit <= 0 ? 100 : used * 100 / limit;
  if (percent >= 100) return 'exceeded';
  if (percent >= 90) return 'critical';
  if (percent >= 80) return 'warning';
  return 'ok';
}

export async function platformQuotaSnapshotForTenant(tenant: PlatformEntitlement, env: PlatformEnv, fresh = false): Promise<PlatformQuotaSnapshot> {
  const usage = await platformUsageForTenant(tenant.tenantId, env, tenant.organizationId, fresh);
  const quotas = limitKeys.flatMap((key): PlatformQuotaMetric[] => {
    const limit = tenant.limits?.[key];
    if (typeof limit !== 'number') return [];
    const used = usage[key];
    return [{
      key,
      used,
      limit,
      remaining: Math.max(0, limit - used),
      percent: limit <= 0 ? 100 : Math.round(used * 1000 / limit) / 10,
      level: quotaLevel(used, limit),
      enforcement: key === 'leads' ? 'soft' : 'hard',
    }];
  });
  return { usage, quotas };
}

async function pendingInvitationCount(tenantId: string, env: PlatformEnv): Promise<number> {
  return dataCount(env, `crm_company_invitations?company_id=eq.${encodeURIComponent(tenantId)}&status=eq.pending&select=id&limit=1`).catch(() => 0);
}

async function integrationExistsForConfig(pathname: string, tenantId: string, env: PlatformEnv): Promise<boolean> {
  const match = pathname.match(/^\/api\/integrations\/config\/([^/]+)$/);
  if (!match) return false;
  const provider = decodeURIComponent(match[1]);
  const rows = await dataRows<Array<{ id?: unknown }>>(env, `integration_credentials?company_id=eq.${encodeURIComponent(tenantId)}&user_id=is.null&provider=eq.${encodeURIComponent(provider)}&select=id&limit=1`).catch(() => []);
  return rows.length > 0;
}

function quotaKeyForRequest(pathname: string, method: string): PlatformLimitKey | null {
  if (method === 'POST' && pathname === '/api/clinics') return 'clinics';
  if (method === 'POST' && pathname === '/api/leads') return 'leads';
  if (method === 'POST' && pathname === '/api/tasks') return 'openTasks';
  if (method === 'POST' && pathname === '/api/admin/users/invitations') return 'users';
  if (method === 'POST' && /^\/api\/admin\/users\/onboarding\/[^/]+\/approve$/.test(pathname)) return 'users';
  if ((method === 'POST' || method === 'PUT') && /^\/api\/integrations\/config\/[^/]+$/.test(pathname)) return 'integrations';
  return null;
}

async function quotaDenied(request: Request, tenant: PlatformEntitlement, env: PlatformEnv): Promise<Response | null> {
  const url = new URL(request.url);
  const key = quotaKeyForRequest(url.pathname, request.method.toUpperCase());
  if (!key || key === 'leads') return null;
  const limit = tenant.limits?.[key];
  if (typeof limit !== 'number') return null;
  if (key === 'integrations' && await integrationExistsForConfig(url.pathname, tenant.tenantId, env)) return null;
  const snapshot = await platformQuotaSnapshotForTenant(tenant, env, true);
  let used = snapshot.usage[key];
  if (key === 'users' && url.pathname === '/api/admin/users/invitations') used += await pendingInvitationCount(tenant.tenantId, env);
  if (used < limit) return null;
  return json({
    error: 'QUOTA_EXCEEDED',
    quota: { key, used, limit, remaining: 0, enforcement: 'hard' },
    upgradeRequired: true,
  }, 403);
}

export async function syncQuotaNotificationsForUser(tenantId: string, userId: string, snapshot: PlatformQuotaSnapshot, env: PlatformEnv): Promise<void> {
  for (const quota of snapshot.quotas) {
    if (quota.level === 'ok') continue;
    const threshold = quota.level === 'exceeded' ? 100 : quota.level === 'critical' ? 90 : 80;
    const dedupeKey = `quota:${quota.key}:${quota.limit}:${threshold}`;
    const found = await dataRows<Array<{ id?: unknown }>>(env, `crm_notifications?company_id=eq.${encodeURIComponent(tenantId)}&user_id=eq.${encodeURIComponent(userId)}&dedupe_key=eq.${encodeURIComponent(dedupeKey)}&select=id&limit=1`).catch(() => []);
    if (found.length) continue;
    const title = quota.level === 'exceeded' ? `Лимит исчерпан: ${quotaLabels[quota.key]}` : `Использовано ${threshold}% лимита: ${quotaLabels[quota.key]}`;
    const body = quota.enforcement === 'hard'
      ? `${quota.used} из ${quota.limit}. При достижении лимита новые операции этого типа блокируются до увеличения квоты.`
      : `${quota.used} из ${quota.limit}. Входящие лиды продолжают сохраняться, но требуется увеличить квоту.`;
    await dataPost(env, 'crm_notifications', {
      company_id: tenantId,
      user_id: userId,
      type: 'billing.quota',
      severity: quota.level === 'exceeded' ? 'error' : 'warning',
      title,
      body,
      action_url: '/settings?tab=subscription',
      dedupe_key: dedupeKey,
      metadata: { key: quota.key, used: quota.used, limit: quota.limit, threshold, enforcement: quota.enforcement },
    }).catch(() => undefined);
  }
}

export async function localTrialForTenant(tenantId: string, env: PlatformEnv): Promise<PlatformBillingState | null> {
  const normalized = tenantId.trim();
  const config = dataConfig(env);
  if (!normalized || !config) return null;
  const response = await fetch(`${config.base}/rest/v1/rpc/imds_marketing_trial_state`, {
    method: 'POST',
    headers: { apikey: config.key, authorization: `Bearer ${config.key}`, 'content-type': 'application/json' },
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
    if (key.startsWith('marketing.') && !key.startsWith('marketing.limits.') && bool(value) !== null) modules[key] = value === true;
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
    limits: limitsFromEntitlements(entitlements, current?.limits || {}),
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
    return json({ product: 'imds-marketing', runtime: 'vps', protocol: 3, pid: process.pid, uptimeSeconds: Math.floor(process.uptime()) });
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
      limits: normalizeLimits(body?.limits) ?? current?.limits ?? {},
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
  const method = request.method.toUpperCase();
  if (url.pathname === '/api/health'
    || url.pathname === '/api/platform/entitlements'
    || url.pathname.startsWith('/api/auth/')
    || url.pathname.startsWith('/api/account/')
    || (url.pathname === '/api/clinics' && (method === 'GET' || method === 'HEAD'))
    || url.pathname === '/api/clinics/join'
    || url.pathname.startsWith('/api/webhooks/')
    || url.pathname.startsWith('/api/public/')) return null;

  const tenantId = tenantIdFromRequest(request);
  if (!tenantId) return null;
  const tenant = await platformEntitlementForTenant(tenantId);
  if (tenant) {
    if (!tenant.productEnabled) return json({ error: 'PRODUCT_DISABLED_BY_PLATFORM', billing: tenant.billing || null }, 403);
    const billingAccessDenied = billingDenied(tenant.billing, method);
    if (billingAccessDenied) return billingAccessDenied;
    const quotaAccessDenied = await quotaDenied(request, tenant, env);
    if (quotaAccessDenied) return quotaAccessDenied;
    const rule = routeModules.find((item) => item.test(url.pathname));
    if (rule && tenant.modules[rule.module] !== true) return json({ error: 'MODULE_DISABLED_BY_PLATFORM', module: rule.module }, 403);
    return null;
  }

  const localTrial = await localTrialForTenant(tenantId, env);
  const localTrialDenied = billingDenied(localTrial || undefined, method);
  if (localTrialDenied) return localTrialDenied;
  return null;
}
