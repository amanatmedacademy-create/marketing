import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { apiFetch } from '../../lib/api-client';
import { useAuth } from '../auth/AuthContext';
import {
  normalizeEntitlements,
  type NormalizedEntitlements,
  type RawEntitlementsResponse,
} from './entitlements-normalizer';

type EntitlementsContextValue = NormalizedEntitlements & {
  loading: boolean;
  error: string | null;
  hasProduct: (id: string) => boolean;
  hasModule: (id: string) => boolean;
  hasCapability: (id: string) => boolean;
  getLimit: (id: string, fallback?: number) => number;
  refresh: () => Promise<void>;
};

const EMPTY: NormalizedEntitlements = {
  companyId: '',
  products: [],
  modules: [],
  capabilities: [],
  limits: {},
};

const EntitlementsContext = createContext<EntitlementsContextValue | null>(null);

export function EntitlementsProvider({ children }: { children: ReactNode }) {
  const { currentUser } = useAuth();
  const [data, setData] = useState<NormalizedEntitlements>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const response = await apiFetch<RawEntitlementsResponse>('/platform/entitlements');
      const normalized = normalizeEntitlements(response);
      if (!normalized.companyId) throw new Error('Некорректный ответ Platform Core');
      setData(normalized);
    } catch (reason) {
      setData(EMPTY);
      setError(reason instanceof Error ? reason.message : 'Не удалось загрузить права компании');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void refresh(); }, [currentUser.companyId]);

  const productIds = useMemo(() => new Set(data.products.map(item => item.id)), [data.products]);
  const moduleIds = useMemo(() => new Set(data.modules.map(item => item.id)), [data.modules]);
  const capabilityIds = useMemo(() => new Set(data.capabilities), [data.capabilities]);

  const value = useMemo<EntitlementsContextValue>(() => ({
    ...data,
    loading,
    error,
    hasProduct: id => productIds.has(id),
    hasModule: id => moduleIds.has(id),
    hasCapability: id => capabilityIds.has(id),
    getLimit: (id, fallback = 0) => Number(data.limits[id] ?? fallback),
    refresh,
  }), [data, loading, error, productIds, moduleIds, capabilityIds]);

  return <EntitlementsContext.Provider value={value}>{children}</EntitlementsContext.Provider>;
}

export function useEntitlements() {
  const value = useContext(EntitlementsContext);
  if (!value) throw new Error('useEntitlements must be used inside EntitlementsProvider');
  return value;
}

export function EntitlementBoundary({
  module,
  capability,
  fallback = null,
  children,
}: {
  module?: string;
  capability?: string;
  fallback?: ReactNode;
  children: ReactNode;
}) {
  const entitlements = useEntitlements();
  if (entitlements.loading) return null;
  if (module && !entitlements.hasModule(module)) return <>{fallback}</>;
  if (capability && !entitlements.hasCapability(capability)) return <>{fallback}</>;
  return <>{children}</>;
}
