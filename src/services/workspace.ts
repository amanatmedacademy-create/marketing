export type WorkspaceBlockKind = 'system' | 'metric' | 'table';

export interface WorkspaceBlock {
  id: string;
  route: string;
  blockKey: string;
  kind: WorkspaceBlockKind;
  title: string;
  dataSource: string | null;
  config: Record<string, unknown>;
  layout: Record<string, unknown>;
  isVisible: boolean;
  isSystem: boolean;
  updatedAt?: string | null;
}

export interface WorkspaceListResponse {
  route: string;
  blocks: WorkspaceBlock[];
  editable: boolean;
}

export type WorkspaceBlockInput = Omit<WorkspaceBlock, 'id' | 'updatedAt'> & { id?: string };

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, { ...init, headers: { 'content-type': 'application/json', ...init.headers } });
  const body = await response.text();
  if (!response.ok) {
    try { throw new Error((JSON.parse(body) as { error?: string }).error || body || `HTTP ${response.status}`); }
    catch (error) { if (error instanceof Error) throw error; throw new Error(body || `HTTP ${response.status}`); }
  }
  return (body ? JSON.parse(body) : null) as T;
}

export const workspaceApi = {
  list: (route: string) => request<WorkspaceListResponse>(`/api/workspace/blocks?route=${encodeURIComponent(route)}`),
  save: (block: WorkspaceBlockInput) => request<{ block: WorkspaceBlock }>('/api/workspace/blocks', { method: 'POST', body: JSON.stringify(block) }),
  patch: (id: string, patch: Partial<WorkspaceBlockInput>) => request<{ block: WorkspaceBlock }>(`/api/workspace/blocks/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  remove: (id: string) => request<{ ok: true; id: string }>(`/api/workspace/blocks/${encodeURIComponent(id)}`, { method: 'DELETE' }),
};
