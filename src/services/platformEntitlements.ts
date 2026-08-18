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
export type PlatformQuotaMetric = {
  key: PlatformLimitKey;
  used: number;
  limit: number;
  remaining: number;
  percent: number;
  level: 'ok' | 'warning' | 'critical' | 'exceeded';
  enforcement: 'hard' | 'soft';
};
export type PlatformQuotaSnapshot = {
  usage: Record<PlatformLimitKey, number>;
  quotas: PlatformQuotaMetric[];
};

export type PlatformEntitlements = {
  managed: boolean;
  tenantId: string;
  organizationId: string | null;
  revision: number | null;
  productEnabled: boolean;
  modules: Record<string, boolean>;
  limits: PlatformLimits;
  quota: PlatformQuotaSnapshot | null;
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

function limitsState(value: unknown): PlatformLimits {
  if (!value || Array.isArray(value) || typeof value !== 'object') return {};
  const raw = value as Record<string, unknown>;
  const result: PlatformLimits = {};
  (['clinics','users','leads','openTasks','integrations'] as PlatformLimitKey[]).forEach((key) => {
    const parsed = Number(raw[key]);
    if (Number.isFinite(parsed) && parsed >= 0) result[key] = Math.floor(parsed);
  });
  return result;
}

function quotaState(value: unknown): PlatformQuotaSnapshot | null {
  if (!value || Array.isArray(value) || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const usageRaw = raw.usage && typeof raw.usage === 'object' && !Array.isArray(raw.usage) ? raw.usage as Record<string, unknown> : {};
  const usage = {
    clinics: Number(usageRaw.clinics) || 0,
    users: Number(usageRaw.users) || 0,
    leads: Number(usageRaw.leads) || 0,
    openTasks: Number(usageRaw.openTasks) || 0,
    integrations: Number(usageRaw.integrations) || 0,
  };
  const quotas = Array.isArray(raw.quotas) ? raw.quotas.flatMap((item) => {
    if (!item || Array.isArray(item) || typeof item !== 'object') return [];
    const row = item as Record<string, unknown>;
    const key = String(row.key || '') as PlatformLimitKey;
    if (!['clinics','users','leads','openTasks','integrations'].includes(key)) return [];
    return [{
      key,
      used: Number(row.used) || 0,
      limit: Number(row.limit) || 0,
      remaining: Number(row.remaining) || 0,
      percent: Number(row.percent) || 0,
      level: (['ok','warning','critical','exceeded'].includes(String(row.level)) ? String(row.level) : 'ok') as PlatformQuotaMetric['level'],
      enforcement: row.enforcement === 'soft' ? 'soft' as const : 'hard' as const,
    }];
  }) : [];
  return { usage, quotas };
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
    limits: limitsState(payload.limits),
    quota: quotaState(payload.quota),
    billing: billingState(payload.billing),
    updatedAt: payload.updatedAt ? String(payload.updatedAt) : null,
  };
}
