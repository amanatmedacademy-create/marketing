const COMPANY_KEY = 'imds_active_company_id';
const BRANCH_KEY = 'imds_active_branch_id';

export function activeOrganizationId(): string {
  return localStorage.getItem(COMPANY_KEY)?.trim() || '';
}

export function activeBranchId(): string {
  return localStorage.getItem(BRANCH_KEY)?.trim() || '';
}

export function setActiveBranchId(branchId: string | null): void {
  if (branchId) localStorage.setItem(BRANCH_KEY, branchId);
  else localStorage.removeItem(BRANCH_KEY);
}

export function switchOrganizationContext(organizationId: string | null): void {
  if (organizationId) localStorage.setItem(COMPANY_KEY, organizationId);
  else localStorage.removeItem(COMPANY_KEY);
  localStorage.removeItem(BRANCH_KEY);
}
