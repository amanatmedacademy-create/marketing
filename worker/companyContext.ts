export interface CompanyContextEnv {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  IMDS_LOCAL_DB_URL?: string;
  IMDS_LOCAL_SERVICE_ROLE_KEY?: string;
  DEFAULT_COMPANY_ID?: string;
  CURRENT_COMPANY_ID?: string;
}

export interface UserCompany {
  id: string;
  name: string;
  slug: string;
  role: string;
  status: string;
}

type CompanyRow = { id?: string; name?: string; slug?: string };
type MembershipRow = { company_id?: string; role?: string; status?: string };

const text = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function assertUuid(value: string, label: string): string {
  if (!UUID_PATTERN.test(value)) throw new Error(`${label} имеет неверный формат UUID`);
  return value;
}

function dataBase(env: CompanyContextEnv): string {
  return (text(env.IMDS_LOCAL_DB_URL) || text(env.SUPABASE_URL)).replace(/\/$/, '');
}

function dataKey(env: CompanyContextEnv): string {
  return text(env.IMDS_LOCAL_SERVICE_ROLE_KEY) || text(env.SUPABASE_SERVICE_ROLE_KEY);
}

function headers(env: CompanyContextEnv): HeadersInit {
  const key = dataKey(env);
  return {
    apikey: key,
    authorization: `Bearer ${key}`,
    accept: 'application/json',
  };
}

async function activeMemberships(env: CompanyContextEnv, userId: string): Promise<MembershipRow[]> {
  assertUuid(userId, 'User ID');
  const response = await fetch(
    `${dataBase(env)}/rest/v1/crm_company_members?user_id=eq.${encodeURIComponent(userId)}&status=eq.active&select=company_id,role,status&order=created_at.asc&limit=100`,
    { headers: headers(env) },
  );
  const body = await response.text();
  if (!response.ok) throw new Error(`Company membership context: ${response.status} ${body}`);
  return (body ? JSON.parse(body) : []) as MembershipRow[];
}

async function activeMembershipCompanyIds(env: CompanyContextEnv, userId: string): Promise<string[]> {
  const rows = await activeMemberships(env, userId);
  return [...new Set(rows.map((row) => text(row.company_id)).filter((id) => UUID_PATTERN.test(id)))];
}

export async function listUserCompanies(env: CompanyContextEnv, userId: string): Promise<UserCompany[]> {
  const memberships = await activeMemberships(env, userId);
  const ids = [...new Set(memberships.map((row) => text(row.company_id)).filter((id) => UUID_PATTERN.test(id)))];
  if (!ids.length) return [];
  const response = await fetch(
    `${dataBase(env)}/rest/v1/crm_companies?id=in.(${ids.map(encodeURIComponent).join(',')})&select=id,name,slug&order=name.asc`,
    { headers: headers(env) },
  );
  const body = await response.text();
  if (!response.ok) throw new Error(`Company list context: ${response.status} ${body}`);
  const companies = (body ? JSON.parse(body) : []) as CompanyRow[];
  const membershipMap = new Map(memberships.map((row) => [text(row.company_id), row]));
  return companies.flatMap((company) => {
    const id = text(company.id);
    const membership = membershipMap.get(id);
    if (!id || !membership) return [];
    return [{ id, name: text(company.name) || id, slug: text(company.slug), role: text(membership.role), status: text(membership.status) || 'active' }];
  });
}

export async function resolveCompanyId(env: CompanyContextEnv, userId?: string): Promise<string> {
  const current = text(env.CURRENT_COMPANY_ID);
  if (current) {
    assertUuid(current, 'CURRENT_COMPANY_ID');
    if (userId) {
      const memberships = await activeMembershipCompanyIds(env, userId);
      if (!memberships.includes(current)) throw new Error('Пользователь не состоит в текущей компании');
    }
    return current;
  }

  if (userId) {
    const memberships = await activeMembershipCompanyIds(env, userId);
    if (memberships.length === 1) return memberships[0];
    if (memberships.length === 0) throw new Error('Пользователь не привязан ни к одной активной компании');
    throw new Error('Пользователь состоит в нескольких компаниях. Требуется выбрать текущую компанию.');
  }

  const configured = text(env.DEFAULT_COMPANY_ID);
  if (configured) return assertUuid(configured, 'DEFAULT_COMPANY_ID');

  const response = await fetch(`${dataBase(env)}/rest/v1/crm_companies?select=id&order=created_at.asc&limit=2`, { headers: headers(env) });
  const body = await response.text();
  if (!response.ok) throw new Error(`Company context: ${response.status} ${body}`);

  const rows = (body ? JSON.parse(body) : []) as CompanyRow[];
  const ids = rows.map((row) => text(row.id)).filter((id) => UUID_PATTERN.test(id));
  if (ids.length === 1) return ids[0];
  if (ids.length === 0) throw new Error('Не найдена компания для tenant-контекста');
  throw new Error('Найдено несколько компаний. Требуется tenant-контекст запроса.');
}
