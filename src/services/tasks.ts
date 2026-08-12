import { authFetch } from './auth';

export type TaskStatus = 'todo' | 'in_progress' | 'review' | 'done' | 'cancelled';
export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent';
export type TaskTargetType = 'all' | 'position' | 'job_title' | 'user';
export type TaskAssignmentMode = 'shared' | 'individual';

export interface TaskUser { id: string; name: string; email: string; jobTitle?: string | null; positionId?: string | null; positionName?: string | null; }
export interface TaskGroup { id: string; name: string; type: 'position' | 'job_title'; memberCount: number; }
export interface TaskTarget { id: string; targetType: TaskTargetType; targetValue?: string | null; targetLabel: string; }
export interface TaskExecution { id: string; userId: string; userName: string; status: TaskStatus; completedAt?: string | null; updatedAt: string; }
export interface TaskComment { id: string; userId: string; userName: string; body: string; createdAt: string; }
export interface WorkTask {
  id: string; title: string; description?: string | null; status: TaskStatus; priority: TaskPriority;
  dueAt?: string | null; completedAt?: string | null; createdAt: string; updatedAt: string;
  createdBy?: string | null; createdByName?: string | null; assignmentMode: TaskAssignmentMode;
  targets: TaskTarget[]; executions: TaskExecution[]; comments?: TaskComment[];
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await authFetch(`/api/tasks${path}`, { ...init, headers: { 'content-type': 'application/json', ...init?.headers } });
  const body = await response.text();
  const contentType = response.headers.get('content-type') || '';
  if (!response.ok) {
    if (contentType.includes('application/json')) {
      try { const parsed = JSON.parse(body) as { error?: string }; throw new Error(parsed.error || `Tasks API ${response.status}`); }
      catch (error) { if (error instanceof Error) throw error; }
    }
    throw new Error(body || `Tasks API ${response.status}`);
  }
  if (!body) return null as T;
  if (!contentType.includes('application/json')) throw new Error(`Tasks API returned ${contentType || 'non-JSON response'}`);
  return JSON.parse(body) as T;
}

export const tasksApi = {
  bootstrap: () => request<{ users: TaskUser[]; groups: TaskGroup[] }>('/bootstrap'),
  list: (scope = 'all') => request<{ tasks: WorkTask[] }>(`?scope=${encodeURIComponent(scope)}`),
  create: (payload: Record<string, unknown>) => request<{ task: WorkTask }>('', { method: 'POST', body: JSON.stringify(payload) }),
  update: (id: string, payload: Record<string, unknown>) => request<{ task: WorkTask }>(`/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  updateExecution: (taskId: string, status: TaskStatus) => request<{ task: WorkTask }>(`/${encodeURIComponent(taskId)}/execution`, { method: 'PATCH', body: JSON.stringify({ status }) }),
  comment: (taskId: string, body: string) => request<{ task: WorkTask }>(`/${encodeURIComponent(taskId)}/comments`, { method: 'POST', body: JSON.stringify({ body }) }),
};
