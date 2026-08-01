import { supabase } from './supabase';

type ApiInit = Omit<RequestInit, 'body'> & { body?: unknown };

const workerApiBase = '/api';
const backendApiBase = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, '') || workerApiBase;

async function performRequest(baseUrl: string, path: string, init: ApiInit, accessToken?: string) {
  const token = accessToken ?? (await supabase.auth.getSession()).data.session?.access_token;
  return fetch(`${baseUrl}${path}`, {
    ...init,
    credentials: 'same-origin',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}

async function request<T>(baseUrl: string, path: string, init: ApiInit = {}): Promise<T> {
  let response = await performRequest(baseUrl, path, init);

  if (response.status === 401) {
    const { data, error } = await supabase.auth.refreshSession();
    if (!error && data.session?.access_token) {
      response = await performRequest(baseUrl, path, init, data.session.access_token);
    }
  }

  if (response.status === 401) {
    await supabase.auth.signOut({ scope: 'local' }).catch(() => undefined);
    window.dispatchEvent(new CustomEvent('imds:session-expired'));
  }

  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: { message?: string }; message?: string } | null;
    throw new Error(payload?.error?.message ?? payload?.message ?? `API request failed: ${response.status}`);
  }

  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export function apiFetch<T>(path: string, init: ApiInit = {}): Promise<T> {
  return request<T>(workerApiBase, path, init);
}

export function backendApiFetch<T>(path: string, init: ApiInit = {}): Promise<T> {
  return request<T>(backendApiBase, path, init);
}
