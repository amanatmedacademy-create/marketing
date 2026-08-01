import { supabase } from './supabase';

type ApiInit = Omit<RequestInit, 'body'> & { body?: unknown };

const workerApiBase = '/api';
const backendApiBase = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, '') || workerApiBase;

async function performRequest(baseUrl: string, path: string, init: ApiInit) {
  const { data } = await supabase.auth.getSession();
  const accessToken = data.session?.access_token;

  return fetch(`${baseUrl}${path}`, {
    ...init,
    credentials: 'include',
    headers: {
      'content-type': 'application/json',
      ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
      ...init.headers,
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}

async function request<T>(baseUrl: string, path: string, init: ApiInit = {}, retried = false): Promise<T> {
  let response = await performRequest(baseUrl, path, init);

  if (response.status === 401 && !retried) {
    const { data, error } = await supabase.auth.refreshSession();
    if (!error && data.session) response = await performRequest(baseUrl, path, init);
  }

  if (response.status === 401) window.dispatchEvent(new CustomEvent('imds:session-expired'));

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
