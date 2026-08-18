export interface TenantScopedEnv {
  CURRENT_COMPANY_ID?: string;
  DEFAULT_COMPANY_ID?: string;
  CURRENT_BRANCH_ID?: string;
}

export const ALL_BRANCHES = '*';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function requireCompanyId(env: TenantScopedEnv): string {
  const value = String(env.CURRENT_COMPANY_ID || env.DEFAULT_COMPANY_ID || '').trim();
  if (!UUID_PATTERN.test(value)) throw new Error('Текущая клиника не определена');
  return value;
}

export function branchScope(env: TenantScopedEnv): { all: boolean; branchId: string | null } {
  const value = String(env.CURRENT_BRANCH_ID || '').trim();
  if (value === ALL_BRANCHES) return { all: true, branchId: null };
  return { all: false, branchId: UUID_PATTERN.test(value) ? value : null };
}

export function requireBranchId(env: TenantScopedEnv): string {
  const scope = branchScope(env);
  if (scope.all) throw new Error('Для этой операции выберите конкретный филиал');
  if (!scope.branchId) throw new Error('Текущий филиал не определён');
  return scope.branchId;
}

export function companyEq(env: TenantScopedEnv): string {
  return `company_id=eq.${encodeURIComponent(requireCompanyId(env))}`;
}

export function branchEq(env: TenantScopedEnv): string | null {
  const scope = branchScope(env);
  return scope.branchId ? `branch_id=eq.${encodeURIComponent(scope.branchId)}` : null;
}

export function operationalEq(env: TenantScopedEnv): string {
  const branch = branchEq(env);
  return branch ? `${companyEq(env)}&${branch}` : companyEq(env);
}

export function withCompanyQuery(path: string, env: TenantScopedEnv): string {
  return `${path}${path.includes('?') ? '&' : '?'}${companyEq(env)}`;
}

export function withOperationalQuery(path: string, env: TenantScopedEnv): string {
  return `${path}${path.includes('?') ? '&' : '?'}${operationalEq(env)}`;
}

export function branchWriteFields(env: TenantScopedEnv): { company_id: string; branch_id: string } {
  return { company_id: requireCompanyId(env), branch_id: requireBranchId(env) };
}
