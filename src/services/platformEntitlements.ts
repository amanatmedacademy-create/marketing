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

export type PlatformEntitlements = {
  managed: boolean;
  tenantId: string;
  organizationId: string | null;
  revision: number | null;
  productEnabled: boolean;
  modules: Record<string, boolean>;
  billing: PlatformBillingState | null;
  updatedAt: string | null;
};

function billingState(value: unknown): PlatformBillingState | null {
  if (!value || Array.isArray(value) || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const methods = Array.isArray(raw.paymentMethods) ? raw.paymentMethods.flatMap((item) => {
    if (!item || Array.isArray(item) || typeof item !== 'object') return [];
    const method = item as Record<string, unknown>;
    const code = typeof method.method === 'string' ? method.method : '';
    if (!code) return [];
    return [{
      method: code,
      displayName: typeof method.displayName === 'string' && method.displayName ? method.displayName : code,
      instructions: typeof method.instructions === 'string' && method.instructions ? method.instructions : null,
      isDefault: method.isDefault === true,
    }];
  }) : [];
  const stringOrNull = (key: string) => typeof raw[key] === 'string' && raw[key] ? String(raw[key]) : null;
  return {
    subscriptionStatus: stringOrNull('subscriptionStatus'),
    trialEndsAt: stringOrNull('trialEndsAt'),
    periodEndsAt: stringOrNull('periodEndsAt'),
    graceEndsAt: stringOrNull('graceEndsAt'),
    accessEndsAt: stringOrNull('accessEndsAt'),
    renewalMode: stringOrNull('renewalMode'),
    currency: stringOrNull('currency') || 'KZT',
    paymentMethods: methods,
    defaultPaymentMethod: stringOrNull('defaultPaymentMethod'),
  };
}

export async function loadPlatformEntitlements(): Promise<PlatformEntitlements> {
  const response = await fetch('/api/platform/entitlements', { cache: 'no-store' });
  const raw = await response.text();
  let payload: Partial<PlatformEntitlements> & { error?: string } = {};
  try { payload = raw ? JSON.parse(raw) as typeof payload : {}; } catch { payload = {}; }
  if (!response.ok) throw new Error(payload.error || raw || `Platform entitlement HTTP ${response.status}`);
  return {
    managed: payload.managed === true,
    tenantId: String(payload.tenantId || ''),
    organizationId: payload.organizationId ? String(payload.organizationId) : null,
    revision: typeof payload.revision === 'number' ? payload.revision : null,
    productEnabled: payload.productEnabled !== false,
    modules: payload.modules && typeof payload.modules === 'object' ? payload.modules : {},
    billing: billingState(payload.billing),
    updatedAt: payload.updatedAt ? String(payload.updatedAt) : null,
  };
}
