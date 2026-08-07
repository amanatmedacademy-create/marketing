export interface CompanyContextEnv {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  DEFAULT_COMPANY_ID?: string;
  CURRENT_COMPANY_ID?: string;
}

type CompanyRow = { id?: string };
type MembershipRow = { company_id?: string };

const text = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function assertUuid(value: string, label: string): string {
  if (!UUID_PATTERN.test(value)) throw new Error(`${label} имеет неверный формат UUID`);
  return value;
}

function headers(env: CompanyContextEnv): HeadersInit {
  return {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    accept: 'application/json',
  };
}

async function activeMembershipCompanyIds(env: CompanyContextEnv, userId: string): Promise<string[]> {
  assertUuid(userId, 'User ID');
  const response = await fetch(
    `${env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/crm_company_members?user_id=eq.${encodeURIComponent(userId)}&status=eq.active&select=company_id&order=created_at.asc&limit=10`,
    { headers: headers(env) },
  );
  const body = await response.text();
  if (!response.ok) throw new Error(`Company membership context: ${response.status} ${body}`);
  const rows = (body ? JSON.parse(body) : []) as MembershipRow[];
  return [...new Set(rows.map((row) => text(row.company_id)).filter((id) => UUID_PATTERN.test(id)))];
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

    const configured = text(env.DEFAULT_COMPANY_ID);
    if (configured) {
      assertUuid(configured, 'DEFAULT_COMPANY_ID');
      if (memberships.includes(configured)) return configured;
    }
    throw new Error('Пользователь состоит в нескольких компаниях. Требуется выбрать текущую компанию.');
  }

  const configured = text(env.DEFAULT_COMPANY_ID);
  if (configured) return assertUuid(configured, 'DEFAULT_COMPANY_ID');

  const response = await fetch(`${env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/crm_companies?select=id&order=created_at.asc&limit=2`, {
    headers: headers(env),
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`Company context: ${response.status} ${body}`);

  const rows = (body ? JSON.parse(body) : []) as CompanyRow[];
  const ids = rows.map((row) => text(row.id)).filter((id) => UUID_PATTERN.test(id));
  if (ids.length === 1) return ids[0];
  if (ids.length === 0) throw new Error('В Supabase не найдена компания для сохранения интеграции');
  throw new Error('В Supabase несколько компаний. Требуется tenant-контекст запроса.');
}
