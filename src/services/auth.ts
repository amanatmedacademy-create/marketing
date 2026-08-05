export interface AppUser {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  role: string;
  status: string;
}

export type GoogleAuthIntent = 'login' | 'signup';

export interface AuthLoadResult {
  user: AppUser | null;
  pending: boolean;
  message?: string;
}

interface StoredSession {
  access_token: string;
  refresh_token?: string;
  expires_at?: number;
  token_type?: string;
}

const STORAGE_KEY = 'amanat_marketing_auth_session';
const AUTH_INTENT_KEY = 'amanat_marketing_auth_intent';

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
  const response = await fetch('/api/auth/refresh', {
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
}

export function consumeGoogleAuthIntent(): GoogleAuthIntent {
  const params = new URLSearchParams(window.location.search);
  const queryIntent = params.get('auth_intent');
  const storedIntent = sessionStorage.getItem(AUTH_INTENT_KEY);
  const intent: GoogleAuthIntent = queryIntent === 'signup' || storedIntent === 'signup' ? 'signup' : 'login';

  sessionStorage.removeItem(AUTH_INTENT_KEY);
  if (params.has('auth_intent')) {
    params.delete('auth_intent');
    const query = params.toString();
    history.replaceState({}, document.title, `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`);
  }
  return intent;
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

export async function startGoogleAuth(intent: GoogleAuthIntent): Promise<void> {
  sessionStorage.setItem(AUTH_INTENT_KEY, intent);
  window.location.assign(`/api/auth/google/start?intent=${intent}`);
}

export async function signOutSession(): Promise<void> {
  writeStoredSession(null);
  sessionStorage.removeItem(AUTH_INTENT_KEY);
  await fetch('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
}

export async function authFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const session = await currentSession();
  const headers = new Headers(init.headers || {});
  if (session?.access_token) headers.set('authorization', `Bearer ${session.access_token}`);
  return fetch(input, { ...init, headers });
}

export async function loadAppUser(intent: GoogleAuthIntent = 'login'): Promise<AuthLoadResult> {
  const response = await authFetch(`/api/auth/me?intent=${intent}`);
  const body = await response.text();
  let payload: { user?: AppUser; pending?: boolean; message?: string; error?: string } = {};

  if (body) {
    try {
      payload = JSON.parse(body) as typeof payload;
    } catch {
      if (!response.ok) throw new Error(body);
    }
  }

  if (!response.ok) throw new Error(payload.error || body || 'Ошибка авторизации');
  return {
    user: payload.user || null,
    pending: Boolean(payload.pending),
    message: payload.message,
  };
}
