export type AccessScopeType = 'organization' | 'branch' | 'product' | 'branch_product';

export type PlatformBranch = {
  id: string;
  code: string;
  name: string;
  status: string;
};

export type PlatformAccessScope = {
  id: string;
  role: string;
  type: AccessScopeType;
  branchId?: string;
  productCode?: string;
  permissions: string[];
};

export type PlatformProductRegistration = {
  code: string;
  name: string;
  routePrefix: string;
  requiredPermission?: string;
  requiredEntitlement?: string;
  legacyRoutes?: string[];
};

export type PlatformOrganization = {
  id: string;
  name: string;
  role: string;
  status: string;
};

export type PlatformFrontendContext = {
  user: { id: string; email: string; displayName: string };
  organizationId: string | null;
  organizations: PlatformOrganization[];
  branchId: string | null;
  branches: PlatformBranch[];
  roles: string[];
  permissions: string[];
  entitlements: string[];
  accessScopes: PlatformAccessScope[];
  products: PlatformProductRegistration[];
};
