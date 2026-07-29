import type { Env } from './integrations';

type JsonRecord = Record<string, unknown>;

export type AuthEnv = Env & {
  SUPABASE_ANON_KEY?: string;
  SUPABASE_PUBLISHABLE_KEY?: string;
  AUTH_ALLOWED_EMAIL_DOMAINS?: string;
  AUTH_AUTO_APPROVE?: string;
};

export interface AuthenticatedUser {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  role: string;
  status: string;
}

const json = (data: unknown, status = 200, headers: HeadersInit = {}) => new Response(JSON.stringify(data), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
});

function publicSupabaseKey(env: AuthEnv): string {
  return (env.SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_ANON_KEY || '').trim();
}

function authApiKey(env: AuthEnv): string {
  return publicSupabaseKey(env) || env.SUPABASE_SERVICE_ROLE_KEY || '';
}

const supabaseHeaders = (env: AuthEnv, extra: HeadersInit = {}): HeadersInit => ({
  apikey: env.SUPABASE_SERVICE_ROLE_KEY,
  authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
  'content-type': 'application/json',
  ...extra,
});

async function supabaseRequest(env: AuthEnv, path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/${path}`, {
    ...init,
    headers: supabaseHeaders(env, init.headers),
  });
}

function bearerToken(request: Request): string | null {
  const authorization = request.headers.get('authorization') || '';
  return authorization.toLowerCase().startsWith('bearer ') ? authorization.slice(7).trim() : null;
}

function allowedDomains(env: AuthEnv): string[] {
  return (env.AUTH_ALLOWED_EMAIL_DOMAINS || '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function domainAllowed(email: string, env: AuthEnv): boolean {
  const domains = allowedDomains(env);
  if (!domains.length) return true;
  const domain = email.split('@').pop()?.toLowerCase() || '';
  return domains.includes(domain);
}

async function readAuthSettings(env: AuthEnv): Promise<{ googleEnabled: boolean; error: string | null }> {
  const apiKey = authApiKey(env);
  if (!env.SUPABASE_URL) return { googleEnabled: false, error: 'SUPABASE_URL не настроен' };
  if (!apiKey) return { googleEnabled: false, error: 'SUPABASE_SERVICE_ROLE_KEY не настроен' };

  try {
    const response = await fetch(`${env.SUPABASE_URL.replace(/\/$/, '')}/auth/v1/settings`, {
      headers: { apikey: apiKey, authorization: `Bearer ${apiKey}` },
    });
    const body = await response.text();
    if (!response.ok) return { googleEnabled: false, error: `Supabase Auth settings: ${response.status} ${body}` };
    const settings = JSON.parse(body) as JsonRecord;
    const external = settings.external && typeof settings.external === 'object' ? settings.external as JsonRecord : {};
    return { googleEnabled: external.google === true, error: null };
  } catch (error) {
    return { googleEnabled: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function fetchSupabaseUser(request: Request, env: AuthEnv): Promise<JsonRecord | null> {
  const token = bearerToken(request);
  const apiKey = authApiKey(env);
  if (!token || !env.SUPABASE_URL || !apiKey) return null;
  const response = await fetch(`${env.SUPABASE_URL.replace(/\/$/, '')}/auth/v1/user`, {
    headers: { apikey: apiKey, authorization: `Bearer ${token}` },
  });
  if (!response.ok) return null;
  return await response.json() as JsonRecord;
}

async function upsertMarketingUser(user: JsonRecord, env: AuthEnv): Promise<AuthenticatedUser> {
  const id = String(user.id || '');
  const email = String(user.email || '').toLowerCase();
  const metadata = (user.user_metadata && typeof user.user_metadata === 'object' ? user.user_metadata : {}) as JsonRecord;
  const name = String(metadata.full_name || metadata.name || email.split('@')[0] || 'Пользователь');
  const avatarUrl = metadata.avatar_url ? String(metadata.avatar_url) : null;

  if (!id || !email) throw new Error('Google account does not contain a valid user ID or email');
  if (!domainAllowed(email, env)) throw new Error('Этот Google-аккаунт не разрешён для входа');

  const existingResponse = await supabaseRequest(env, `marketing_users?auth_user_id=eq.${encodeURIComponent(id)}&select=*`);
  if (!existingResponse.ok) throw new Error(`Unable to read marketing user: ${await existingResponse.text()}`);
  const existing = await existingResponse.json() as JsonRecord[];

  let row: JsonRecord;
  if (existing[0]) {
    const response = await supabaseRequest(env, `marketing_users?auth_user_id=eq.${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { prefer: 'return=representation' },
      body: JSON.stringify({ name, email, avatar_url: avatarUrl, provider: 'google', provider_metadata: metadata, last_seen_at: new Date().toISOString() }),
    });
    if (!response.ok) throw new Error(`Unable to update marketing user: ${await response.text()}`);
    row = (await response.json() as JsonRecord[])[0];
  } else {
    const firstUserResponse = await supabaseRequest(env, 'marketing_users?select=id&limit=1');
    const firstUsers = firstUserResponse.ok ? await firstUserResponse.json() as JsonRecord[] : [];
    const role = firstUsers.length === 0 ? 'administrator' : 'viewer';
    const status = env.AUTH_AUTO_APPROVE === 'false' && role !== 'administrator' ? 'invited' : 'active';
    const response = await supabaseRequest(env, 'marketing_users', {
      method: 'POST',
      headers: { prefer: 'return=representation' },
      body: JSON.stringify({ auth_user_id: id, name, email, avatar_url: avatarUrl, provider: 'google', provider_metadata: metadata, role, status, last_seen_at: new Date().toISOString() }),
    });
    if (!response.ok) throw new Error(`Unable to create marketing user: ${await response.text()}`);
    row = (await response.json() as JsonRecord[])[0];
  }

  return {
    id: String(row.id || id),
    email,
    name: String(row.name || name),
    avatarUrl: row.avatar_url ? String(row.avatar_url) : avatarUrl,
    role: String(row.role || 'viewer'),
    status: String(row.status || 'invited'),
  };
}

function applicationOrigin(request: Request, env: AuthEnv): string {
  const requestOrigin = new URL(request.url).origin;
  if (!env.APP_ORIGIN) return requestOrigin;
  try { return new URL(env.APP_ORIGIN).origin; } catch { return requestOrigin; }
}

export function isPublicApiPath(pathname: string): boolean {
  return pathname === '/api/health'
    || pathname === '/api/auth/config'
    || pathname === '/api/auth/google/start'
    || pathname === '/api/auth/refresh'
    || pathname === '/api/auth/logout'
    || pathname.startsWith('/api/webhooks/');
}

export async function authenticateRequest(request: Request, env: AuthEnv): Promise<AuthenticatedUser | null> {
  const authUser = await fetchSupabaseUser(request, env);
  if (!authUser) return null;
  return upsertMarketingUser(authUser, env);
}

export async function handleAuthRequest(request: Request, env: AuthEnv, url: URL): Promise<Response | null> {
  if (url.pathname === '/api/auth/config' && request.method === 'GET') {
    const settings = await readAuthSettings(env);
    return json({
      googleEnabled: settings.googleEnabled,
      oauthMode: 'worker',
      publicKeyConfigured: Boolean(publicSupabaseKey(env)),
      diagnostic: settings.error,
    });
  }

  if (url.pathname === '/api/auth/google/start' && request.method === 'GET') {
    const settings = await readAuthSettings(env);
    const origin = applicationOrigin(request, env);
    if (!settings.googleEnabled) {
      const message = settings.error || 'Google Provider выключен в Supabase Authentication';
      return Response.redirect(`${origin}/?error_description=${encodeURIComponent(message)}`, 302);
    }

    const authorize = new URL(`${env.SUPABASE_URL.replace(/\/$/, '')}/auth/v1/authorize`);
    authorize.searchParams.set('provider', 'google');
    authorize.searchParams.set('redirect_to', `${origin}/`);
    authorize.searchParams.set('scopes', 'openid email profile');
    return Response.redirect(authorize.toString(), 302);
  }

  if (url.pathname === '/api/auth/refresh' && request.method === 'POST') {
    const body = await request.json().catch(() => ({})) as JsonRecord;
    const refreshToken = typeof body.refresh_token === 'string' ? body.refresh_token : '';
    if (!refreshToken) return json({ error: 'refresh_token is required' }, 400);

    const apiKey = authApiKey(env);
    if (!env.SUPABASE_URL || !apiKey) return json({ error: 'Supabase Auth backend is not configured' }, 503);
    const response = await fetch(`${env.SUPABASE_URL.replace(/\/$/, '')}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: { apikey: apiKey, authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
    const responseBody = await response.text();
    return new Response(responseBody, {
      status: response.status,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    });
  }

  if (url.pathname === '/api/auth/logout' && request.method === 'POST') return json({ ok: true });

  if (url.pathname === '/api/auth/me' && request.method === 'GET') {
    try {
      const user = await authenticateRequest(request, env);
      if (!user) return json({ error: 'Необходим вход через Google' }, 401);
      if (user.status === 'blocked') return json({ error: 'Доступ пользователя заблокирован' }, 403);
      if (user.status !== 'active') return json({ error: 'Аккаунт ожидает подтверждения администратора' }, 403);
      return json({ user });
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : 'Ошибка авторизации' }, 403);
    }
  }

  return null;
}

export function authError(status = 401, message = 'Необходим вход через Google'): Response {
  return json({ error: message }, status);
}
