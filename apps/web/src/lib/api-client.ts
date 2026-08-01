type ApiInit = Omit<RequestInit, 'body'> & { body?: unknown };

const workerApiBase = '/api';
const backendApiBase = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, '') || workerApiBase;
let refreshPromise: Promise<boolean> | null = null;

async function refreshSession() {
  if (!refreshPromise) {
    refreshPromise = fetch('/api/auth/refresh', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    }).then((response) => response.ok).finally(() => { refreshPromise = null; });
  }
  return refreshPromise;
}

async function performRequest(baseUrl: string, path: string, init: ApiInit) {
  return fetch(`${baseUrl}${path}`, {
    ...init,
    credentials: 'include',
    headers: {
      'content-type': 'application/json',
      ...init.headers,
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}

async function request<T>(baseUrl: string, path: string, init: ApiInit = {}, retried = false): Promise<T> {
  const response = await performRequest(baseUrl, path, init);

  if (response.status === 401 && !retried && !path.startsWith('/auth/')) {
    const refreshed = await refreshSession();
    if (refreshed) return request<T>(baseUrl, path, init, true);
    window.dispatchEvent(new CustomEvent('imds:session-expired'));
  }

  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: { message?: string }; message?: string } | null;
    throw new Error(payload?.error?.message ?? payload?.message ?? `API request failed: ${response.status}`);
  }

  return response.json() as Promise<T>;
}

export function apiFetch<T>(path: string, init: ApiInit = {}): Promise<T> {
  return request<T>(workerApiBase, path, init);
}

export function backendApiFetch<T>(path: string, init: ApiInit = {}): Promise<T> {
  return request<T>(backendApiBase, path, init);
}
