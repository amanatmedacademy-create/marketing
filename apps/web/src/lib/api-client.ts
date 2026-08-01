type ApiInit = Omit<RequestInit, 'body'> & { body?: unknown };

const workerApiBase = '/api';
const backendApiBase = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, '') || workerApiBase;

async function request<T>(baseUrl: string, path: string, init: ApiInit = {}): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    credentials: 'include',
    headers: {
      'content-type': 'application/json',
      ...init.headers,
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });

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
