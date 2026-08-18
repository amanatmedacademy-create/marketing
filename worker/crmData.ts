import { localDataRequest, type LocalDataEnv } from './localData';

export class CrmDataError extends Error {
  constructor(readonly status: number, readonly detail: string, readonly label: string) {
    super(`${label} failed with HTTP ${status}`);
    this.name = 'CrmDataError';
  }
}

function requestInit(init: RequestInit): RequestInit {
  const headers = new Headers(init.headers);
  headers.set('accept', 'application/json');
  const method = (init.method || 'GET').toUpperCase();
  if (init.body != null && !headers.has('content-type')) headers.set('content-type', 'application/json');
  if (!['GET', 'HEAD'].includes(method) && !headers.has('prefer')) headers.set('prefer', 'return=representation');
  return { ...init, headers, cache: 'no-store' };
}

export async function crmDataResponse(env: unknown, path: string, init: RequestInit = {}): Promise<Response> {
  return localDataRequest(env as LocalDataEnv, path, requestInit(init));
}

export async function crmDataJson<T>(env: unknown, path: string, init: RequestInit = {}, label = 'CRM data request'): Promise<T> {
  const response = await crmDataResponse(env, path, init);
  const body = await response.text();
  if (!response.ok) throw new CrmDataError(response.status, body.slice(0, 1500), label);
  if (!body || response.status === 204) return undefined as T;
  return JSON.parse(body) as T;
}
