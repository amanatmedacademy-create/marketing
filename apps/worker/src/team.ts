import type { AuthEnv } from './auth';

type Env = AuthEnv & { DEFAULT_COMPANY_ID?: string };
type MemberRow = { user_id: string; role: string; status: string; created_at: string };
type UserRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  full_name: string | null;
  name: string;
  email: string;
  avatar_url: string | null;
  last_seen_at: string | null;
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});

function assertEnv(env: Env): asserts env is Env & { SUPABASE_SERVICE_ROLE_KEY: string; DEFAULT_COMPANY_ID: string } {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY || !env.DEFAULT_COMPANY_ID) throw new Error('Supabase environment is not configured');
}

async function rest<T>(env: Env, table: string, query: string): Promise<T> {
  assertEnv(env);
  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}?${query}`, {
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      'content-type': 'application/json',
    },
  });
  if (!response.ok) throw new Error(`Supabase request failed: ${response.status} ${await response.text()}`);
  return response.json() as Promise<T>;
}

export async function handleTeamRequest(request: Request, env: Env) {
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.pathname !== '/api/team') return null;
  assertEnv(env);
  const members = await rest<MemberRow[]>(env, 'crm_company_members', `select=user_id,role,status,created_at&company_id=eq.${env.DEFAULT_COMPANY_ID}&status=eq.active&order=created_at.asc`);
  if (!members.length) return json([]);
  const ids = members.map((member) => member.user_id).join(',');
  const users = await rest<UserRow[]>(env, 'marketing_users', `select=id,first_name,last_name,full_name,name,email,avatar_url,last_seen_at&id=in.(${ids})`);
  const byId = new Map(users.map((user) => [user.id, user]));
  return json(members.flatMap((member) => {
    const user = byId.get(member.user_id);
    if (!user) return [];
    const fullName = user.full_name?.trim() || user.name?.trim() || user.email.split('@')[0];
    const firstName = user.first_name?.trim() || fullName.split(/\s+/)[0] || user.email.split('@')[0];
    const lastName = user.last_name?.trim() || fullName.split(/\s+/).slice(1).join(' ');
    return [{
      userId: user.id,
      firstName,
      lastName,
      fullName,
      email: user.email,
      avatarUrl: user.avatar_url,
      role: member.role,
      department: null,
      isOnline: Boolean(user.last_seen_at && Date.now() - new Date(user.last_seen_at).getTime() < 5 * 60 * 1000),
      lastSeenAt: user.last_seen_at,
    }];
  }));
}
