import { createHmac, timingSafeEqual } from 'node:crypto';

type Env = Record<string, string | undefined>;
type Row = Record<string, unknown>;
type BillingPlanRow = Row & { code?: string; name?: string; amount?: number | string; currency?: string; interval?: string; limits?: Record<string, unknown>; modules?: Record<string, unknown> };
type BillingAddonRow = Row & { code?: string; name?: string; amount?: number | string; currency?: string; unit?: string; limit_key?: string; increment_amount?: number | string };
type BillingOrderRow = Row & { id?: string; tenant_id?: string; organization_id?: string; kind?: string; plan_code?: string; addon_code?: string; quantity?: number | string; amount?: number | string; currency?: string; status?: string; payer_email?: string };

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';
const num = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : 0;
const nowIso = () => new Date().toISOString();
const addDays = (value: Date, days: number) => new Date(value.getTime() + days * 86_400_000);
const addMonths = (value: Date, months: number) => { const next = new Date(value); next.setUTCMonth(next.getUTCMonth() + months); return next; };

function serviceConfig(env: Env) {
  const base = text(env.IMDS_LOCAL_DB_URL).replace(/\/$/, '');
  const key = text(env.IMDS_LOCAL_SERVICE_ROLE_KEY);
  if (!base || !key) throw new Error('LOCAL_DATA_NOT_CONFIGURED');
  return { base, key };
}
function serviceHeaders(env: Env, extra: HeadersInit = {}) {
  const { key } = serviceConfig(env);
  return { apikey: key, authorization: `Bearer ${key}`, 'content-type': 'application/json', ...extra };
}
async function dbRows<T>(env: Env, path: string): Promise<T> {
  const { base } = serviceConfig(env);
  const response = await fetch(`${base}/rest/v1/${path}`, { headers: serviceHeaders(env) });
  const raw = await response.text();
  if (!response.ok) throw new Error(`BILLING_DB_${response.status}:${raw.slice(0,300)}`);
  return (raw ? JSON.parse(raw) : null) as T;
}
async function dbWrite<T = Row[]>(env: Env, path: string, method: 'POST'|'PATCH', body: unknown, representation = true): Promise<T> {
  const { base } = serviceConfig(env);
  const response = await fetch(`${base}/rest/v1/${path}`, {
    method,
    headers: serviceHeaders(env, { prefer: representation ? 'return=representation' : 'return=minimal' }),
    body: JSON.stringify(body),
  });
  const raw = await response.text();
  if (!response.ok) throw new Error(`BILLING_DB_${response.status}:${raw.slice(0,300)}`);
  return (raw ? JSON.parse(raw) : []) as T;
}

function controlToken(env: Env) { return text(env.IMDS_BILLING_CONTROL_TOKEN || env.IMDS_PLATFORM_CONTROL_TOKEN); }
function authorized(request: Request, env: Env) {
  const auth = request.headers.get('authorization') || '';
  return Boolean(controlToken(env) && auth.toLowerCase().startsWith('bearer ') && auth.slice(7).trim() === controlToken(env));
}
function cloudConfigured(env: Env) { return Boolean(text(env.CLOUDPAYMENTS_PUBLIC_ID) && text(env.CLOUDPAYMENTS_API_SECRET)); }
function productName() { return 'BELES'; }
function publicOrigin(env: Env, request: Request) {
  const configured = text(env.APP_ORIGIN);
  try { return configured ? new URL(configured).origin : new URL(request.url).origin; } catch { return new URL(request.url).origin; }
}

async function planByCode(env: Env, code: string): Promise<BillingPlanRow | null> {
  const rows = await dbRows<BillingPlanRow[]>(env, `imds_billing_plans?code=eq.${encodeURIComponent(code)}&product=eq.marketing&active=eq.true&select=*&limit=1`);
  return rows[0] || null;
}
async function addonByCode(env: Env, code: string): Promise<BillingAddonRow | null> {
  const rows = await dbRows<BillingAddonRow[]>(env, `imds_billing_addons?code=eq.${encodeURIComponent(code)}&product=eq.marketing&active=eq.true&select=*&limit=1`);
  return rows[0] || null;
}
async function currentSubscription(env: Env, tenantId: string): Promise<Row | null> {
  const rows = await dbRows<Row[]>(env, `imds_billing_subscriptions?tenant_id=eq.${encodeURIComponent(tenantId)}&select=*&limit=1`);
  return rows[0] || null;
}
async function activeAddonGrants(env: Env, tenantId: string): Promise<Row[]> {
  return dbRows<Row[]>(env, `imds_billing_addon_grants?tenant_id=eq.${encodeURIComponent(tenantId)}&status=eq.active&ends_at=gt.${encodeURIComponent(nowIso())}&select=addon_code,quantity,ends_at`);
}

function normalizeLimits(value: unknown): Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).flatMap(([key, value]) => Number.isFinite(Number(value)) ? [[key, Math.max(0, Math.floor(Number(value)))]] : []));
}
function normalizeModules(value: unknown): Record<string, boolean> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([, value]) => typeof value === 'boolean')) as Record<string, boolean>;
}
function entitlementLimitKey(key: string) { return key === 'openTasks' ? 'limits.open_tasks' : `limits.${key}`; }

async function syncEntitlements(env: Env, tenantId: string): Promise<void> {
  const subscription = await currentSubscription(env, tenantId);
  if (!subscription) return;
  const planCode = text(subscription.plan_code);
  const plan = planCode ? await planByCode(env, planCode) : null;
  const limits = normalizeLimits(plan?.limits);
  const modules = normalizeModules(plan?.modules);
  const grants = await activeAddonGrants(env, tenantId);
  for (const grant of grants) {
    const addon = await addonByCode(env, text(grant.addon_code));
    if (!addon) continue;
    const key = text(addon.limit_key);
    limits[key] = (limits[key] || 0) + Math.max(0, Math.floor(num(addon.increment_amount))) * Math.max(1, Math.floor(num(grant.quantity)));
  }
  const entitlements: Record<string, unknown> = { ...modules };
  for (const [key, value] of Object.entries(limits)) entitlements[entitlementLimitKey(key)] = value;
  entitlements['billing.subscription_status'] = text(subscription.status) || null;
  entitlements['billing.period_ends_at'] = subscription.period_ends_at || null;
  entitlements['billing.grace_ends_at'] = subscription.grace_ends_at || null;
  entitlements['billing.access_ends_at'] = subscription.access_ends_at || null;
  entitlements['billing.renewal_mode'] = text(subscription.renewal_mode) || 'manual';
  entitlements['billing.currency'] = text(subscription.currency) || 'KZT';
  entitlements['billing.payment_method_default'] = text(subscription.provider) || null;
  entitlements['billing.payment_methods'] = text(subscription.provider) ? [{ method: text(subscription.provider), displayName: text(subscription.payment_method_label) || 'CloudPayments', instructions: 'Платёжные реквизиты хранятся у платёжного провайдера', isDefault: true }] : [];
  const localBase = `http://127.0.0.1:${Number(env.PORT || 8787)}`;
  const response = await fetch(`${localBase}/control-plane/v1/commands`, {
    method: 'POST',
    headers: { authorization: `Bearer ${controlToken(env)}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      commandId: `billing-sync:${tenantId}:${Date.now()}`,
      command: 'syncEntitlements',
      organizationId: text(subscription.organization_id) || tenantId,
      externalTenantId: tenantId,
      payload: { entitlements },
    }),
  });
  if (!response.ok) throw new Error(`ENTITLEMENT_SYNC_${response.status}:${(await response.text()).slice(0,300)}`);
}

async function cloudOrder(env: Env, order: BillingOrderRow, description: string, successUrl: string, failUrl: string): Promise<{ url: string; providerOrderId: string | null }> {
  const publicId = text(env.CLOUDPAYMENTS_PUBLIC_ID);
  const secret = text(env.CLOUDPAYMENTS_API_SECRET);
  if (!publicId || !secret) throw new Error('CLOUDPAYMENTS_NOT_CONFIGURED');
  const body = new URLSearchParams();
  body.set('Amount', num(order.amount).toFixed(2));
  body.set('Currency', text(order.currency) || 'KZT');
  body.set('Description', description);
  body.set('InvoiceId', text(order.id));
  body.set('AccountId', text(order.tenant_id));
  if (text(order.payer_email)) body.set('Email', text(order.payer_email));
  body.set('SuccessRedirectUrl', successUrl);
  body.set('FailRedirectUrl', failUrl);
  body.set('CultureName', 'ru-RU');
  body.set('JsonData', JSON.stringify({ tenantId: order.tenant_id, organizationId: order.organization_id, kind: order.kind, planCode: order.plan_code, addonCode: order.addon_code, quantity: num(order.quantity) }));
  const response = await fetch('https://api.cloudpayments.ru/orders/create', {
    method: 'POST',
    headers: { authorization: `Basic ${Buffer.from(`${publicId}:${secret}`).toString('base64')}`, 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
  const raw = await response.text();
  let payload: Row = {};
  try { payload = raw ? JSON.parse(raw) as Row : {}; } catch {}
  if (!response.ok || payload.Success === false) throw new Error(`CLOUDPAYMENTS_${response.status}:${text(payload.Message) || raw.slice(0,300)}`);
  const model = payload.Model && typeof payload.Model === 'object' ? payload.Model as Row : payload;
  const url = text(model.Url || model.url || payload.Url || payload.url);
  if (!url) throw new Error('CLOUDPAYMENTS_CHECKOUT_URL_MISSING');
  return { url, providerOrderId: text(model.Id || model.id) || null };
}

async function createCheckout(request: Request, env: Env): Promise<Response> {
  if (!authorized(request, env)) return json({ error: 'BILLING_CONTROL_UNAUTHORIZED' }, 401);
  const body = await request.json().catch(() => null) as Row | null;
  if (!body) return json({ error: 'INVALID_CHECKOUT_PAYLOAD' }, 400);
  const tenantId = text(body.externalTenantId);
  const organizationId = text(body.organizationId) || null;
  const kind = body.kind === 'addon' ? 'addon' : 'subscription';
  const planCode = text(body.planCode);
  const addonCode = text(body.addonCode);
  const quantity = Math.max(1, Math.min(100, Math.floor(num(body.quantity) || 1)));
  if (!tenantId) return json({ error: 'TENANT_REQUIRED' }, 400);
  const plan = kind === 'subscription' ? await planByCode(env, planCode) : null;
  const addon = kind === 'addon' ? await addonByCode(env, addonCode) : null;
  if (kind === 'subscription' && !plan) return json({ error: 'PLAN_NOT_FOUND' }, 404);
  if (kind === 'addon' && !addon) return json({ error: 'ADDON_NOT_FOUND' }, 404);
  const unitAmount = num(plan?.amount ?? addon?.amount);
  const amount = unitAmount * quantity;
  const currency = text(plan?.currency || addon?.currency) || 'KZT';
  const inserted = await dbWrite<BillingOrderRow[]>(env, 'imds_billing_orders', 'POST', {
    tenant_id: tenantId,
    organization_id: organizationId,
    product: 'marketing',
    kind,
    plan_code: kind === 'subscription' ? planCode : null,
    addon_code: kind === 'addon' ? addonCode : null,
    quantity,
    amount,
    currency,
    status: 'open',
    provider: cloudConfigured(env) ? 'cloudpayments' : null,
    payer_user_id: text(request.headers.get('x-imds-user-id')) || null,
    payer_email: text(request.headers.get('x-imds-user-email')) || null,
    due_at: addDays(new Date(), 1).toISOString(),
    metadata: { successUrl: text(body.successUrl), cancelUrl: text(body.cancelUrl) },
  });
  const order = inserted[0];
  if (!order?.id) return json({ error: 'ORDER_CREATE_FAILED' }, 500);
  if (!cloudConfigured(env)) return json({ error: 'CLOUDPAYMENTS_NOT_CONFIGURED', invoiceId: order.id }, 503);
  try {
    const checkout = await cloudOrder(env, order, `${productName()} · ${text(plan?.name || addon?.name)}`, text(body.successUrl) || publicOrigin(env, request), text(body.cancelUrl) || publicOrigin(env, request));
    await dbWrite(env, `imds_billing_orders?id=eq.${encodeURIComponent(order.id)}`, 'PATCH', { checkout_url: checkout.url, provider_order_id: checkout.providerOrderId, updated_at: nowIso() }, false);
    return json({ checkoutUrl: checkout.url, invoiceId: order.id, amount, currency });
  } catch (error) {
    await dbWrite(env, `imds_billing_orders?id=eq.${encodeURIComponent(order.id)}`, 'PATCH', { status: 'failed', failed_at: nowIso(), updated_at: nowIso() }, false).catch(() => undefined);
    return json({ error: error instanceof Error ? error.message : String(error), invoiceId: order.id }, 502);
  }
}

async function center(request: Request, env: Env): Promise<Response> {
  if (!authorized(request, env)) return json({ error: 'BILLING_CONTROL_UNAUTHORIZED' }, 401);
  const url = new URL(request.url);
  const tenantId = text(url.searchParams.get('externalTenantId'));
  if (!tenantId) return json({ error: 'TENANT_REQUIRED' }, 400);
  const [plans, addOns, subscription, invoices, grants] = await Promise.all([
    dbRows<BillingPlanRow[]>(env, 'imds_billing_plans?product=eq.marketing&active=eq.true&select=*&order=sort_order.asc'),
    dbRows<BillingAddonRow[]>(env, 'imds_billing_addons?product=eq.marketing&active=eq.true&select=*&order=sort_order.asc'),
    currentSubscription(env, tenantId),
    dbRows<Row[]>(env, `imds_billing_orders?tenant_id=eq.${encodeURIComponent(tenantId)}&select=id,status,amount,currency,issued_at,due_at,paid_at,checkout_url,plan_code,addon_code&order=issued_at.desc&limit=24`),
    activeAddonGrants(env, tenantId),
  ]);
  const planCode = text(subscription?.plan_code);
  return json({
    configured: true,
    gatewayAvailable: true,
    provider: cloudConfigured(env) ? 'cloudpayments' : null,
    plan: plans.find((plan) => text(plan.code) === planCode) ? { ...plans.find((plan) => text(plan.code) === planCode), current: true } : null,
    plans: plans.map((plan) => ({ code: text(plan.code), name: text(plan.name), description: text(plan.description) || null, amount: num(plan.amount), currency: text(plan.currency) || 'KZT', interval: text(plan.interval) || 'month', current: text(plan.code) === planCode, recommended: plan.recommended === true, limits: normalizeLimits(plan.limits) })),
    addOns: addOns.map((addon) => ({ code: text(addon.code), name: text(addon.name), description: text(addon.description) || null, amount: num(addon.amount), currency: text(addon.currency) || 'KZT', unit: text(addon.unit), quantity: grants.filter((grant) => text(grant.addon_code) === text(addon.code)).reduce((sum, grant) => sum + Math.max(1, Math.floor(num(grant.quantity))), 0), active: grants.some((grant) => text(grant.addon_code) === text(addon.code)) })),
    billing: subscription ? {
      subscriptionStatus: text(subscription.status), trialEndsAt: null, periodEndsAt: subscription.period_ends_at || null, graceEndsAt: subscription.grace_ends_at || null, accessEndsAt: subscription.access_ends_at || null,
      renewalMode: text(subscription.renewal_mode) || 'manual', currency: text(subscription.currency) || 'KZT', paymentMethods: text(subscription.provider) ? [{ method: text(subscription.provider), displayName: text(subscription.payment_method_label) || 'CloudPayments', instructions: 'Платёжные реквизиты находятся у провайдера', isDefault: true }] : [], defaultPaymentMethod: text(subscription.provider) || null,
    } : null,
    invoices: invoices.map((invoice) => ({ id: text(invoice.id), number: `BL-${text(invoice.id).slice(0,8).toUpperCase()}`, status: text(invoice.status), amount: num(invoice.amount), currency: text(invoice.currency) || 'KZT', issuedAt: invoice.issued_at || null, dueAt: invoice.due_at || null, paidAt: invoice.paid_at || null, url: text(invoice.checkout_url) || null })),
    capabilities: { checkout: cloudConfigured(env), portal: false, invoices: true, addOns: cloudConfigured(env) },
  });
}

async function invoices(request: Request, env: Env): Promise<Response> {
  if (!authorized(request, env)) return json({ error: 'BILLING_CONTROL_UNAUTHORIZED' }, 401);
  const tenantId = text(new URL(request.url).searchParams.get('externalTenantId'));
  const rows = tenantId ? await dbRows<Row[]>(env, `imds_billing_orders?tenant_id=eq.${encodeURIComponent(tenantId)}&select=id,status,amount,currency,issued_at,due_at,paid_at,checkout_url&order=issued_at.desc&limit=100`) : [];
  return json({ items: rows.map((invoice) => ({ id: text(invoice.id), number: `BL-${text(invoice.id).slice(0,8).toUpperCase()}`, status: text(invoice.status), amount: num(invoice.amount), currency: text(invoice.currency) || 'KZT', issuedAt: invoice.issued_at || null, dueAt: invoice.due_at || null, paidAt: invoice.paid_at || null, url: text(invoice.checkout_url) || null })) });
}

function secureSignature(raw: string, signature: string, secret: string): boolean {
  if (!raw || !signature || !secret) return false;
  const expected = createHmac('sha256', secret).update(Buffer.from(raw, 'utf8')).digest('base64');
  const left = Buffer.from(expected);
  const right = Buffer.from(signature);
  return left.length === right.length && timingSafeEqual(left, right);
}
async function webhookPayload(request: Request) {
  const url = new URL(request.url);
  if (request.method === 'GET') return { raw: url.search.slice(1), params: Object.fromEntries(url.searchParams.entries()) };
  const raw = await request.text();
  const params = Object.fromEntries(new URLSearchParams(raw).entries());
  return { raw, params };
}
function webhookSignature(request: Request) { return text(request.headers.get('Content-HMAC') || request.headers.get('X-Content-HMAC')); }
async function orderForWebhook(env: Env, params: Record<string,string>): Promise<BillingOrderRow | null> {
  const invoiceId = text(params.InvoiceId);
  if (!invoiceId) return null;
  const rows = await dbRows<BillingOrderRow[]>(env, `imds_billing_orders?id=eq.${encodeURIComponent(invoiceId)}&provider=eq.cloudpayments&select=*&limit=1`);
  return rows[0] || null;
}
function validWebhookOrder(order: BillingOrderRow | null, params: Record<string,string>) {
  if (!order) return false;
  if (text(params.AccountId) && text(params.AccountId) !== text(order.tenant_id)) return false;
  if (params.Amount && Math.abs(num(params.Amount) - num(order.amount)) > 0.01) return false;
  if (params.Currency && text(params.Currency).toUpperCase() !== (text(order.currency) || 'KZT').toUpperCase()) return false;
  return true;
}
async function upsertSubscriptionFromPayment(env: Env, order: BillingOrderRow, params: Record<string,string>) {
  const paidAt = new Date();
  const periodEndsAt = addMonths(paidAt, 1);
  const payload = {
    tenant_id: order.tenant_id,
    organization_id: order.organization_id || null,
    product: 'marketing',
    plan_code: order.plan_code,
    status: 'active',
    currency: order.currency || 'KZT',
    renewal_mode: 'manual',
    provider: 'cloudpayments',
    provider_subscription_id: text(params.SubscriptionId) || null,
    payment_method_label: text(params.CardType) ? `CloudPayments · ${text(params.CardType)}` : 'CloudPayments',
    period_started_at: paidAt.toISOString(),
    period_ends_at: periodEndsAt.toISOString(),
    grace_ends_at: null,
    access_ends_at: periodEndsAt.toISOString(),
    updated_at: paidAt.toISOString(),
  };
  const existing = await currentSubscription(env, text(order.tenant_id));
  if (existing) await dbWrite(env, `imds_billing_subscriptions?tenant_id=eq.${encodeURIComponent(text(order.tenant_id))}`, 'PATCH', payload, false);
  else await dbWrite(env, 'imds_billing_subscriptions', 'POST', payload, false);
}
async function grantAddonFromPayment(env: Env, order: BillingOrderRow) {
  const subscription = await currentSubscription(env, text(order.tenant_id));
  const fallbackEnd = addMonths(new Date(), 1).toISOString();
  await dbWrite(env, 'imds_billing_addon_grants?on_conflict=order_id,addon_code', 'POST', {
    tenant_id: order.tenant_id,
    order_id: order.id,
    addon_code: order.addon_code,
    quantity: Math.max(1, Math.floor(num(order.quantity))),
    status: 'active',
    starts_at: nowIso(),
    ends_at: subscription?.period_ends_at || fallbackEnd,
    updated_at: nowIso(),
  }, false);
}
async function handleCloudWebhook(request: Request, env: Env, event: string): Promise<Response> {
  if (!text(env.CLOUDPAYMENTS_API_SECRET)) return json({ code: 13 }, 503);
  const { raw, params } = await webhookPayload(request);
  if (!secureSignature(raw, webhookSignature(request), text(env.CLOUDPAYMENTS_API_SECRET))) return json({ code: 13 }, 401);
  const order = await orderForWebhook(env, params);
  if (!validWebhookOrder(order, params)) return json({ code: 10 });
  if (!order?.id) return json({ code: 10 });
  if (event === 'check') return json({ code: 0 });
  if (event === 'pay') {
    if (text(order.status) !== 'paid') {
      await dbWrite(env, `imds_billing_orders?id=eq.${encodeURIComponent(order.id)}`, 'PATCH', {
        status: 'paid', paid_at: nowIso(), provider_transaction_id: text(params.TransactionId) || null, provider_subscription_id: text(params.SubscriptionId) || null,
        card_last_four: text(params.CardLastFour) || null, card_type: text(params.CardType) || null, updated_at: nowIso(),
      }, false);
      if (text(order.kind) === 'subscription' || text(order.kind) === 'renewal') await upsertSubscriptionFromPayment(env, order, params);
      if (text(order.kind) === 'addon') await grantAddonFromPayment(env, order);
      await syncEntitlements(env, text(order.tenant_id));
    }
    return json({ code: 0 });
  }
  if (event === 'fail') {
    if (text(order.status) !== 'paid') await dbWrite(env, `imds_billing_orders?id=eq.${encodeURIComponent(order.id)}`, 'PATCH', { status: 'failed', failed_at: nowIso(), updated_at: nowIso() }, false);
    return json({ code: 0 });
  }
  if (event === 'refund') {
    await dbWrite(env, `imds_billing_orders?id=eq.${encodeURIComponent(order.id)}`, 'PATCH', { status: 'refunded', refunded_at: nowIso(), updated_at: nowIso() }, false);
    if (text(order.kind) === 'addon') await dbWrite(env, `imds_billing_addon_grants?order_id=eq.${encodeURIComponent(order.id)}`, 'PATCH', { status: 'refunded', updated_at: nowIso() }, false);
    if (text(order.kind) === 'subscription') {
      const latest = await dbRows<BillingOrderRow[]>(env, `imds_billing_orders?tenant_id=eq.${encodeURIComponent(text(order.tenant_id))}&kind=eq.subscription&status=eq.paid&select=id&order=paid_at.desc&limit=1`);
      if (!latest.length) {
        const graceEnd = addDays(new Date(), 3).toISOString();
        await dbWrite(env, `imds_billing_subscriptions?tenant_id=eq.${encodeURIComponent(text(order.tenant_id))}`, 'PATCH', { status: 'grace_period', grace_ends_at: graceEnd, access_ends_at: graceEnd, updated_at: nowIso() }, false);
      }
    }
    await syncEntitlements(env, text(order.tenant_id));
    return json({ code: 0 });
  }
  return json({ code: 0 });
}

export async function runBillingLifecycleTick(env: Env): Promise<void> {
  const now = new Date();
  const subscriptions = await dbRows<Row[]>(env, 'imds_billing_subscriptions?status=in.(active,past_due,grace_period)&select=*');
  for (const sub of subscriptions) {
    const tenantId = text(sub.tenant_id);
    const periodEnd = sub.period_ends_at ? new Date(String(sub.period_ends_at)) : null;
    const graceEnd = sub.grace_ends_at ? new Date(String(sub.grace_ends_at)) : null;
    let changed = false;
    if (text(sub.status) === 'active' && periodEnd && periodEnd <= now) {
      const nextGrace = addDays(periodEnd, 3);
      await dbWrite(env, `imds_billing_subscriptions?tenant_id=eq.${encodeURIComponent(tenantId)}`, 'PATCH', { status: 'past_due', grace_ends_at: nextGrace.toISOString(), access_ends_at: nextGrace.toISOString(), updated_at: nowIso() }, false);
      changed = true;
    } else if (text(sub.status) === 'past_due' && periodEnd && addDays(periodEnd, 1) <= now) {
      await dbWrite(env, `imds_billing_subscriptions?tenant_id=eq.${encodeURIComponent(tenantId)}`, 'PATCH', { status: 'grace_period', updated_at: nowIso() }, false);
      changed = true;
    } else if (text(sub.status) === 'grace_period' && graceEnd && graceEnd <= now) {
      await dbWrite(env, `imds_billing_subscriptions?tenant_id=eq.${encodeURIComponent(tenantId)}`, 'PATCH', { status: 'suspended', access_ends_at: graceEnd.toISOString(), updated_at: nowIso() }, false);
      changed = true;
    }
    if (changed) await syncEntitlements(env, tenantId);
  }
  const expiredGrants = await dbRows<Row[]>(env, `imds_billing_addon_grants?status=eq.active&ends_at=lte.${encodeURIComponent(now.toISOString())}&select=id,tenant_id`);
  const touched = new Set<string>();
  for (const grant of expiredGrants) {
    await dbWrite(env, `imds_billing_addon_grants?id=eq.${encodeURIComponent(text(grant.id))}`, 'PATCH', { status: 'expired', updated_at: nowIso() }, false);
    if (text(grant.tenant_id)) touched.add(text(grant.tenant_id));
  }
  for (const tenantId of touched) await syncEntitlements(env, tenantId);
}

export async function handleBillingControlPlaneRequest(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname === '/v1/billing/center' && request.method === 'GET') return center(request, env);
  if (url.pathname === '/v1/billing/invoices' && request.method === 'GET') return invoices(request, env);
  if (url.pathname === '/v1/billing/checkout' && request.method === 'POST') return createCheckout(request, env);
  if (url.pathname === '/v1/billing/portal' && request.method === 'POST') return json({ error: 'BILLING_PORTAL_NOT_SUPPORTED', provider: 'cloudpayments' }, 501);
  if (url.pathname === '/v1/billing/refresh' && request.method === 'POST') {
    if (!authorized(request, env)) return json({ error: 'BILLING_CONTROL_UNAUTHORIZED' }, 401);
    const body = await request.json().catch(() => null) as Row | null;
    const tenantId = text(body?.externalTenantId);
    if (tenantId) await syncEntitlements(env, tenantId);
    return json({ ok: true });
  }
  const webhook = url.pathname.match(/^\/api\/webhooks\/cloudpayments\/(check|pay|fail|refund)$/);
  if (webhook && (request.method === 'POST' || request.method === 'GET')) return handleCloudWebhook(request, env, webhook[1]);
  return null;
}
