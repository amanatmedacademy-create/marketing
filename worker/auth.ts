import type { Env } from './integrations';

type JsonRecord = Record<string, unknown>;

export type AuthEnv = Env & {
  SUPABASE_ANON_KEY?: string;
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

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});

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

async function fetchSupabaseUser(request: Request, env: AuthEnv): Promise<JsonRecord | null> {
  const token = bearerToken(request);
  if (!token || !env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) return null;
  const response = await fetch(`${env.SUPABASE_URL.replace(/\/$/, '')}/auth/v1/user`, {
    headers: {
      apikey: env.SUPABASE_ANON_KEY,
      authorization: `Bearer ${token}`,
    },
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
      body: JSON.stringify({
        name,
        email,
        avatar_url: avatarUrl,
        provider: 'google',
        provider_metadata: metadata,
        last_seen_at: new Date().toISOString(),
      }),
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
      body: JSON.stringify({
        auth_user_id: id,
        name,
        email,
        avatar_url: avatarUrl,
        provider: 'google',
        provider_metadata: metadata,
        role,
        status,
        last_seen_at: new Date().toISOString(),
      }),
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

export function isPublicApiPath(pathname: string): boolean {
  return pathname === '/api/health'
    || pathname === '/api/auth/config'
    || pathname.startsWith('/api/webhooks/');
}

export async function authenticateRequest(request: Request, env: AuthEnv): Promise<AuthenticatedUser | null> {
  const authUser = await fetchSupabaseUser(request, env);
  if (!authUser) return null;
  return upsertMarketingUser(authUser, env);
}

export async function handleAuthRequest(request: Request, env: AuthEnv, url: URL): Promise<Response | null> {
  if (url.pathname === '/api/auth/config' && request.method === 'GET') {
    return json({
      supabaseUrl: env.SUPABASE_URL,
      supabaseAnonKey: env.SUPABASE_ANON_KEY || '',
      googleEnabled: Boolean(env.SUPABASE_ANON_KEY),
    });
  }

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
