import type { Env } from '../index';
import type { AuthContext, CompanyMembership } from './types';

type SupabaseUser = {
  id: string;
  email?: string | null;
};

type MembershipRow = {
  company_id: string;
  role: CompanyMembership['role'];
  companies: { name: string } | null;
};

export class AuthenticationError extends Error {
  constructor(message: string, public readonly status = 401) {
    super(message);
  }
}

function bearerToken(request: Request): string {
  const authorization = request.headers.get('authorization');
  if (!authorization?.startsWith('Bearer ')) {
    throw new AuthenticationError('Bearer token is required');
  }

  const token = authorization.slice('Bearer '.length).trim();
  if (!token) throw new AuthenticationError('Bearer token is required');
  return token;
}

async function resolveUser(env: Env, token: string): Promise<SupabaseUser> {
  const response = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: {
      apikey: env.SUPABASE_ANON_KEY,
      authorization: `Bearer ${token}`
    }
  });

  if (!response.ok) throw new AuthenticationError('Invalid or expired session');
  return response.json<SupabaseUser>();
}

async function resolveMemberships(env: Env, userId: string): Promise<CompanyMembership[]> {
  const query = new URLSearchParams({
    select: 'company_id,role,companies(name)',
    user_id: `eq.${userId}`,
    is_active: 'eq.true'
  });

  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/company_memberships?${query}`, {
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`
    }
  });

  if (!response.ok) throw new Error(`Membership lookup failed: ${response.status}`);
  const rows = await response.json<MembershipRow[]>();

  return rows.flatMap((row) => row.companies ? [{
    companyId: row.company_id,
    companyName: row.companies.name,
    role: row.role
  }] : []);
}

export async function resolveAuthContext(request: Request, env: Env): Promise<AuthContext> {
  const token = bearerToken(request);
  const user = await resolveUser(env, token);
  const memberships = await resolveMemberships(env, user.id);

  if (!memberships.length) {
    throw new AuthenticationError('User has no active company membership', 403);
  }

  const requestedCompanyId = request.headers.get('x-company-id');
  const activeMembership = requestedCompanyId
    ? memberships.find((membership) => membership.companyId === requestedCompanyId)
    : memberships[0];

  if (!activeMembership) {
    throw new AuthenticationError('Company access denied', 403);
  }

  return {
    user: { id: user.id, email: user.email ?? null },
    memberships,
    activeMembership
  };
}
