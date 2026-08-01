export interface AuthEnv {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  DEFAULT_COMPANY_ID?: string;
}

type SupabaseUser = {
  id: string;
  email?: string;
  user_metadata?: Record<string, unknown>;
};

type TokenResponse = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  user: SupabaseUser;
};

const cookie = (name: string, value: string, maxAge: number) =>
  `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;

const clearCookie = (name: string) => `${name}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;

const json = (body: unknown, status = 200, headers: HeadersInit = {}) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
});

function assertAuthEnv(env: AuthEnv): asserts env is AuthEnv & {
  SUPABASE_SERVICE_ROLE_KEY: string;
  DEFAULT_COMPANY_ID: string;
} {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY || !env.DEFAULT_COMPANY_ID) {
    throw new Error('Auth environment is not configured');
  }
}

function readCookie(request: Request, name: string) {
  const header = request.headers.get('cookie') ?? '';
  const entry = header.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  return entry ? decodeURIComponent(entry.slice(name.length + 1)) : null;
}

async function authFetch(env: AuthEnv, path: string, init: RequestInit = {}) {
  assertAuthEnv(env);
  return fetch(`${env.SUPABASE_URL}/auth/v1${path}`, {
    ...init,
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      'content-type': 'application/json',
      ...init.headers,
    },
  });
}

async function restFetch(env: AuthEnv, table: string, query: string, init: RequestInit = {}) {
  assertAuthEnv(env);
  return fetch(`${env.SUPABASE_URL}/rest/v1/${table}?${query}`, {
    ...init,
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      'content-type': 'application/json',
      prefer: 'return=representation',
      ...init.headers,
    },
  });
}

async function exchangePassword(env: AuthEnv, email: string, password: string) {
  const response = await authFetch(env, '/token?grant_type=password', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  if (!response.ok) throw new Error('Неверный email или пароль');
  return response.json() as Promise<TokenResponse>;
}

function sessionResponse(tokens: TokenResponse, profile: unknown) {
  const headers = new Headers();
  headers.append('set-cookie', cookie('imds_access_token', tokens.access_token, tokens.expires_in));
  headers.append('set-cookie', cookie('imds_refresh_token', tokens.refresh_token, 60 * 60 * 24 * 30));
  headers.set('content-type', 'application/json; charset=utf-8');
  return new Response(JSON.stringify(profile), { headers });
}

async function register(request: Request, env: AuthEnv) {
  assertAuthEnv(env);
  const body = await request.json() as { name?: string; email?: string; password?: string };
  const name = body.name?.trim();
  const email = body.email?.trim().toLowerCase();
  const password = body.password ?? '';
  if (!name || !email || password.length < 8) {
    return json({ error: { message: 'Укажите имя, корректный email и пароль минимум из 8 символов' } }, 400);
  }

  const create = await authFetch(env, '/admin/users', {
    method: 'POST',
    body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { name } }),
  });
  if (!create.ok) {
    const payload = await create.json().catch(() => null) as { message?: string } | null;
    return json({ error: { message: payload?.message?.includes('already') ? 'Пользователь с таким email уже существует' : 'Не удалось создать пользователя' } }, 409);
  }
  const user = await create.json() as SupabaseUser;

  const profileResponse = await restFetch(env, 'marketing_users', 'select=*', {
    method: 'POST',
    body: JSON.stringify({
      auth_user_id: user.id,
      name,
      email,
      role: 'owner',
      status: 'active',
      provider: 'email',
      provider_metadata: {},
    }),
  });
  if (!profileResponse.ok) throw new Error(`Profile creation failed: ${await profileResponse.text()}`);

  const memberResponse = await restFetch(env, 'crm_company_members', 'select=*', {
    method: 'POST',
    body: JSON.stringify({ company_id: env.DEFAULT_COMPANY_ID, user_id: user.id, role: 'owner', status: 'active' }),
  });
  if (!memberResponse.ok) throw new Error(`Membership creation failed: ${await memberResponse.text()}`);

  const tokens = await exchangePassword(env, email, password);
  return sessionResponse(tokens, { user: { id: user.id, name, email, role: 'owner' }, companyId: env.DEFAULT_COMPANY_ID });
}

async function login(request: Request, env: AuthEnv) {
  assertAuthEnv(env);
  const body = await request.json() as { email?: string; password?: string };
  const email = body.email?.trim().toLowerCase();
  if (!email || !body.password) return json({ error: { message: 'Введите email и пароль' } }, 400);
  const tokens = await exchangePassword(env, email, body.password);
  const profileResponse = await restFetch(env, 'marketing_users', `select=id,name,email,role,status&auth_user_id=eq.${tokens.user.id}&limit=1`);
  const profiles = await profileResponse.json() as Array<{ id: string; name: string; email: string; role: string; status: string }>;
  const profile = profiles[0] ?? { id: tokens.user.id, name: email.split('@')[0], email, role: 'manager', status: 'active' };
  return sessionResponse(tokens, { user: profile, companyId: env.DEFAULT_COMPANY_ID });
}

async function refresh(request: Request, env: AuthEnv) {
  const refreshToken = readCookie(request, 'imds_refresh_token');
  if (!refreshToken) return json({ error: { message: 'Сессия истекла' } }, 401);
  const response = await authFetch(env, '/token?grant_type=refresh_token', {
    method: 'POST',
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
  if (!response.ok) return json({ error: { message: 'Сессия истекла' } }, 401);
  const tokens = await response.json() as TokenResponse;
  return sessionResponse(tokens, { ok: true });
}

export async function requireUser(request: Request, env: AuthEnv): Promise<SupabaseUser | null> {
  const accessToken = readCookie(request, 'imds_access_token');
  if (!accessToken) return null;
  const response = await authFetch(env, '/user', { headers: { authorization: `Bearer ${accessToken}` } });
  if (!response.ok) return null;
  return response.json() as Promise<SupabaseUser>;
}

async function me(request: Request, env: AuthEnv) {
  assertAuthEnv(env);
  const user = await requireUser(request, env);
  if (!user) return json({ error: { message: 'Не авторизован' } }, 401);
  const profileResponse = await restFetch(env, 'marketing_users', `select=id,name,email,role,status&auth_user_id=eq.${user.id}&limit=1`);
  const profiles = await profileResponse.json() as Array<{ id: string; name: string; email: string; role: string; status: string }>;
  return json({ user: profiles[0] ?? { id: user.id, name: user.email, email: user.email, role: 'manager' }, companyId: env.DEFAULT_COMPANY_ID });
}

export async function handleAuthRequest(request: Request, env: AuthEnv) {
  const path = new URL(request.url).pathname;
  try {
    if (request.method === 'POST' && path === '/api/auth/register') return register(request, env);
    if (request.method === 'POST' && path === '/api/auth/login') return login(request, env);
    if (request.method === 'POST' && path === '/api/auth/refresh') return refresh(request, env);
    if (request.method === 'GET' && path === '/api/auth/me') return me(request, env);
    if (request.method === 'POST' && path === '/api/auth/logout') {
      const headers = new Headers({ 'content-type': 'application/json; charset=utf-8' });
      headers.append('set-cookie', clearCookie('imds_access_token'));
      headers.append('set-cookie', clearCookie('imds_refresh_token'));
      return new Response(JSON.stringify({ ok: true }), { headers });
    }
    return null;
  } catch (error) {
    return json({ error: { message: error instanceof Error ? error.message : 'Ошибка авторизации' } }, 500);
  }
}
