import { authenticateRequest, type AuthenticatedUser } from '../worker/auth';
import { resolveTenantMembershipRole } from '../worker/accessControl';
import { resolveCompanyId } from '../worker/companyContext';
import { localTrialForTenant, platformEntitlementForTenant, platformQuotaSnapshotForTenant, type PlatformEntitlement } from './platformControl';

type BillingEnv = Record<string, string | undefined>;
type JsonRecord = Record<string, unknown>;

type BillingContext = {
  user: AuthenticatedUser;
  tenantId: string;
  organizationId: string | null;
  role: string;
  entitlement: PlatformEntitlement | null;
};

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});
const text = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
const readOnlyMethod = (method: string) => method === 'GET' || method === 'HEAD' || method === 'OPTIONS';

function billingBase(env: BillingEnv): string {
  return text(env.IMDS_BILLING_CONTROL_URL || env.IMDS_CONTROL_PLANE_URL).replace(/\/$/, '');
}
function billingToken(env: BillingEnv): string {
  return text(env.IMDS_BILLING_CONTROL_TOKEN || env.IMDS_PLATFORM_CONTROL_TOKEN);
}
function gatewayConfigured(env: BillingEnv): boolean {
  return Boolean(billingBase(env) && billingToken(env));
}
function appOrigin(request: Request, env: BillingEnv): string {
  const configured = text(env.APP_ORIGIN);
  if (configured) {
    try { return new URL(configured).origin; } catch {}
  }
  return new URL(request.url).origin;
}
function hasSensitiveCardInput(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const serialized = JSON.stringify(value).toLowerCase();
  return ['cardnumber', 'card_number', 'pan', 'cvc', 'cvv', 'expiry', 'expiration'].some((needle) => serialized.includes(needle));
}
async function parseBody(request: Request): Promise<JsonRecord> {
  const parsed = await request.json().catch(() => null);
  return parsed && !Array.isArray(parsed) && typeof parsed === 'object' ? parsed as JsonRecord : {};
}

async function resolveBillingContext(request: Request, env: BillingEnv): Promise<BillingContext | Response> {
  const user = await authenticateRequest(request, env as never);
  if (!user) return json({ error: 'AUTH_REQUIRED' }, 401);
  if (user.status !== 'active') return json({ error: 'USER_INACTIVE' }, 403);
  const requestedCompany = text(request.headers.get('x-imds-company-id'));
  const contextEnv = requestedCompany ? { ...env, CURRENT_COMPANY_ID: requestedCompany } : env;
  const tenantId = await resolveCompanyId(contextEnv as never, user.id, user.platformRole === 'super_admin' ? 'super_admin' : undefined);
  if (!tenantId) return json({ error: 'TENANT_REQUIRED' }, 400);
  const entitlement = await platformEntitlementForTenant(tenantId, env);
  const organizationId = entitlement?.organizationId || null;
  const role = user.platformRole === 'super_admin'
    ? 'super_admin'
    : await resolveTenantMembershipRole({ ...env, CURRENT_COMPANY_ID: tenantId } as never, user.id).catch(() => '');
  return { user, tenantId, organizationId, role, entitlement };
}

function canReadBilling(context: BillingContext): boolean {
  return context.role === 'super_admin' || context.role === 'owner' || context.role === 'administrator';
}
function canManageBilling(context: BillingContext): boolean {
  return context.role === 'super_admin' || context.role === 'owner';
}

async function controlRequest(
  request: Request,
  env: BillingEnv,
  context: BillingContext,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const base = billingBase(env);
  const token = billingToken(env);
  if (!base || !token) return json({ error: 'BILLING_PROVIDER_NOT_CONFIGURED' }, 503);
  const headers = new Headers(init.headers || {});
  headers.set('authorization', `Bearer ${token}`);
  headers.set('content-type', 'application/json');
  headers.set('x-imds-product', 'marketing');
  headers.set('x-imds-tenant-id', context.tenantId);
  headers.set('x-imds-user-id', context.user.id);
  headers.set('x-imds-user-email', context.user.email);
  if (context.organizationId) headers.set('x-imds-organization-id', context.organizationId);
  const response = await fetch(`${base}${path}`, { ...init, headers });
  const raw = await response.text();
  const responseHeaders = { 'content-type': response.headers.get('content-type') || 'application/json; charset=utf-8', 'cache-control': 'no-store' };
  return new Response(raw || JSON.stringify({ ok: response.ok }), { status: response.status, headers: responseHeaders });
}

async function fallbackCenter(context: BillingContext, env: BillingEnv) {
  const localBilling = context.entitlement ? null : await localTrialForTenant(context.tenantId, env);
  const quota = context.entitlement ? await platformQuotaSnapshotForTenant(context.entitlement, env).catch(() => null) : null;
  return {
    configured: gatewayConfigured(env),
    gatewayAvailable: gatewayConfigured(env),
    managed: Boolean(context.entitlement),
    tenantId: context.tenantId,
    organizationId: context.organizationId,
    billing: context.entitlement?.billing || localBilling || null,
    quota,
    plan: null,
    plans: [],
    addOns: [],
    invoices: [],
    capabilities: {
      checkout: gatewayConfigured(env) && canManageBilling(context),
      portal: gatewayConfigured(env) && canManageBilling(context),
      invoices: canReadBilling(context),
      addOns: gatewayConfigured(env) && canManageBilling(context),
    },
    permissions: { canRead: canReadBilling(context), canManage: canManageBilling(context) },
  };
}

async function billingCenter(request: Request, env: BillingEnv, context: BillingContext): Promise<Response> {
  if (!canReadBilling(context)) return json({ error: 'BILLING_ADMIN_REQUIRED' }, 403);
  const fallback = await fallbackCenter(context, env);
  if (!gatewayConfigured(env)) return json(fallback);
  const query = new URLSearchParams({ externalTenantId: context.tenantId });
  if (context.organizationId) query.set('organizationId', context.organizationId);
  const remote = await controlRequest(request, env, context, `/v1/billing/center?${query.toString()}`);
  if (!remote.ok) {
    return json({ ...fallback, gatewayAvailable: false, gatewayError: `Control Plane HTTP ${remote.status}` });
  }
  const payload = await remote.json().catch(() => ({})) as JsonRecord;
  return json({
    ...fallback,
    ...payload,
    configured: true,
    gatewayAvailable: true,
    tenantId: context.tenantId,
    organizationId: context.organizationId,
    permissions: fallback.permissions,
    capabilities: { ...fallback.capabilities, ...(payload.capabilities && typeof payload.capabilities === 'object' ? payload.capabilities : {}) },
  });
}

async function checkout(request: Request, env: BillingEnv, context: BillingContext): Promise<Response> {
  if (!canManageBilling(context)) return json({ error: 'BILLING_OWNER_REQUIRED' }, 403);
  if (!gatewayConfigured(env)) return json({ error: 'BILLING_PROVIDER_NOT_CONFIGURED' }, 503);
  const body = await parseBody(request);
  if (hasSensitiveCardInput(body)) return json({ error: 'BILLING_CARD_DATA_NOT_ACCEPTED' }, 400);
  const kind = body.kind === 'addon' ? 'addon' : 'subscription';
  const planCode = text(body.planCode);
  const addonCode = text(body.addonCode);
  const quantity = Math.max(1, Math.min(100, Math.floor(Number(body.quantity) || 1)));
  const billingPeriodMonths = Math.floor(Number(body.billingPeriodMonths) || 1);
  if (![1,3,6,12].includes(billingPeriodMonths)) return json({ error: 'INVALID_BILLING_PERIOD' }, 400);
  if (kind === 'subscription' && !planCode) return json({ error: 'PLAN_CODE_REQUIRED' }, 400);
  if (kind === 'addon' && !addonCode) return json({ error: 'ADDON_CODE_REQUIRED' }, 400);
  const origin = appOrigin(request, env);
  return controlRequest(request, env, context, '/v1/billing/checkout', {
    method: 'POST',
    body: JSON.stringify({
      externalTenantId: context.tenantId,
      organizationId: context.organizationId,
      product: 'marketing',
      kind,
      planCode: planCode || null,
      addonCode: addonCode || null,
      quantity,
      billingPeriodMonths,
      successUrl: `${origin}/billing?billing=success`,
      cancelUrl: `${origin}/billing?billing=cancel`,
    }),
  });
}

async function portal(request: Request, env: BillingEnv, context: BillingContext): Promise<Response> {
  if (!canManageBilling(context)) return json({ error: 'BILLING_OWNER_REQUIRED' }, 403);
  if (!gatewayConfigured(env)) return json({ error: 'BILLING_PROVIDER_NOT_CONFIGURED' }, 503);
  const origin = appOrigin(request, env);
  return controlRequest(request, env, context, '/v1/billing/portal', {
    method: 'POST',
    body: JSON.stringify({ externalTenantId: context.tenantId, organizationId: context.organizationId, product: 'marketing', returnUrl: `${origin}/billing?billing=return` }),
  });
}

async function invoices(request: Request, env: BillingEnv, context: BillingContext): Promise<Response> {
  if (!canReadBilling(context)) return json({ error: 'BILLING_ADMIN_REQUIRED' }, 403);
  if (!gatewayConfigured(env)) return json({ items: [], configured: false });
  const query = new URLSearchParams({ externalTenantId: context.tenantId, product: 'marketing' });
  if (context.organizationId) query.set('organizationId', context.organizationId);
  return controlRequest(request, env, context, `/v1/billing/invoices?${query.toString()}`);
}

async function refresh(request: Request, env: BillingEnv, context: BillingContext): Promise<Response> {
  if (!canReadBilling(context)) return json({ error: 'BILLING_ADMIN_REQUIRED' }, 403);
  if (!gatewayConfigured(env)) return json({ error: 'BILLING_PROVIDER_NOT_CONFIGURED' }, 503);
  return controlRequest(request, env, context, '/v1/billing/refresh', {
    method: 'POST',
    body: JSON.stringify({ externalTenantId: context.tenantId, organizationId: context.organizationId, product: 'marketing' }),
  });
}

export async function handleBillingGatewayRequest(request: Request, env: BillingEnv): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith('/api/billing/')) return null;
  const context = await resolveBillingContext(request, env);
  if (context instanceof Response) return context;
  if (url.pathname === '/api/billing/center' && request.method === 'GET') return billingCenter(request, env, context);
  if (url.pathname === '/api/billing/invoices' && request.method === 'GET') return invoices(request, env, context);
  if (url.pathname === '/api/billing/checkout' && request.method === 'POST') return checkout(request, env, context);
  if (url.pathname === '/api/billing/portal' && request.method === 'POST') return portal(request, env, context);
  if (url.pathname === '/api/billing/refresh' && request.method === 'POST') return refresh(request, env, context);
  return json({ error: 'NOT_FOUND' }, 404);
}

export function billingRouteBypassesSubscriptionLock(pathname: string, method: string): boolean {
  return pathname.startsWith('/api/billing/') || (pathname === '/api/platform/entitlements' && readOnlyMethod(method));
}
