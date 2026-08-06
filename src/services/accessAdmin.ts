export type AccessAction = 'view' | 'create' | 'edit' | 'delete' | 'export' | 'manage';
export type AccessGrant = Record<AccessAction, boolean>;
export type NullableAccessGrant = Record<AccessAction, boolean | null>;

export interface AccessModule {
  id: string;
  name: string;
  description?: string;
  category: string;
  route?: string;
  navigation_label?: string;
  navigation_order: number;
  metadata?: { access_actions?: AccessAction[] };
}

export interface AccessPosition {
  id: string;
  company_id: string;
  name: string;
  description?: string;
  system_key?: string;
  is_system: boolean;
}

export interface PositionPermission {
  position_id: string;
  company_id: string;
  module_id: string;
  can_view: boolean;
  can_create: boolean;
  can_edit: boolean;
  can_delete: boolean;
  can_export: boolean;
  can_manage: boolean;
}

export interface UserAssignment {
  company_id: string;
  user_id: string;
  position_id?: string | null;
  job_title?: string | null;
}

export interface UserOverride {
  company_id: string;
  user_id: string;
  module_id: string;
  can_view: boolean | null;
  can_create: boolean | null;
  can_edit: boolean | null;
  can_delete: boolean | null;
  can_export: boolean | null;
  can_manage: boolean | null;
}

export interface AccessWorkspace {
  modules: AccessModule[];
  positions: AccessPosition[];
  permissions: PositionPermission[];
  assignments: UserAssignment[];
  overrides: UserOverride[];
  members: Array<{ user_id: string; role: string; status: string }>;
}

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api/admin/users/access${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...init.headers },
  });
  const payload = await response.json().catch(() => ({})) as { error?: string };
  if (!response.ok) throw new Error(payload.error || `Ошибка матрицы прав: ${response.status}`);
  return payload as T;
}

export const fetchAccessWorkspace = () => api<AccessWorkspace>('/workspace');
export const createAccessPosition = (input: { name: string; description?: string }) => api<{ position: AccessPosition }>('/positions', { method: 'POST', body: JSON.stringify(input) });
export const updateAccessPosition = (id: string, input: { name?: string; description?: string }) => api<{ position: AccessPosition }>(`/positions/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(input) });
export const savePositionPermissions = (id: string, permissions: Array<{ moduleId: string } & AccessGrant>) => api<{ ok: boolean }>(`/positions/${encodeURIComponent(id)}/permissions`, { method: 'PUT', body: JSON.stringify({ permissions }) });
export const assignUserAccess = (userId: string, input: { positionId?: string | null; jobTitle?: string | null }) => api<{ assignment: UserAssignment }>(`/users/${encodeURIComponent(userId)}/assignment`, { method: 'PUT', body: JSON.stringify(input) });
export const saveUserOverrides = (userId: string, overrides: Array<{ moduleId: string } & NullableAccessGrant>) => api<{ ok: boolean }>(`/users/${encodeURIComponent(userId)}/overrides`, { method: 'PUT', body: JSON.stringify({ overrides }) });
