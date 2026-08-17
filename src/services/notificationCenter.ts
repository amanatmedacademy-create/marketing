export interface AppNotification {
  id: string;
  type: string;
  severity: 'info' | 'success' | 'warning' | 'error';
  title: string;
  body: string | null;
  action_url: string | null;
  read_at: string | null;
  created_at: string;
  metadata: Record<string, unknown>;
}
export interface HealthItem {
  provider: string;
  label: string;
  status: 'connected' | 'warning' | 'error' | 'not_configured';
  rawStatus: string | null;
  lastError: string | null;
  lastVerifiedAt: string | null;
  updatedAt: string | null;
  expiresAt: string | null;
}

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, { ...init, headers: { 'content-type': 'application/json', ...init.headers } });
  const payload = await response.json().catch(() => ({})) as { error?: string };
  if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
  return payload as T;
}
export const loadNotifications = () => api<{ items: AppNotification[]; unreadCount: number }>('/api/notifications');
export const readNotification = (id: string) => api<{ ok: true }>(`/api/notifications/${encodeURIComponent(id)}/read`, { method: 'POST', body: '{}' });
export const readAllNotifications = () => api<{ ok: true }>('/api/notifications/read-all', { method: 'POST', body: '{}' });
export const loadSystemHealth = () => api<{ items: HealthItem[]; healthy: number; issues: number }>('/api/system-health');
