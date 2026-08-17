export interface LocalDataEnv {
  IMDS_LOCAL_DB_URL?: string;
  IMDS_LOCAL_SERVICE_ROLE_KEY?: string;
}

const text = (value: unknown): string => typeof value === 'string' ? value.trim() : '';

export function localDataBase(env: LocalDataEnv): string {
  const base = text(env.IMDS_LOCAL_DB_URL);
  if (!base) throw new Error('IMDS_LOCAL_DB_URL не настроен на VPS');
  return base.replace(/\/$/, '').replace(/\/rest\/v1$/, '');
}

export function localDataServiceKey(env: LocalDataEnv): string {
  const key = text(env.IMDS_LOCAL_SERVICE_ROLE_KEY);
  if (!key) throw new Error('IMDS_LOCAL_SERVICE_ROLE_KEY не настроен на VPS');
  return key;
}

export function localDataHeaders(env: LocalDataEnv, extra: HeadersInit = {}): HeadersInit {
  const key = localDataServiceKey(env);
  return {
    apikey: key,
    authorization: `Bearer ${key}`,
    'content-type': 'application/json',
    ...extra,
  };
}

export async function localDataRequest(env: LocalDataEnv, path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${localDataBase(env)}/rest/v1/${path.replace(/^\/+/, '')}`, {
    ...init,
    headers: localDataHeaders(env, init.headers),
  });
}

export async function localDataJson<T>(env: LocalDataEnv, path: string, init: RequestInit = {}, label = 'Local data API'): Promise<T> {
  const response = await localDataRequest(env, path, init);
  const body = await response.text();
  if (!response.ok) throw new Error(`${label}: ${response.status} ${body.slice(0, 1200)}`);
  return (body ? JSON.parse(body) : null) as T;
}
