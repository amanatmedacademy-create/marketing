export interface AppUser {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  role: string;
  status: string;
}

interface StoredSession {
  access_token: string;
  refresh_token?: string;
  expires_at?: number;
  token_type?: string;
}

const STORAGE_KEY = 'amanat_marketing_auth_session';
const AUTH_REQUEST_TIMEOUT_MS = 10_000;

function readStoredSession(): StoredSession | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value ? JSON.parse(value) as StoredSession : null;
  } catch {
    return null;
  }
}

function writeStoredSession(session: StoredSession | null) {
  if (session) localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  else localStorage.removeItem(STORAGE_KEY);
}

async function authRequest(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), AUTH_REQUEST_TIMEOUT_MS);

  if (init.signal) {
    if (init.signal.aborted) controller.abort();
    else init.signal.addEventListener('abort', () => controller.abort(), { once: true });
  }

  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    window.clearTimeout(timeout);
  }
}

function parseCallbackSession(): StoredSession | null {
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const accessToken = hash.get('access_token');
  if (!accessToken) return null;

  const expiresIn = Number(hash.get('expires_in') || 3600);
  const session: StoredSession = {
    access_token: accessToken,
    refresh_token: hash.get('refresh_token') || undefined,
    token_type: hash.get('token_type') || 'bearer',
    expires_at: Math.floor(Date.now() / 1000) + expiresIn,
  };
  writeStoredSession(session);
  history.replaceState({}, document.title, `${window.location.pathname}${window.location.search}`);
  return session;
}

async function refreshSession(session: StoredSession): Promise<StoredSession | null> {
  if (!session.refresh_token) return null;

  try {
    const response = await authRequest('/api/auth/refresh', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refresh_token: session.refresh_token }),
    });
    if (!response.ok) return null;
    const payload = await response.json() as Record<string, unknown>;
    const accessToken = typeof payload.access_token === 'string' ? payload.access_token : '';
    if (!accessToken) return null;

    const next: StoredSession = {
      access_token: accessToken,
      refresh_token: typeof payload.refresh_token === 'string' ? payload.refresh_token : session.refresh_token,
      token_type: typeof payload.token_type === 'string' ? payload.token_type : 'bearer',
      expires_at: Math.floor(Date.now() / 1000) + Number(payload.expires_in || 3600),
    };
    writeStoredSession(next);
    return next;
  } catch {
    return null;
  }
}

export async function currentSession(): Promise<StoredSession | null> {
  const callback = parseCallbackSession();
  if (callback) return callback;

  const session = readStoredSession();
  if (!session) return null;
  const expiresAt = Number(session.expires_at || 0);
  if (!expiresAt || expiresAt > Math.floor(Date.now() / 1000) + 60) return session;

  const refreshed = await refreshSession(session);
  if (!refreshed) writeStoredSession(null);
  return refreshed;
}

export async function startGoogleSignIn(): Promise<void> {
  window.location.assign('/api/auth/google/start');
}

export async function signOutSession(): Promise<void> {
  writeStoredSession(null);
  await authRequest('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
}

export async function authFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const session = await currentSession();
  const headers = new Headers(init.headers || {});
  if (session?.access_token) headers.set('authorization', `Bearer ${session.access_token}`);
  return fetch(input, { ...init, headers });
}

export async function loadAppUser(): Promise<AppUser> {
  const session = await currentSession();
  if (!session?.access_token) throw new Error('Сессия истекла. Войдите через Google повторно.');

  const response = await authRequest('/api/auth/me', {
    headers: { authorization: `Bearer ${session.access_token}` },
  });
  const body = await response.text();
  if (!response.ok) {
    try {
      const parsed = JSON.parse(body) as { error?: string };
      throw new Error(parsed.error || body || 'Ошибка авторизации');
    } catch (error) {
      if (error instanceof Error && error.message !== 'Unexpected end of JSON input') throw error;
      throw new Error(body || 'Ошибка авторизации');
    }
  }
  return (JSON.parse(body) as { user: AppUser }).user;
}
