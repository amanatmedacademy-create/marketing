import type { AuthEnv, AuthSession } from './auth';

type SupabaseUser = { id: string; email?: string; user_metadata?: Record<string, unknown> };
type Profile = { id: string; name: string; email: string; role: string; status: string };
type Membership = { company_id: string; user_id: string; role: string; status: string };

function assertEnv(env: AuthEnv): asserts env is AuthEnv & { SUPABASE_SERVICE_ROLE_KEY: string } {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('Supabase environment is not configured');
}

async function rest<T>(env: AuthEnv, table: string, query: string): Promise<T> {
  assertEnv(env);
  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}?${query}`, {
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      'content-type': 'application/json',
    },
  });
  if (!response.ok) throw new Error(`Supabase lookup failed: ${response.status}`);
  return response.json() as Promise<T>;
}

export async function requireBearerSession(request: Request, env: AuthEnv): Promise<AuthSession | null> {
  const authorization = request.headers.get('authorization') ?? '';
  if (!authorization.startsWith('Bearer ')) return null;
  const accessToken = authorization.slice(7).trim();
  if (!accessToken) return null;

  assertEnv(env);
  const userResponse = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${accessToken}`,
    },
  });
  if (!userResponse.ok) return null;
  const authUser = await userResponse.json() as SupabaseUser;

  const profiles = await rest<Profile[]>(env, 'marketing_users', `select=id,name,email,role,status&auth_user_id=eq.${authUser.id}&status=eq.active&limit=1`);
  const profile = profiles[0];
  if (!profile) return null;

  const memberships = await rest<Membership[]>(env, 'crm_company_members', `select=company_id,user_id,role,status&user_id=eq.${profile.id}&status=eq.active&order=created_at.asc&limit=1`);
  const membership = memberships[0];
  if (!membership) return null;

  return {
    authUser,
    user: profile,
    companyId: membership.company_id,
    role: membership.role,
  };
}
