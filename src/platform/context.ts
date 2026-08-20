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
