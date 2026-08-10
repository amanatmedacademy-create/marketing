import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import type { FunnelDeal, FunnelPipeline, FunnelUser } from '../services/salesFunnel';

export type DealWorkspaceContext = {
  deal: FunnelDeal;
  pipeline: FunnelPipeline;
  users: FunnelUser[];
};

type DealWorkspaceControllerValue = {
  context: DealWorkspaceContext | null;
  open: (context: DealWorkspaceContext) => void;
  close: () => void;
};

const DealWorkspaceControllerContext = createContext<DealWorkspaceControllerValue | null>(null);

export function DealWorkspaceProvider({ children }: { children: ReactNode }) {
  const [context, setContext] = useState<DealWorkspaceContext | null>(null);
  const open = useCallback((next: DealWorkspaceContext) => setContext(next), []);
  const close = useCallback(() => setContext(null), []);
  const value = useMemo(() => ({ context, open, close }), [close, context, open]);

  return <DealWorkspaceControllerContext.Provider value={value}>{children}</DealWorkspaceControllerContext.Provider>;
}

export function useDealWorkspaceController(): DealWorkspaceControllerValue {
  const value = useContext(DealWorkspaceControllerContext);
  if (!value) throw new Error('useDealWorkspaceController must be used inside DealWorkspaceProvider');
  return value;
}
