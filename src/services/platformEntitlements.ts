export type PlatformEntitlements = {
  managed: boolean;
  tenantId: string;
  organizationId: string | null;
  revision: number | null;
  productEnabled: boolean;
  modules: Record<string, boolean>;
  updatedAt: string | null;
};

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
    updatedAt: payload.updatedAt ? String(payload.updatedAt) : null,
  };
}
