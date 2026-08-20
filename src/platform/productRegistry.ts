import type { PlatformFrontendContext, PlatformProductRegistration } from './types';

export const marketingProduct: PlatformProductRegistration = {
  code: 'marketing',
  name: 'BELES',
  routePrefix: '/marketing',
  requiredEntitlement: 'product.marketing',
};

export const crmProduct: PlatformProductRegistration = {
  code: 'crm',
  name: 'CRM',
  routePrefix: '/crm',
  requiredPermission: 'crm.leads',
  requiredEntitlement: 'marketing.crm',
  legacyRoutes: ['/leads', '/customers', '/pipeline'],
};

const registrations = [marketingProduct, crmProduct] as const;
const byCode = new Map(registrations.map((product) => [product.code, product]));
if (byCode.size !== registrations.length) throw new Error('Duplicate product registration');

export const productRegistry = Object.freeze({
  list: () => [...registrations],
  get: (code: string) => byCode.get(code),
});

export function canAccessRegisteredProduct(
  product: PlatformProductRegistration,
  context: Pick<PlatformFrontendContext, 'permissions' | 'entitlements'>,
): boolean {
  const permissionAllowed = !product.requiredPermission || context.permissions.includes(product.requiredPermission);
  const entitlementAllowed = !product.requiredEntitlement || context.entitlements.includes(product.requiredEntitlement);
  return permissionAllowed && entitlementAllowed;
}
