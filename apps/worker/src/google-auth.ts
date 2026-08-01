import type { AuthEnv } from './auth';

type SupabaseSessionBody = {
  accessToken?: string;
  refreshToken?: string;
  expiresIn?: number;
  companyName?: string;
  provider?: 'email' | 'google';
};

type SupabaseUser = {
  id: string;
  email?: string;
  user_metadata?: Record<string, unknown>;
};

type Profile = {
  id: string;
  name: string;
  email: string;
  role: string;
  status: string;
};

type Membership = {
  company_id: string;
  user_id: string;
  role: string;
  status: string;
};

const cookie = (name: string, value: string, maxAge: number) =>
  `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});

function assertEnv(env: AuthEnv): asserts env is AuthEnv & { SUPABASE_SERVICE_ROLE_KEY: string } {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('Supabase Auth environment is not configured');
}

async function restFetch(env: AuthEnv, table: string, query: string, init: RequestInit = {}) {
  assertEnv(env);
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

async function getSupabaseUser(env: AuthEnv, accessToken: string) {
  assertEnv(env);
  const response = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${accessToken}`,
    },
  });
  if (!response.ok) return null;
  return response.json() as Promise<SupabaseUser>;
}

function slugify(value: string) {
  const base = value.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 42) || 'company';
  return `${base}-${crypto.randomUUID().slice(0, 8)}`;
}

function displayName(user: SupabaseUser) {
  const metadata = user.user_metadata ?? {};
  const value = metadata.full_name ?? metadata.name ?? metadata.user_name;
  return typeof value === 'string' && value.trim() ? value.trim() : user.email?.split('@')[0] ?? 'User';
}

async function findProfile(env: AuthEnv, authUserId: string) {
  const response = await restFetch(env, 'marketing_users', `select=id,name,email,role,status&auth_user_id=eq.${authUserId}&limit=1`);
  if (!response.ok) throw new Error(`Profile lookup failed: ${await response.text()}`);
  const [profile] = await response.json() as Profile[];
  return profile ?? null;
}

async function findMembership(env: AuthEnv, profileId: string) {
  const response = await restFetch(env, 'crm_company_members', `select=company_id,user_id,role,status&user_id=eq.${profileId}&status=eq.active&order=created_at.asc&limit=1`);
  if (!response.ok) throw new Error(`Membership lookup failed: ${await response.text()}`);
  const [membership] = await response.json() as Membership[];
  return membership ?? null;
}

async function createWorkspace(env: AuthEnv, user: SupabaseUser, companyName: string, provider: 'email' | 'google') {
  const email = user.email?.trim().toLowerCase();
  if (!email) throw new Error('Supabase account does not provide an email');

  let profile = await findProfile(env, user.id);
  if (!profile) {
    const profileResponse = await restFetch(env, 'marketing_users', 'select=id,name,email,role,status', {
      method: 'POST',
      body: JSON.stringify({
        auth_user_id: user.id,
        name: displayName(user),
        email,
        role: 'owner',
        status: 'active',
        provider,
        provider_metadata: user.user_metadata ?? {},
      }),
    });
    if (!profileResponse.ok) throw new Error(`Profile creation failed: ${await profileResponse.text()}`);
    [profile] = await profileResponse.json() as Profile[];
  }

  const companyResponse = await restFetch(env, 'crm_companies', 'select=id,name,slug', {
    method: 'POST',
    body: JSON.stringify({
      name: companyName,
      slug: slugify(companyName),
      created_by: profile.id,
    }),
  });
  if (!companyResponse.ok) throw new Error(`Company creation failed: ${await companyResponse.text()}`);
  const [company] = await companyResponse.json() as Array<{ id: string }>;

  const memberResponse = await restFetch(env, 'crm_company_members', 'select=company_id,user_id,role,status', {
    method: 'POST',
    body: JSON.stringify({ company_id: company.id, user_id: profile.id, role: 'owner', status: 'active' }),
  });
  if (!memberResponse.ok) throw new Error(`Membership creation failed: ${await memberResponse.text()}`);

  return { profile, membership: { company_id: company.id, user_id: profile.id, role: 'owner', status: 'active' } as Membership };
}

async function startGoogle(request: Request, env: AuthEnv) {
  assertEnv(env);
  const origin = new URL(request.url).origin;
  const redirectTo = `${origin}/?auth_callback=google`;
  const authorizeUrl = `${env.SUPABASE_URL}/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(redirectTo)}`;
  const response = await fetch(authorizeUrl, {
    redirect: 'manual',
    headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY },
  });
  const location = response.headers.get('location');
  if (!location) return json({ error: { message: 'Google OAuth не настроен в Supabase' } }, 503);
  return Response.redirect(location, 302);
}

async function completeSupabaseSession(request: Request, env: AuthEnv) {
  const body = await request.json() as SupabaseSessionBody;
  if (!body.accessToken || !body.refreshToken) {
    return json({ error: { code: 'INVALID_SUPABASE_SESSION', message: 'Supabase session is incomplete' } }, 400);
  }

  const user = await getSupabaseUser(env, body.accessToken);
  if (!user) return json({ error: { code: 'INVALID_SUPABASE_SESSION', message: 'Supabase session is invalid' } }, 401);

  let profile = await findProfile(env, user.id);
  let membership = profile ? await findMembership(env, profile.id) : null;

  if (!profile || !membership) {
    const companyName = body.companyName?.trim();
    if (!companyName) {
      return json({
        error: {
          code: 'COMPANY_REQUIRED',
          message: 'Для первой регистрации укажите название компании',
        },
      }, 409);
    }
    const created = await createWorkspace(env, user, companyName, body.provider ?? 'email');
    profile = created.profile;
    membership = created.membership;
  }

  const headers = new Headers({ 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  headers.append('set-cookie', cookie('imds_access_token', body.accessToken, Number(body.expiresIn ?? 3600)));
  headers.append('set-cookie', cookie('imds_refresh_token', body.refreshToken, 60 * 60 * 24 * 30));

  return new Response(JSON.stringify({
    user: profile,
    companyId: membership.company_id,
    role: membership.role,
  }), { headers });
}

export async function handleGoogleAuthRequest(request: Request, env: AuthEnv) {
  const path = new URL(request.url).pathname;
  try {
    if (request.method === 'GET' && path === '/api/auth/google/start') return startGoogle(request, env);
    if (request.method === 'POST' && (path === '/api/auth/google/session' || path === '/api/auth/supabase/session')) {
      return completeSupabaseSession(request, env);
    }
    return null;
  } catch (error) {
    return json({ error: { message: error instanceof Error ? error.message : 'Ошибка Supabase Auth' } }, 500);
  }
}
