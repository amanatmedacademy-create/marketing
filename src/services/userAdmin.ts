export type ManagedUserRole = 'owner' | 'administrator' | 'manager' | 'marketer' | 'operator' | 'analyst' | 'viewer';
export type AssignableUserRole = Exclude<ManagedUserRole, 'owner'>;
export type ManagedUserStatus = 'active' | 'invited' | 'blocked';

export interface ManagedUser {
  id: string;
  name: string;
  email: string;
  role: ManagedUserRole;
  status: ManagedUserStatus;
  membershipRole: ManagedUserRole;
  connected: boolean;
  avatarUrl: string | null;
  lastSeenAt: string | null;
  createdAt: string;
  positionId?: string | null;
  jobTitle?: string | null;
}

export interface TeamInvitation {
  id: string;
  email: string;
  phone: string | null;
  role: AssignableUserRole;
  status: 'pending' | 'accepted' | 'revoked' | 'expired';
  expiresAt: string | null;
  createdAt: string | null;
}

export interface OnboardingRequest {
  id: string;
  userId: string;
  name: string;
  email: string;
  phone: string | null;
  position: string | null;
  notes: string | null;
  status: 'needs_profile' | 'pending_approval' | 'rejected';
  requestedRole: AssignableUserRole;
  rejectionReason: string | null;
  submittedAt: string | null;
  updatedAt: string | null;
}

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, { ...init, headers: { 'content-type': 'application/json', ...init.headers } });
  const payload = await response.json().catch(() => ({})) as { error?: string };
  if (!response.ok) throw new Error(payload.error || `Ошибка управления командой: ${response.status}`);
  return payload as T;
}

export async function fetchManagedUsers(): Promise<ManagedUser[]> {
  return (await api<{ users: ManagedUser[] }>('/api/admin/users')).users;
}

export async function updateManagedUser(id: string, input: { role?: AssignableUserRole; status?: ManagedUserStatus }): Promise<ManagedUser> {
  return (await api<{ user: ManagedUser }>(`/api/admin/users/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(input) })).user;
}

export async function removeManagedUser(id: string): Promise<void> {
  await api(`/api/admin/users/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function fetchTeamInvitations(): Promise<TeamInvitation[]> {
  return (await api<{ invitations: TeamInvitation[] }>('/api/admin/users/invitations')).invitations;
}

export async function createTeamInvitation(input: { email: string; phone?: string; role: AssignableUserRole }): Promise<{ invitation: TeamInvitation; code: string }> {
  return api('/api/admin/users/invitations', { method: 'POST', body: JSON.stringify(input) });
}

export async function resendTeamInvitation(id: string): Promise<{ invitation: TeamInvitation; code: string }> {
  return api(`/api/admin/users/invitations/${encodeURIComponent(id)}/resend`, { method: 'POST', body: '{}' });
}

export async function revokeTeamInvitation(id: string): Promise<void> {
  await api(`/api/admin/users/invitations/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function fetchOnboardingRequests(): Promise<OnboardingRequest[]> {
  return (await api<{ onboarding: OnboardingRequest[] }>('/api/admin/users/onboarding')).onboarding;
}

export async function approveOnboardingRequest(id: string, role: AssignableUserRole): Promise<void> {
  await api(`/api/admin/users/onboarding/${encodeURIComponent(id)}/approve`, { method: 'POST', body: JSON.stringify({ role }) });
}

export async function rejectOnboardingRequest(id: string, reason: string): Promise<void> {
  await api(`/api/admin/users/onboarding/${encodeURIComponent(id)}/reject`, { method: 'POST', body: JSON.stringify({ reason }) });
}

export async function transferCompanyOwnership(userId: string): Promise<void> {
  await api(`/api/admin/users/${encodeURIComponent(userId)}/transfer-ownership`, { method: 'POST', body: '{}' });
}
