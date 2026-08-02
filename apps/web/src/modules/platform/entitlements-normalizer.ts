export type PlatformProduct = {
  id: string;
  name?: string;
  description?: string | null;
  metadata?: Record<string, unknown>;
};

export type PlatformModule = {
  id: string;
  name?: string;
  description?: string | null;
  category?: string;
  route?: string | null;
  navigationLabel?: string | null;
  navigationOrder?: number;
  metadata?: Record<string, unknown>;
};

type EntitlementRef = string | { id?: unknown };

export type RawEntitlementsResponse = {
  companyId?: unknown;
  products?: unknown;
  modules?: unknown;
  capabilities?: unknown;
  limits?: unknown;
};

export type NormalizedEntitlements = {
  companyId: string;
  products: PlatformProduct[];
  modules: PlatformModule[];
  capabilities: string[];
  limits: Record<string, number>;
};

function normalizeRefs(value: unknown): Array<{ id: string }> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item: EntitlementRef) => {
    if (typeof item === 'string' && item.trim()) return [{ id: item.trim() }];
    if (item && typeof item === 'object' && typeof item.id === 'string' && item.id.trim()) {
      return [{ ...item, id: item.id.trim() }];
    }
    return [];
  });
}

function normalizeCapabilities(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && Boolean(item.trim())).map(item => item.trim());
}

function normalizeLimits(value: unknown): Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).flatMap(([key, item]) => {
    const numeric = Number(item);
    return Number.isFinite(numeric) ? [[key, numeric]] : [];
  }));
}

export function normalizeEntitlements(input: RawEntitlementsResponse): NormalizedEntitlements {
  return {
    companyId: typeof input.companyId === 'string' ? input.companyId : '',
    products: normalizeRefs(input.products),
    modules: normalizeRefs(input.modules),
    capabilities: normalizeCapabilities(input.capabilities),
    limits: normalizeLimits(input.limits),
  };
}
