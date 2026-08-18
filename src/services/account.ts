import { authFetch } from './auth';

export type AccountProfile = {
  id: string; name: string; email: string; phone: string | null; emailVerified: boolean; avatarUrl: string | null;
  role: string; platformRole: string; locale: string; timezone: string; defaultCompanyId: string | null; providers: string[];
};
export type AccountSession = { id: string; current: boolean; rememberMe: boolean; userAgent: string; createdAt: string; lastSeenAt: string; expiresAt: string };
export type AccountSecurityEvent = { id: string; type: string; result: string; userAgent: string | null; metadata: Record<string, unknown>; createdAt: string };
export type AccountSecurityState = {
  email: string; emailVerified: boolean; mfaEnabled: boolean; recoveryCodesRemaining: number; emailDeliveryConfigured: boolean; events: AccountSecurityEvent[];
};
export type MfaSetup = { secret: string; otpauthUri: string };
export type ClinicSettings = { id: string; name: string; slug?: string | null; timezone: string };

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers || {}); headers.set('accept', 'application/json');
  if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
  const response = await authFetch(path, { ...init, headers, cache: 'no-store' });
  const raw = await response.text(); let payload: Record<string, unknown> = {};
  try { payload = raw ? JSON.parse(raw) as Record<string, unknown> : {}; } catch { payload = {}; }
  if (!response.ok) throw new Error(typeof payload.error === 'string' ? payload.error : raw || `HTTP ${response.status}`);
  return payload as T;
}

export async function loadAccountProfile(): Promise<AccountProfile> { const result = await request<{ profile: AccountProfile }>('/api/account/profile'); return result.profile; }
export async function saveAccountProfile(input: { name: string; phone?: string; locale: string; timezone: string }): Promise<AccountProfile> { const result = await request<{ profile: AccountProfile }>('/api/account/profile', { method: 'PATCH', body: JSON.stringify(input) }); return result.profile; }
export async function loadAccountSessions(): Promise<AccountSession[]> { const result = await request<{ sessions: AccountSession[] }>('/api/account/sessions'); return result.sessions || []; }
export async function revokeAccountSession(id: string): Promise<void> { await request(`/api/account/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' }); }
export async function revokeOtherAccountSessions(): Promise<number> { const result = await request<{ revoked?: number }>('/api/account/sessions/revoke-others', { method: 'POST' }); return Number(result.revoked || 0); }
export async function changeAccountPassword(currentPassword: string, newPassword: string): Promise<void> { await request('/api/account/password', { method: 'POST', body: JSON.stringify({ currentPassword, newPassword, revokeOtherSessions: true }) }); }

export async function loadClinicSettings(): Promise<ClinicSettings> { const result = await request<{ company: ClinicSettings }>('/api/company/settings'); return result.company; }
export async function saveClinicSettings(timezone: string): Promise<ClinicSettings> { const result = await request<{ company: ClinicSettings }>('/api/company/settings', { method: 'PATCH', body: JSON.stringify({ timezone }) }); return result.company; }

export async function loadAccountSecurity(): Promise<AccountSecurityState> { return request<AccountSecurityState>('/api/account/security'); }
export async function sendAccountEmailVerification(): Promise<void> { await request('/api/account/security/email/send', { method: 'POST', body: '{}' }); }
export async function startAccountMfaSetup(): Promise<MfaSetup> { return request<MfaSetup>('/api/account/security/mfa/setup', { method: 'POST', body: '{}' }); }
export async function enableAccountMfa(code: string): Promise<string[]> { const result = await request<{ recoveryCodes?: string[] }>('/api/account/security/mfa/enable', { method: 'POST', body: JSON.stringify({ code }) }); return result.recoveryCodes || []; }
export async function disableAccountMfa(code: string): Promise<void> { await request('/api/account/security/mfa/disable', { method: 'POST', body: JSON.stringify({ code }) }); }
