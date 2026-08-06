export type ManagedUserRole = 'administrator' | 'marketer' | 'analyst' | 'viewer';
export type ManagedUserStatus = 'active' | 'invited' | 'blocked';

export interface ManagedUser {
  id: string;
  name: string;
  email: string;
  role: ManagedUserRole;
  status: ManagedUserStatus;
  membershipRole: 'owner' | 'administrator' | 'manager' | 'viewer';
  connected: boolean;
  avatarUrl: string | null;
  lastSeenAt: string | null;
  createdAt: string;
}

export interface ManagedUserInput {
  name: string;
  email: string;
  role: ManagedUserRole;
  status: ManagedUserStatus;
}

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { 'content-type': 'application/json', ...init.headers },
  });
  const payload = await response.json().catch(() => ({})) as { error?: string };
  if (!response.ok) throw new Error(payload.error || `Ошибка управления пользователями: ${response.status}`);
  return payload as T;
}

export async function fetchManagedUsers(): Promise<ManagedUser[]> {
  const payload = await api<{ users: ManagedUser[] }>('/api/admin/users');
  return payload.users;
}

export async function createManagedUser(input: ManagedUserInput): Promise<ManagedUser> {
  const payload = await api<{ user: ManagedUser }>('/api/admin/users', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return payload.user;
}

export async function updateManagedUser(id: string, input: Partial<Omit<ManagedUserInput, 'email'>>): Promise<ManagedUser> {
  const payload = await api<{ user: ManagedUser }>(`/api/admin/users/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
  return payload.user;
}

export async function removeManagedUser(id: string): Promise<void> {
  await api(`/api/admin/users/${encodeURIComponent(id)}`, { method: 'DELETE' });
}
