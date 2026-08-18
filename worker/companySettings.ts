import { localDataJson, type LocalDataEnv } from './localData';
import { requireCompanyId, type TenantScopedEnv } from './tenantScope';

type CompanySettingsEnv = LocalDataEnv & TenantScopedEnv;
type CompanyRow = { id: string; name: string; slug?: string | null; timezone: string };

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});

const text = (value: unknown): string => typeof value === 'string' ? value.trim() : '';

function isAdmin(request: Request): boolean {
  const role = text(request.headers.get('x-amanat-auth-role'));
  return role === 'administrator' || role === 'super_admin';
}

function validTimezone(value: string): boolean {
  if (!value || value.length > 80) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

async function readCompany(env: CompanySettingsEnv, companyId: string): Promise<CompanyRow | null> {
  const rows = await localDataJson<CompanyRow[]>(
    env,
    `crm_companies?id=eq.${encodeURIComponent(companyId)}&select=id,name,slug,timezone&limit=1`,
    {},
    'Clinic settings',
  );
  return rows[0] || null;
}

export async function handleCompanySettings(request: Request, env: CompanySettingsEnv, url: URL): Promise<Response | null> {
  if (url.pathname !== '/api/company/settings') return null;
  if (!isAdmin(request)) return json({ error: 'Настройки клиники доступны только администратору' }, 403);

  const companyId = requireCompanyId(env);

  if (request.method === 'GET') {
    const company = await readCompany(env, companyId);
    return company ? json({ company }) : json({ error: 'Клиника не найдена' }, 404);
  }

  if (request.method === 'PATCH') {
    const payload = await request.json().catch(() => ({})) as Record<string, unknown>;
    const timezone = text(payload.timezone);
    if (!validTimezone(timezone)) return json({ error: 'Укажите корректный IANA timezone, например Asia/Almaty' }, 400);

    const rows = await localDataJson<CompanyRow[]>(
      env,
      `crm_companies?id=eq.${encodeURIComponent(companyId)}&select=id,name,slug,timezone`,
      {
        method: 'PATCH',
        headers: { prefer: 'return=representation' },
        body: JSON.stringify({ timezone }),
      },
      'Clinic settings',
    );
    const company = rows[0] || await readCompany(env, companyId);
    return company ? json({ company }) : json({ error: 'Клиника не найдена' }, 404);
  }

  return json({ error: 'Method not allowed' }, 405);
}
