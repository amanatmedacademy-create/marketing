import type { ApiErrorBody, MeContext } from './sdkContract';

export type TokenProvider = () => Promise<string | null> | string | null;

export class PlatformApiError extends Error {
  readonly status: number;
  readonly body: ApiErrorBody | null;

  constructor(status: number, body: ApiErrorBody | null) {
    super(body?.message ?? `Platform API request failed with status ${status}`);
    this.name = 'PlatformApiError';
    this.status = status;
    this.body = body;
  }
}

export interface PlatformClientOptions {
  baseUrl: string;
  tokenProvider?: TokenProvider;
  fetchImpl?: typeof fetch;
}

function normalizeBaseUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error('baseUrl is required');
  return trimmed.replace(/\/$/, '');
}

export function createPlatformClient(options: PlatformClientOptions) {
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (!fetchImpl) throw new Error('A Fetch API implementation is required');

  async function getMeContext(signal?: AbortSignal): Promise<MeContext> {
    const token = await options.tokenProvider?.();
    const headers = new Headers({ Accept: 'application/json' });
    if (token) headers.set('Authorization', `Bearer ${token}`);
    const response = await fetchImpl(`${baseUrl}/api/platform/me/context`, {
      method: 'GET',
      headers,
      ...(signal ? { signal } : {}),
    });
    if (!response.ok) {
      let body: ApiErrorBody | null = null;
      try { body = await response.json() as ApiErrorBody; } catch { body = null; }
      throw new PlatformApiError(response.status, body);
    }
    return await response.json() as MeContext;
  }

  return Object.freeze({ getMeContext });
}
