import type { AuthEnv, AuthSession } from './auth';

type EntitlementRow = {
  entitlement_type: 'product' | 'module' | 'capability';
  entitlement_id: string;
};

type ProductModuleRow = {
  product_id: string;
  module_id: string;
  enabled_by_default: boolean;
};

const MODULE_ROUTES: Array<{ test: (pathname: string) => boolean; moduleId: string }> = [
  { test: pathname => pathname === '/api/dashboard', moduleId: 'dashboard' },
  { test: pathname => pathname === '/api/pipelines' || pathname.startsWith('/api/pipelines/') || pathname === '/api/deals' || pathname.startsWith('/api/deals/'), moduleId: 'crm.deals' },
  { test: pathname => pathname === '/api/tasks' || pathname.startsWith('/api/tasks/'), moduleId: 'work.tasks' },
  { test: pathname => pathname === '/api/projects' || pathname.startsWith('/api/projects/'), moduleId: 'work.projects' },
  { test: pathname => pathname === '/api/team' || pathname.startsWith('/api/team/'), moduleId: 'team' },
  { test: pathname => pathname === '/api/accounting' || pathname.startsWith('/api/accounting/'), moduleId: 'accounting' },
  { test: pathname => pathname.startsWith('/api/integrations/meta/ads/'), moduleId: 'advertising' },
  { test: pathname => pathname.startsWith('/api/analytics/'), moduleId: 'analytics.attribution' },
  { test: pathname => pathname.startsWith('/api/integrations/'), moduleId: 'integrations' },
];

function assertEnv(env: AuthEnv): asserts env is AuthEnv & { SUPABASE_SERVICE_ROLE_KEY: string } {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('Platform environment is not configured');
}

async function rest<T>(env: AuthEnv, path: string): Promise<T> {
  assertEnv(env);
  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      'content-type': 'application/json',
    },
  });
  if (!response.ok) throw new Error(`Entitlement query failed: ${response.status} ${await response.text()}`);
  return response.json() as Promise<T>;
}

function quotedIn(values: string[]) {
  return values.map(value => `\"${value.replace(/\"/g, '')}\"`).join(',');
}

export function requiredModuleForPath(pathname: string) {
  return MODULE_ROUTES.find(route => route.test(pathname))?.moduleId ?? null;
}

export async function hasModuleEntitlement(env: AuthEnv, session: AuthSession, moduleId: string) {
  const now = new Date().toISOString();
  const entitlements = await rest<EntitlementRow[]>(
    env,
    `platform_company_entitlements?select=entitlement_type,entitlement_id&company_id=eq.${encodeURIComponent(session.companyId)}&status=eq.active&starts_at=lte.${encodeURIComponent(now)}&or=(expires_at.is.null,expires_at.gt.${encodeURIComponent(now)})`,
  );

  if (entitlements.some(row => row.entitlement_type === 'module' && row.entitlement_id === moduleId)) return true;

  const products = entitlements
    .filter(row => row.entitlement_type === 'product')
    .map(row => row.entitlement_id);
  if (!products.length) return false;

  const productModules = await rest<ProductModuleRow[]>(
    env,
    `platform_product_modules?select=product_id,module_id,enabled_by_default&product_id=in.(${quotedIn(products)})&module_id=eq.${encodeURIComponent(moduleId)}&enabled_by_default=eq.true`,
  );
  return productModules.length > 0;
}
