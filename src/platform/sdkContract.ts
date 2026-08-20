export type TenantId = string;
export type UserId = string;
export type BranchId = string;
export type ProductKey = string;
export type ModuleKey = string;
export type PermissionKey = string;
export type CapabilityKey = string;
export type AccessScopeType = 'organization' | 'branch' | 'product' | 'branch_product';

export interface UserIdentity {
  id: UserId;
  email: string;
  displayName?: string;
}

export interface TenantContext {
  id: TenantId;
  name: string;
  branchId?: BranchId;
}

export interface BranchContext {
  id: BranchId;
  code: string;
  name: string;
  status: string;
}

export interface AccessScopeContext {
  id: string;
  role: string;
  type: AccessScopeType;
  branchId?: BranchId;
  productCode?: ProductKey;
  permissions: PermissionKey[];
}

export interface ModuleEntitlement {
  key: ModuleKey;
  enabled: boolean;
  capabilities: CapabilityKey[];
}

export interface ProductEntitlement {
  key: ProductKey;
  enabled: boolean;
  planKey?: string;
  capabilities: CapabilityKey[];
  modules: ModuleEntitlement[];
}

export interface MeContext {
  user: UserIdentity;
  tenant: TenantContext;
  roles: string[];
  permissions: PermissionKey[];
  products: ProductEntitlement[];
  branches?: BranchContext[];
  accessScopes?: AccessScopeContext[];
}

export interface ApiErrorBody {
  code: string;
  message: string;
  requestId?: string;
  details?: Record<string, unknown>;
}
