import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useAuth } from '../components/AuthGate';
import { currentSession } from '../services/auth';
import { loadBranches } from '../services/branches';
import { loadPlatformEntitlements, type PlatformEntitlements } from '../services/platformEntitlements';
import { createPlatformClient } from './client';
import { buildPlatformFrontendContext, buildPlatformFrontendContextFromMeContext } from './context';
import { productRegistry } from './productRegistry';
import { activeBranchId, activeOrganizationId } from './selection';
import type { PlatformFrontendContext } from './types';

type PlatformContextSource = 'canonical' | 'legacy';

type PlatformContextValue = {
  context: PlatformFrontendContext | null;
  platform: PlatformEntitlements | null;
  source: 'canonical' | 'legacy';
  loading: boolean;
  error: string | null;
  canonicalError: string | null;
  refresh: () => Promise<void>;
};

const PlatformContext = createContext<PlatformContextValue | null>(null);

export function usePlatformContext(): PlatformContextValue {
  const value = useContext(PlatformContext);
  if (!value) throw new Error('Platform context is unavailable');
  return value;
}

export function PlatformContextProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [context, setContext] = useState<PlatformFrontendContext | null>(null);
  const [platform, setPlatform] = useState<PlatformEntitlements | null>(null);
  const [source, setSource] = useState<PlatformContextSource>('legacy');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [canonicalError, setCanonicalError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const organizationId = activeOrganizationId() || user.companyId || '';
    const branchId = activeBranchId();
    setLoading(true);
    setError(null);

    const legacyPromise = Promise.allSettled([
      loadPlatformEntitlements(),
      loadBranches(),
    ] as const);

    const platformClient = createPlatformClient({
      baseUrl: window.location.origin,
      tokenProvider: async () => (await currentSession())?.access_token || null,
    });

    try {
      const meContext = await platformClient.getMeContext();
      const canonical = buildPlatformFrontendContextFromMeContext(meContext, organizationId, branchId);
      const [platformResult] = await legacyPromise;
      const platformMetadata = platformResult.status === 'fulfilled' ? platformResult.value : null;
      setPlatform(platformMetadata);
      setContext({ ...canonical, products: productRegistry.list() });
      setSource('canonical');
      setCanonicalError(null);
      setError(null);
      setLoading(false);
      return;
    } catch (reason) {
      setCanonicalError(reason instanceof Error ? reason.message : String(reason));
    }

    try {
      const [platformResult, branchesResult] = await legacyPromise;
      const platformMetadata = platformResult.status === 'fulfilled' ? platformResult.value : null;
      const branches = branchesResult.status === 'fulfilled'
        ? branchesResult.value.items.map((branch) => ({
            id: branch.id,
            code: branch.code || '',
            name: branch.name,
            status: branch.status,
          }))
        : [];
      const legacy = buildPlatformFrontendContext({
        user,
        organizationId,
        branchId,
        branches,
        platform: platformMetadata,
        products: productRegistry.list(),
      });
      setPlatform(platformMetadata);
      setContext(legacy);
      setSource('legacy');
      setError(null);
    } catch (reason) {
      setPlatform(null);
      setContext(null);
      setSource('legacy');
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => { void refresh(); }, [refresh]);

  const value = useMemo<PlatformContextValue>(() => ({
    context,
    platform,
    source,
    loading,
    error,
    canonicalError,
    refresh,
  }), [context, platform, source, loading, error, canonicalError, refresh]);

  return <PlatformContext.Provider value={value}>{children}</PlatformContext.Provider>;
}
