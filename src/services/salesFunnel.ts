// Воронка Продаж: клиент API, порт ropApi из МИС.
// Auth-заголовок добавляет глобальный fetch-патч в AuthGate.

export type FunnelLeadStage = 'NEW' | 'QUALIFICATION' | 'APPOINTMENT' | 'DIAGNOSTIC' | 'COURSE' | 'LOST';
export type FunnelLeadPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
export type FunnelLeadAction = 'WHATSAPP' | 'BOOK' | 'COURSE' | 'LOST' | 'RESTORE';

export type FunnelLead = {
  id: string;
  contactId?: string;
  fullName: string;
  phone?: string;
  diagnosis?: string;
  source: string;
  priority: FunnelLeadPriority;
  stage: FunnelLeadStage;
  diagnostUserId?: string;
  managerUserId?: string;
  amount: number;
  paid: boolean;
  whatsappCount: number;
  lostReason?: string;
  createdAt: string;
  updatedAt: string;
  closedAt?: string;
};

export type FunnelActivity = {
  id: string;
  leadId: string;
  type: string;
  title: string;
  details: Record<string, unknown>;
  actorUserId?: string;
  createdAt: string;
};

export type FunnelUser = { id: string; fullName: string; role: string; position?: string };
export type FunnelContact = { id: string; fullName: string; phone?: string; diagnosis?: string };

export type FunnelWorkspaceStats = {
  total: number;
  open: number;
  won: number;
  lost: number;
  courseAmount: number;
  byStage: Record<FunnelLeadStage, number>;
};

export type FunnelWorkspacePagination = {
  offset: number;
  limit: number;
  loaded: number;
  total: number;
  hasMore: boolean;
  nextOffset: number | null;
  nextCursor?: string | null;
};

type FunnelWorkspaceWirePagination = Omit<FunnelWorkspacePagination, 'total'> & { total: number | null };

export type FunnelWorkspaceFilters = {
  query: string;
  managerId: string;
  diagnostId: string;
  priority: FunnelLeadPriority | '';
  stage: FunnelLeadStage | '';
};

export type FunnelWorkspace = {
  leads: FunnelLead[];
  activities: FunnelActivity[];
  users: FunnelUser[];
  contacts: FunnelContact[];
  stats?: FunnelWorkspaceStats;
  pagination?: FunnelWorkspacePagination;
  filters?: FunnelWorkspaceFilters;
};

type FunnelWorkspaceWire = Omit<FunnelWorkspace, 'pagination'> & { pagination?: FunnelWorkspaceWirePagination };

export type FunnelLeadInput = {
  contactId?: string | null;
  fullName?: string;
  phone?: string | null;
  diagnosis?: string | null;
  source?: string;
  priority?: FunnelLeadPriority;
  stage?: FunnelLeadStage;
  diagnostUserId?: string | null;
  managerUserId?: string | null;
  amount?: number;
  paid?: boolean;
  lostReason?: string | null;
};

export type FunnelKanbanColumn = {
  stage: FunnelLeadStage;
  title: string;
  subtitle: string;
  color: string;
  wipLimit: number;
  visible: boolean;
};

export type FunnelKanbanFilters = {
  sources: string[];
  priorities: FunnelLeadPriority[];
  diagnostUserIds: string[];
  managerUserIds: string[];
};

export type FunnelKanbanBoard = {
  id: string;
  name: string;
  description?: string;
  columns: FunnelKanbanColumn[];
  filters: FunnelKanbanFilters;
  showTotals: boolean;
  isDefault: boolean;
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

export type FunnelKanbanBoardInput = {
  name: string;
  description?: string | null;
  columns: FunnelKanbanColumn[];
  filters: FunnelKanbanFilters;
  showTotals: boolean;
  isDefault?: boolean;
  sortOrder?: number;
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
    const message = typeof structured?.error === 'string' && structured.error
      ? structured.error
      : `API воронки вернул HTTP ${response.status}`;
    const requestId = typeof structured?.requestId === 'string' ? structured.requestId : undefined;
    throw new FunnelApiError(message, response.status, requestId);
  }
  return payload as T;
}

const cursorPagesByFilter = new Map<string, Map<number, string>>();
const totalByFilter = new Map<string, number>();
const MAX_CURSOR_FILTERS = 20;

function filterKey(options: {
  limit: number;
  query?: string;
  managerId?: string;
  diagnostId?: string;
  priority?: FunnelLeadPriority | '';
  stage?: FunnelLeadStage | '';
}): string {
  return JSON.stringify([
    options.limit,
    options.query?.trim() || '',
    options.managerId || '',
    options.diagnostId || '',
    options.priority || '',
    options.stage || ''
  ]);
}

function resetCursorFilter(key: string): Map<number, string> {
  cursorPagesByFilter.delete(key);
  cursorPagesByFilter.set(key, new Map());
  totalByFilter.delete(key);
  while (cursorPagesByFilter.size > MAX_CURSOR_FILTERS) {
    const oldest = cursorPagesByFilter.keys().next().value as string | undefined;
    if (!oldest) break;
    cursorPagesByFilter.delete(oldest);
    totalByFilter.delete(oldest);
  }
  return cursorPagesByFilter.get(key) as Map<number, string>;
}

export const fetchFunnelWorkspace = async (options: {
  offset?: number;
  limit?: number;
  query?: string;
  managerId?: string;
  diagnostId?: string;
  priority?: FunnelLeadPriority | '';
  stage?: FunnelLeadStage | '';
} = {}): Promise<FunnelWorkspace> => {
  const offset = Math.max(0, Math.trunc(options.offset ?? 0));
  const limit = Math.min(1000, Math.max(50, Math.trunc(options.limit ?? 500)));
  const key = filterKey({ ...options, limit });
  const pages = offset === 0 ? resetCursorFilter(key) : (cursorPagesByFilter.get(key) || new Map<number, string>());
  const cursor = offset > 0 ? pages.get(offset) : undefined;
  const params = new URLSearchParams();
  if (cursor) params.set('cursor', cursor); else params.set('offset', String(offset));
  params.set('limit', String(limit));
  if (options.query?.trim()) params.set('q', options.query.trim());
  if (options.managerId) params.set('managerId', options.managerId);
  if (options.diagnostId) params.set('diagnostId', options.diagnostId);
  if (options.priority) params.set('priority', options.priority);
  if (options.stage) params.set('stage', options.stage);

  const raw = await request<FunnelWorkspaceWire>(`/workspace?${params.toString()}`);
  if (!raw.pagination) return raw as FunnelWorkspace;

  const rawPagination = raw.pagination;
  if (rawPagination.total != null) totalByFilter.set(key, rawPagination.total);
  const total = rawPagination.total ?? totalByFilter.get(key) ?? offset + rawPagination.loaded + (rawPagination.hasMore ? 1 : 0);
  const nextOffset = rawPagination.hasMore ? offset + rawPagination.loaded : null;
  if (nextOffset != null && rawPagination.nextCursor) {
    const activePages = cursorPagesByFilter.get(key) || pages;
    activePages.set(nextOffset, rawPagination.nextCursor);
    cursorPagesByFilter.set(key, activePages);
  }

  return {
    ...raw,
    pagination: {
      ...rawPagination,
      offset,
      total,
      nextOffset
    }
  };
};

export const searchFunnelContacts = (query: string, limit = 50) => {
  const params = new URLSearchParams();
  if (query.trim()) params.set('q', query.trim());
  params.set('limit', String(Math.min(100, Math.max(1, Math.trunc(limit)))));
  return request<FunnelContact[]>(`/contacts?${params.toString()}`);
};
export const createFunnelLead = (input: FunnelLeadInput) => request<FunnelLead>('/leads', { method: 'POST', body: JSON.stringify(input) });
export const updateFunnelLead = (id: string, input: FunnelLeadInput) => request<FunnelLead>(`/leads/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(input) });
export const runFunnelLeadAction = (id: string, action: FunnelLeadAction, lostReason?: string) => request<FunnelLead>(`/leads/${encodeURIComponent(id)}/actions`, { method: 'POST', body: JSON.stringify({ action, lostReason }) });

export const fetchFunnelKanbanBoards = () => request<FunnelKanbanBoard[]>('/boards');
export const createFunnelKanbanBoard = (input: FunnelKanbanBoardInput) => request<FunnelKanbanBoard>('/boards', { method: 'POST', body: JSON.stringify(input) });
export const updateFunnelKanbanBoard = (id: string, input: Partial<FunnelKanbanBoardInput>) => request<FunnelKanbanBoard>(`/boards/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(input) });
export const archiveFunnelKanbanBoard = (id: string) => request<void>(`/boards/${encodeURIComponent(id)}`, { method: 'DELETE' });
