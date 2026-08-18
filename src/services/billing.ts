export type BillingPlan = { code: string; name: string; description?: string | null; amount?: number | null; currency?: string | null; interval?: string | null; current?: boolean; recommended?: boolean; limits?: Record<string, number>; prices?: Record<string, number>; pricingMode?: 'fixed' | 'request' | string };
export type BillingAddOn = { code: string; name: string; description?: string | null; amount?: number | null; currency?: string | null; unit?: string | null; quantity?: number; active?: boolean; prices?: Record<string, number> };
export type BillingInvoice = { id: string; number?: string | null; status?: string | null; amount?: number | null; currency?: string | null; issuedAt?: string | null; dueAt?: string | null; paidAt?: string | null; outstandingAmount?: number | null; url?: string | null };
export type BillingMethod = { method: string; displayName: string; instructions: string | null; isDefault: boolean };
export type BillingState = { subscriptionStatus: string | null; trialEndsAt: string | null; periodEndsAt: string | null; graceEndsAt: string | null; accessEndsAt: string | null; renewalMode: string | null; billingPeriodMonths?: number | null; currency: string; paymentMethods: BillingMethod[]; defaultPaymentMethod: string | null };
export type BillingCenterState = {
  configured: boolean;
  gatewayAvailable: boolean;
  managed: boolean;
  tenantId: string;
  organizationId: string | null;
  billing: BillingState | null;
  plan: BillingPlan | null;
  plans: BillingPlan[];
  addOns: BillingAddOn[];
  invoices: BillingInvoice[];
  capabilities: { checkout?: boolean; portal?: boolean; invoices?: boolean; addOns?: boolean };
  permissions: { canRead: boolean; canManage: boolean };
  gatewayError?: string | null;
};

type LinkResponse = { url?: string; checkoutUrl?: string; portalUrl?: string; invoiceCreated?: boolean; invoiceId?: string; invoiceNumber?: string; error?: string };

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { cache: 'no-store', ...init, headers: { 'content-type': 'application/json', ...(init?.headers || {}) } });
  const raw = await response.text();
  let payload: unknown = null;
  try { payload = raw ? JSON.parse(raw) : null; } catch { payload = raw; }
  if (!response.ok) {
    const message = payload && typeof payload === 'object' && 'error' in payload ? String((payload as { error?: unknown }).error || '') : raw;
    throw new Error(message || `Billing HTTP ${response.status}`);
  }
  return payload as T;
}

export const loadBillingCenter = () => request<BillingCenterState>('/api/billing/center');
export const refreshBilling = () => request<Record<string, unknown>>('/api/billing/refresh', { method: 'POST', body: '{}' });
export const loadInvoices = () => request<{ items?: BillingInvoice[] } | BillingInvoice[]>('/api/billing/invoices');

export async function startCheckout(input: { kind: 'subscription' | 'addon'; planCode?: string; addonCode?: string; quantity?: number; billingPeriodMonths?: number }) {
  const result = await request<LinkResponse>('/api/billing/checkout', { method: 'POST', body: JSON.stringify(input) });
  const url = result.checkoutUrl || result.url;
  if (url) { window.location.assign(url); return result; }
  if (result.invoiceCreated) return result;
  throw new Error(result.error || 'BILLING_CHECKOUT_RESULT_MISSING');
}

export async function openBillingPortal() {
  const result = await request<LinkResponse>('/api/billing/portal', { method: 'POST', body: '{}' });
  const url = result.portalUrl || result.url;
  if (!url) throw new Error(result.error || 'PORTAL_URL_MISSING');
  window.location.assign(url);
}
