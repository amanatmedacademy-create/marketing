import type { Env } from './integrations';

type Row = Record<string, unknown>;

function headers(env: Env): HeadersInit {
  return { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, accept: 'application/json' };
}

async function query<T>(env: Env, path: string): Promise<T> {
  const response = await fetch(`${env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/${path}`, { headers: headers(env), cache: 'no-store' });
  const body = await response.text();
  if (!response.ok) throw new Error(`Company users query failed (${response.status}): ${body.slice(0, 600)}`);
  return (body ? JSON.parse(body) : []) as T;
}

export async function listActiveCompanyUserIds(env: Env, companyId: string): Promise<string[]> {
  const rows = await query<Row[]>(env, `crm_company_members?select=user_id&company_id=eq.${encodeURIComponent(companyId)}&status=eq.active&limit=5000`);
  return rows.map((row) => typeof row.user_id === 'string' ? row.user_id : '').filter(Boolean);
}

export async function isActiveCompanyUser(env: Env, companyId: string, userId?: string | null): Promise<boolean> {
  if (!userId) return true;
  const rows = await query<Row[]>(env, `crm_company_members?select=user_id&company_id=eq.${encodeURIComponent(companyId)}&user_id=eq.${encodeURIComponent(userId)}&status=eq.active&limit=1`);
  return rows.length > 0;
}

export async function listActiveCompanyUsers(env: Env, companyId: string, select: string): Promise<Row[]> {
  const ids = await listActiveCompanyUserIds(env, companyId);
  if (!ids.length) return [];
  const safeIds = ids.map((value) => value.replace(/[^0-9a-f-]/gi, '')).filter(Boolean).join(',');
  return query<Row[]>(env, `marketing_users?select=${select}&id=in.(${safeIds})&status=eq.active&order=name.asc&limit=5000`);
}
