export interface TenantScopedEnv {
  CURRENT_COMPANY_ID?: string;
  DEFAULT_COMPANY_ID?: string;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function requireCompanyId(env: TenantScopedEnv): string {
  const value = String(env.CURRENT_COMPANY_ID || env.DEFAULT_COMPANY_ID || '').trim();
  if (!UUID_PATTERN.test(value)) throw new Error('Текущая клиника не определена');
  return value;
}

export function companyEq(env: TenantScopedEnv): string {
  return `company_id=eq.${encodeURIComponent(requireCompanyId(env))}`;
}

export function withCompanyQuery(path: string, env: TenantScopedEnv): string {
  return `${path}${path.includes('?') ? '&' : '?'}${companyEq(env)}`;
}
