import type { AuthEnv, AuthSession } from './auth';

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

type CompanyContext = {
  company_id: string;
  company_name: string;
  marketing_user_id: string;
  member_role: string;
};

function getPublicKey(env: AuthEnv): string {
  const key = env.SUPABASE_PUBLISHABLE_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY;
  if (!env.SUPABASE_URL || !key) {
    throw new Error('Supabase environment is not configured');
  }
  return key;
}

async function resolveCompanyContext(
  env: AuthEnv,
  accessToken: string,
  requestedCompanyId: string | null,
): Promise<CompanyContext | null> {
  const apiKey = getPublicKey(env);
  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/resolve_company_context`, {
    method: 'POST',
    headers: {
      apikey: apiKey,
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ requested_company_id: requestedCompanyId }),
  });

  if (!response.ok) return null;
  const rows = await response.json() as CompanyContext[];
  return rows[0] ?? null;
}

async function loadProfile(env: AuthEnv, accessToken: string, marketingUserId: string): Promise<Profile | null> {
  const apiKey = getPublicKey(env);
  const response = await fetch(
    `${env.SUPABASE_URL}/rest/v1/marketing_users?select=id,name,email,role,status&id=eq.${encodeURIComponent(marketingUserId)}&status=eq.active&limit=1`,
    {
      headers: {
        apikey: apiKey,
        authorization: `Bearer ${accessToken}`,
        'content-type': 'application/json',
      },
    },
  );

  if (!response.ok) return null;
  const rows = await response.json() as Profile[];
  return rows[0] ?? null;
}

export async function requireBearerSession(request: Request, env: AuthEnv): Promise<AuthSession | null> {
  const authorization = request.headers.get('authorization') ?? '';
  if (!authorization.startsWith('Bearer ')) return null;

  const accessToken = authorization.slice(7).trim();
  if (!accessToken) return null;

  const apiKey = getPublicKey(env);
  const userResponse = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: {
      apikey: apiKey,
      authorization: `Bearer ${accessToken}`,
    },
  });
  if (!userResponse.ok) return null;

  const authUser = await userResponse.json() as SupabaseUser;
  const requestedCompanyId = request.headers.get('x-company-id')?.trim() || null;
  const context = await resolveCompanyContext(env, accessToken, requestedCompanyId);
  if (!context) return null;

  const profile = await loadProfile(env, accessToken, context.marketing_user_id);
  if (!profile || profile.id !== context.marketing_user_id) return null;

  return {
    authUser,
    user: profile,
    companyId: context.company_id,
    role: context.member_role,
  };
}
