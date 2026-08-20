import type { MeContext } from './sdkContract';
import type {
  PlatformAccessScope,
  PlatformBranch,
  PlatformFrontendContext,
  PlatformProductRegistration,
} from './types';

type LegacyAccessGrant = Record<'view' | 'create' | 'edit' | 'delete' | 'export' | 'manage', boolean>;
type LegacyUser = {
  id: string;
  email: string;
  name: string;
  role: string;
  companyId?: string | null;
  companies?: Array<{ id: string; name: string; role: string; status: string }>;
  permissions?: Record<string, LegacyAccessGrant>;
};
type LegacyEntitlements = {
  productEnabled: boolean;
  modules: Record<string, boolean>;
};

function flattenPermissions(permissions: LegacyUser['permissions']): string[] {
  if (!permissions) return [];
  const result = new Set<string>();
  for (const [moduleId, grant] of Object.entries(permissions)) {
    if (grant.view || grant.manage) result.add(moduleId);
    for (const [action, allowed] of Object.entries(grant)) {
      if (allowed) result.add(`${moduleId}.${action}`);
    }
  }
  return [...result];
}

export function buildPlatformFrontendContext(input: {
  user: LegacyUser;
  organizationId?: string | null;
  branchId?: string | null;
  branches?: PlatformBranch[];
  accessScopes?: PlatformAccessScope[];
  platform?: LegacyEntitlements | null;
  products?: PlatformProductRegistration[];
}): PlatformFrontendContext {
  const organizationId = input.organizationId || input.user.companyId || null;
  const permissions = flattenPermissions(input.user.permissions);
  const entitlements = input.platform
    ? [
        ...(input.platform.productEnabled ? ['product.marketing'] : []),
        ...Object.entries(input.platform.modules)
          .filter(([, enabled]) => enabled)
          .map(([key]) => key),
      ]
    : [];

  return {
    user: { id: input.user.id, email: input.user.email, displayName: input.user.name },
    organizationId,
    organizations: (input.user.companies ?? []).map((company) => ({
      id: company.id,
      name: company.name,
      role: company.role,
      status: company.status,
    })),
    branchId: input.branchId || null,
    branches: input.branches ?? [],
    roles: [input.user.role],
    permissions,
    entitlements,
    accessScopes: input.accessScopes ?? [],
    products: input.products ?? [],
  };
}

export function buildPlatformFrontendContextFromMeContext(
  meContext: MeContext,
  activeOrganizationId: string,
  activeBranchId: string,
): PlatformFrontendContext {
  if (!activeOrganizationId || meContext.tenant.id !== activeOrganizationId) {
    throw new Error('Tenant context mismatch');
  }

  const branches = meContext.branches ?? [];
  if (activeBranchId) {
    const branch = branches.find((item) => item.id === activeBranchId);
    if (!branch || branch.status !== 'active') throw new Error('Branch context mismatch');
  }

  const entitlements = meContext.products.flatMap((product) => {
    if (!product.enabled) return [];
    const productEntitlement = product.key === 'marketing' ? ['product.marketing'] : [`product.${product.key}`];
    const modules = product.modules.filter((module) => module.enabled).map((module) => module.key);
    return [...productEntitlement, ...modules];
  });

  return {
    user: {
      id: meContext.user.id,
      email: meContext.user.email,
      displayName: meContext.user.displayName || meContext.user.email,
    },
    organizationId: meContext.tenant.id,
    organizations: [{
      id: meContext.tenant.id,
      name: meContext.tenant.name,
      role: meContext.roles[0] || '',
      status: 'active',
    }],
    branchId: activeBranchId || null,
    branches: branches.map((branch) => ({ ...branch })),
    roles: [...meContext.roles],
    permissions: [...meContext.permissions],
    entitlements,
    accessScopes: (meContext.accessScopes ?? []).map((scope) => ({ ...scope })),
    products: [],
  };
}
