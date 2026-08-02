export interface AuthEnv {
  SUPABASE_URL: string;
  SUPABASE_PUBLISHABLE_KEY?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  DEFAULT_COMPANY_ID?: string;
}

type SupabaseUser = { id: string; email?: string; user_metadata?: Record<string, unknown> };
type TokenResponse = { access_token: string; refresh_token: string; expires_in: number; user: SupabaseUser };
type Profile = { id: string; name: string; email: string; role: string; status: string };
type Membership = { company_id: string; user_id: string; role: string; status: string };

export type AuthSession = {
  authUser: SupabaseUser;
  user: Profile;
  companyId: string;
  role: string;
};

const cookie = (name: string, value: string, maxAge: number) => `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
const clearCookie = (name: string) => `${name}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
const json = (body: unknown, status = 200, headers: HeadersInit = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', ...headers } });

function assertAuthEnv(env: AuthEnv): asserts env is AuthEnv & { SUPABASE_SERVICE_ROLE_KEY: string } {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('Auth environment is not configured');
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
    headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, 'content-type': 'application/json', ...init.headers },
  });
}

async function restFetch(env: AuthEnv, table: string, query: string, init: RequestInit = {}) {
  assertAuthEnv(env);
  return fetch(`${env.SUPABASE_URL}/rest/v1/${table}?${query}`, {
    ...init,
    headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, 'content-type': 'application/json', prefer: 'return=representation', ...init.headers },
  });
}

async function exchangePassword(env: AuthEnv, email: string, password: string) {
  const response = await authFetch(env, '/token?grant_type=password', { method: 'POST', body: JSON.stringify({ email, password }) });
  if (!response.ok) throw new Error('Неверный email или пароль');
  return response.json() as Promise<TokenResponse>;
}

function sessionResponse(tokens: TokenResponse, session: { user: Profile; companyId: string; role: string }) {
  const headers = new Headers({ 'content-type': 'application/json; charset=utf-8' });
  headers.append('set-cookie', cookie('imds_access_token', tokens.access_token, tokens.expires_in));
  headers.append('set-cookie', cookie('imds_refresh_token', tokens.refresh_token, 60 * 60 * 24 * 30));
  return new Response(JSON.stringify(session), { headers });
}

function slugify(value: string) {
  const base = value.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 42) || 'company';
  return `${base}-${crypto.randomUUID().slice(0, 8)}`;
}

async function deleteCreatedUser(env: AuthEnv, authUserId: string) {
  await authFetch(env, `/admin/users/${authUserId}`, { method: 'DELETE' }).catch(() => undefined);
}

async function register(request: Request, env: AuthEnv) {
  const body = await request.json() as { name?: string; companyName?: string; email?: string; password?: string };
  const name = body.name?.trim();
  const companyName = body.companyName?.trim();
  const email = body.email?.trim().toLowerCase();
  const password = body.password ?? '';
  if (!name || !companyName || !email || password.length < 8) return json({ error: { message: 'Укажите имя, компанию, корректный email и пароль минимум из 8 символов' } }, 400);

  const create = await authFetch(env, '/admin/users', { method: 'POST', body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { name, companyName } }) });
  if (!create.ok) {
    const payload = await create.json().catch(() => null) as { message?: string } | null;
    return json({ error: { message: payload?.message?.includes('already') ? 'Пользователь с таким email уже существует' : 'Не удалось создать пользователя' } }, 409);
  }
  const authUser = await create.json() as SupabaseUser;

  try {
    const profileResponse = await restFetch(env, 'marketing_users', 'select=id,name,email,role,status', {
      method: 'POST',
      body: JSON.stringify({ auth_user_id: authUser.id, name, email, role: 'owner', status: 'active', provider: 'email', provider_metadata: {} }),
    });
    if (!profileResponse.ok) throw new Error(`Profile creation failed: ${await profileResponse.text()}`);
    const [profile] = await profileResponse.json() as Profile[];

    const companyResponse = await restFetch(env, 'crm_companies', 'select=id,name,slug', {
      method: 'POST',
      body: JSON.stringify({ name: companyName, slug: slugify(companyName), created_by: profile.id }),
    });
    if (!companyResponse.ok) throw new Error(`Company creation failed: ${await companyResponse.text()}`);
    const [company] = await companyResponse.json() as Array<{ id: string }>;

    const memberResponse = await restFetch(env, 'crm_company_members', 'select=company_id,user_id,role,status', {
      method: 'POST',
      body: JSON.stringify({ company_id: company.id, user_id: profile.id, role: 'owner', status: 'active' }),
    });
    if (!memberResponse.ok) throw new Error(`Membership creation failed: ${await memberResponse.text()}`);

    const tokens = await exchangePassword(env, email, password);
    return sessionResponse(tokens, { user: profile, companyId: company.id, role: 'owner' });
  } catch (error) {
    await deleteCreatedUser(env, authUser.id);
    throw error;
  }
}

async function loadSessionForUser(env: AuthEnv, authUser: SupabaseUser): Promise<AuthSession | null> {
  const profileResponse = await restFetch(env, 'marketing_users', `select=id,name,email,role,status&auth_user_id=eq.${authUser.id}&status=eq.active&limit=1`);
  if (!profileResponse.ok) return null;
  const [profile] = await profileResponse.json() as Profile[];
  if (!profile) return null;

  const membershipResponse = await restFetch(env, 'crm_company_members', `select=company_id,user_id,role,status&user_id=eq.${profile.id}&status=eq.active&order=created_at.asc&limit=1`);
  if (!membershipResponse.ok) return null;
  const [membership] = await membershipResponse.json() as Membership[];
  if (!membership) return null;

  return { authUser, user: profile, companyId: membership.company_id, role: membership.role };
}

async function login(request: Request, env: AuthEnv) {
  const body = await request.json() as { email?: string; password?: string };
  const email = body.email?.trim().toLowerCase();
  if (!email || !body.password) return json({ error: { message: 'Введите email и пароль' } }, 400);
  const tokens = await exchangePassword(env, email, body.password);
  const session = await loadSessionForUser(env, tokens.user);
  if (!session) return json({ error: { message: 'У пользователя нет активного доступа к компании' } }, 403);
  return sessionResponse(tokens, { user: session.user, companyId: session.companyId, role: session.role });
}

async function refresh(request: Request, env: AuthEnv) {
  const refreshToken = readCookie(request, 'imds_refresh_token');
  if (!refreshToken) return json({ error: { message: 'Сессия истекла' } }, 401);
  const response = await authFetch(env, '/token?grant_type=refresh_token', { method: 'POST', body: JSON.stringify({ refresh_token: refreshToken }) });
  if (!response.ok) return json({ error: { message: 'Сессия истекла' } }, 401);
  const tokens = await response.json() as TokenResponse;
  const session = await loadSessionForUser(env, tokens.user);
  if (!session) return json({ error: { message: 'Доступ к компании отозван' } }, 403);
  return sessionResponse(tokens, { user: session.user, companyId: session.companyId, role: session.role });
}

export async function requireSession(request: Request, env: AuthEnv): Promise<AuthSession | null> {
  const accessToken = readCookie(request, 'imds_access_token');
  if (!accessToken) return null;
  const response = await authFetch(env, '/user', { headers: { authorization: `Bearer ${accessToken}` } });
  if (!response.ok) return null;
  return loadSessionForUser(env, await response.json() as SupabaseUser);
}

async function me(request: Request, env: AuthEnv) {
  const session = await requireSession(request, env);
  if (!session) return json({ error: { message: 'Не авторизован' } }, 401);
  return json({ user: session.user, companyId: session.companyId, role: session.role });
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
