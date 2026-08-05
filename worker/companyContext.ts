export interface CompanyContextEnv {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  DEFAULT_COMPANY_ID?: string;
}

type CompanyRow = { id?: string };

const text = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function resolveCompanyId(env: CompanyContextEnv): Promise<string> {
  const configured = text(env.DEFAULT_COMPANY_ID);
  if (configured) {
    if (!UUID_PATTERN.test(configured)) throw new Error('DEFAULT_COMPANY_ID имеет неверный формат UUID');
    return configured;
  }

  const response = await fetch(`${env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/crm_companies?select=id&order=created_at.asc&limit=2`, {
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      accept: 'application/json',
    },
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`Company context: ${response.status} ${body}`);

  const rows = (body ? JSON.parse(body) : []) as CompanyRow[];
  const ids = rows.map((row) => text(row.id)).filter((id) => UUID_PATTERN.test(id));
  if (ids.length === 1) return ids[0];
  if (ids.length === 0) throw new Error('В Supabase не найдена компания для сохранения интеграции');
  throw new Error('В Supabase несколько компаний. Настройте DEFAULT_COMPANY_ID в Cloudflare');
}
