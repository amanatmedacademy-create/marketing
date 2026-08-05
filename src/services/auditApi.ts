// FR-060: клиент журнала аудита и реестра ошибок.

export type AuditRecord = {
  id: string;
  userId?: string;
  action: string;
  entityType?: string;
  entityId?: string;
  before: unknown;
  after: unknown;
  ip?: string;
  userAgent?: string;
  correlationId?: string;
  createdAt: string;
};

export type ErrorStatus = 'OPEN' | 'RETRYING' | 'RESOLVED';

export type ErrorRecord = {
  id: string;
  source: string;
  endpoint: string;
  code: string;
  message: string;
  correlationId?: string;
  repeatCount: number;
  retryAttempts: number;
  firstSeenAt: string;
  lastSeenAt: string;
  status: ErrorStatus;
  metadata: Record<string, unknown>;
};

export type ErrorRetryResult = ErrorRecord & {
  retryPath?: string;
  retryMethod?: string;
};

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    cache: 'no-store',
    headers: { 'content-type': 'application/json', ...init.headers }
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(payload?.error || `API вернул HTTP ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export const fetchAuditLog = (options: { action?: string; limit?: number } = {}) => {
  const params = new URLSearchParams();
  if (options.action) params.set('action', options.action);
  if (options.limit) params.set('limit', String(options.limit));
  return request<AuditRecord[]>(`/api/audit${params.size ? `?${params}` : ''}`);
};

export const reportAuditEvent = (action: 'data.exported' | 'mass.operation', entityType: string, details?: Record<string, unknown>) =>
  request<{ ok: boolean }>('/api/audit/events', { method: 'POST', body: JSON.stringify({ action, entityType, details }) });

export const fetchErrors = (status?: ErrorStatus | '') => {
  const params = new URLSearchParams();
  if (status) params.set('status', status);
  return request<ErrorRecord[]>(`/api/errors${params.size ? `?${params}` : ''}`);
};

export const updateErrorStatus = (id: string, status: ErrorStatus) =>
  request<ErrorRecord>(`/api/errors/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ status }) });

export const requestErrorRetry = (id: string) =>
  request<ErrorRetryResult>(`/api/errors/${encodeURIComponent(id)}/retry`, { method: 'POST', body: '{}' });

// Повторная обработка: получаем retryPath от сервера и выполняем его
// с правами текущего пользователя; при успехе помечаем ошибку решённой.
export async function retryError(id: string): Promise<{ record: ErrorRecord; executed: boolean; success: boolean }> {
  const result = await requestErrorRetry(id);
  if (!result.retryPath) return { record: result, executed: false, success: false };
  try {
    const response = await fetch(result.retryPath, {
      method: result.retryMethod || 'POST',
      cache: 'no-store',
      headers: { 'content-type': 'application/json' },
      body: (result.retryMethod || 'POST') === 'GET' ? undefined : '{}'
    });
    if (!response.ok) return { record: result, executed: true, success: false };
    const resolved = await updateErrorStatus(id, 'RESOLVED').catch(() => result);
    return { record: resolved, executed: true, success: true };
  } catch {
    return { record: result, executed: true, success: false };
  }
}
