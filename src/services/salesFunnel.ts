export type FunnelStageType = 'open' | 'won' | 'lost';
export type FunnelDealPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';

export type FunnelStage = {
  id: string;
  pipelineId: string;
  name: string;
  color: string;
  position: number;
  probability: number;
  stageType: FunnelStageType;
  createdAt: string;
  updatedAt: string;
};

export type FunnelPipeline = {
  id: string;
  name: string;
  isDefault: boolean;
  position: number;
  stages: FunnelStage[];
  createdAt: string;
  updatedAt: string;
};

export type FunnelDeal = {
  id: string;
  pipelineId: string;
  stageId: string;
  stage?: string;
  marketingLeadId?: string;
  contactId?: string;
  fullName: string;
  phone?: string;
  email?: string;
  source: string;
  priority: FunnelDealPriority;
  managerUserId?: string;
  diagnostUserId?: string;
  description?: string;
  amount: number;
  currency: string;
  status: string;
  position: number;
  paid: boolean;
  lostReason?: string;
  nextAction?: string;
  nextActionAt?: string;
  stageEnteredAt: string;
  createdAt: string;
  updatedAt: string;
  wonAt?: string;
  lostAt?: string;
};

export type FunnelLead = FunnelDeal;
export type FunnelUser = { id: string; fullName: string; role: string };
export type FunnelContact = { id: string; fullName: string; phone?: string; email?: string; source?: string; description?: string; crmDealId?: string };
export type FunnelStageEvent = { id: string; dealId: string; pipelineId: string; fromStageId?: string; toStageId: string; actorUserId?: string; reason?: string; createdAt: string };

export type FunnelStats = {
  total: number;
  open: number;
  won: number;
  lost: number;
  wonAmount: number;
  weightedAmount: number;
  overdue: number;
};

export type FunnelWorkspace = {
  companyId: string;
  pipelines: FunnelPipeline[];
  selectedPipelineId: string;
  deals: FunnelDeal[];
  leads: FunnelDeal[];
  users: FunnelUser[];
  events: FunnelStageEvent[];
  stats: FunnelStats;
};

type FunnelWorkspaceWire = Omit<FunnelWorkspace, 'leads'> & { leads?: FunnelDeal[] };

export type FunnelDealInput = {
  pipelineId?: string;
  stageId?: string;
  marketingLeadId?: string | null;
  fullName?: string;
  phone?: string | null;
  email?: string | null;
  source?: string | null;
  priority?: FunnelDealPriority;
  managerUserId?: string | null;
  diagnostUserId?: string | null;
  description?: string | null;
  amount?: number;
  paid?: boolean;
  lostReason?: string | null;
  nextAction?: string | null;
  nextActionAt?: string | null;
};

class FunnelApiError extends Error {
  constructor(message: string, readonly status?: number, readonly requestId?: string) {
    super(message);
    this.name = 'FunnelApiError';
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api/funnel${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...init.headers }
  });
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  let payload: unknown = null;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = null; }
  if (!response.ok) {
    const structured = payload && typeof payload === 'object' && !Array.isArray(payload)
      ? payload as { error?: unknown; requestId?: unknown }
      : null;
    throw new FunnelApiError(
      typeof structured?.error === 'string' ? structured.error : `API воронки вернул HTTP ${response.status}`,
      response.status,
      typeof structured?.requestId === 'string' ? structured.requestId : undefined
    );
  }
  return payload as T;
}

function withLegacyStage(deal: FunnelDeal): FunnelDeal {
  if (deal.stage) return deal;
  return { ...deal, stage: deal.status === 'won' ? 'COURSE' : deal.status === 'lost' ? 'LOST' : 'NEW' };
}

export const fetchFunnelWorkspace = async (options: {
  pipelineId?: string;
  query?: string;
  managerId?: string;
  diagnostId?: string;
  priority?: FunnelDealPriority | '';
  stageId?: string;
  limit?: number;
} = {}): Promise<FunnelWorkspace> => {
  const params = new URLSearchParams();
  if (options.pipelineId) params.set('pipelineId', options.pipelineId);
  if (options.query?.trim()) params.set('q', options.query.trim());
  if (options.managerId) params.set('managerId', options.managerId);
  if (options.diagnostId) params.set('diagnostId', options.diagnostId);
  if (options.priority) params.set('priority', options.priority);
  if (options.stageId) params.set('stageId', options.stageId);
  if (options.limit) params.set('limit', String(options.limit));
  const workspace = await request<FunnelWorkspaceWire>(`/workspace?${params.toString()}`);
  const deals = workspace.deals.map(withLegacyStage);
  return { ...workspace, deals, leads: (workspace.leads || deals).map(withLegacyStage) };
};

export const searchFunnelContacts = (query: string) => {
  const params = new URLSearchParams();
  if (query.trim()) params.set('q', query.trim());
  return request<FunnelContact[]>(`/contacts?${params.toString()}`);
};

export const createFunnelDeal = (input: FunnelDealInput) => request<FunnelDeal>('/leads', { method: 'POST', body: JSON.stringify(input) });
export const updateFunnelDeal = (id: string, input: FunnelDealInput) => request<FunnelDeal>(`/leads/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(input) });
export const moveFunnelDeal = (id: string, input: { pipelineId: string; stageId: string; position?: number; reason?: string }) => request<FunnelDeal>(`/leads/${encodeURIComponent(id)}/move`, { method: 'POST', body: JSON.stringify(input) });

export const createFunnelPipeline = (input: { name: string; isDefault?: boolean }) => request<FunnelPipeline>('/pipelines', { method: 'POST', body: JSON.stringify(input) });
export const updateFunnelPipeline = (id: string, input: { name?: string; isDefault?: boolean; position?: number }) => request<FunnelPipeline>(`/pipelines/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(input) });
export const deleteFunnelPipeline = (id: string) => request<void>(`/pipelines/${encodeURIComponent(id)}`, { method: 'DELETE' });

export const createFunnelStage = (input: { pipelineId: string; name: string; color?: string; probability?: number; stageType?: FunnelStageType; afterStageId?: string }) => request<FunnelStage>('/stages', { method: 'POST', body: JSON.stringify(input) });
export const updateFunnelStage = (id: string, input: { name?: string; color?: string; probability?: number; stageType?: FunnelStageType; position?: number }) => request<FunnelStage>(`/stages/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(input) });
export const deleteFunnelStage = (id: string) => request<void>(`/stages/${encodeURIComponent(id)}`, { method: 'DELETE' });
