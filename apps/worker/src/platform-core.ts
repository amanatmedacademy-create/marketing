import type { AuthEnv, AuthSession } from './auth';

type EntitlementRow = {
  entitlement_type: 'product' | 'module' | 'capability';
  entitlement_id: string;
  limits: Record<string, unknown> | null;
  starts_at: string;
  expires_at: string | null;
};

type ProductModuleRow = {
  product_id: string;
  module_id: string;
  enabled_by_default: boolean;
  limits: Record<string, unknown> | null;
};

type CapabilityRow = {
  id: string;
  module_id: string;
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});

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
  if (!response.ok) throw new Error(`Platform query failed: ${await response.text()}`);
  return response.json() as Promise<T>;
}

function mergeLimits(target: Record<string, unknown>, source: Record<string, unknown> | null | undefined) {
  if (!source) return target;
  for (const [key, value] of Object.entries(source)) target[key] = value;
  return target;
}

async function getEntitlements(env: AuthEnv, session: AuthSession) {
  const now = new Date().toISOString();
  const entitlements = await rest<EntitlementRow[]>(
    env,
    `platform_company_entitlements?select=entitlement_type,entitlement_id,limits,starts_at,expires_at&company_id=eq.${encodeURIComponent(session.companyId)}&status=eq.active&starts_at=lte.${encodeURIComponent(now)}&or=(expires_at.is.null,expires_at.gt.${encodeURIComponent(now)})`,
  );

  const products = new Set(entitlements.filter(row => row.entitlement_type === 'product').map(row => row.entitlement_id));
  const modules = new Set(entitlements.filter(row => row.entitlement_type === 'module').map(row => row.entitlement_id));
  const capabilities = new Set(entitlements.filter(row => row.entitlement_type === 'capability').map(row => row.entitlement_id));
  const limits: Record<string, unknown> = {};
  entitlements.forEach(row => mergeLimits(limits, row.limits));

  if (products.size) {
    const productFilter = Array.from(products).map(value => `\"${value.replace(/\"/g, '')}\"`).join(',');
    const productModules = await rest<ProductModuleRow[]>(
      env,
      `platform_product_modules?select=product_id,module_id,enabled_by_default,limits&product_id=in.(${productFilter})`,
    );
    productModules.filter(row => row.enabled_by_default).forEach(row => {
      modules.add(row.module_id);
      mergeLimits(limits, row.limits);
    });
  }

  if (modules.size) {
    const moduleFilter = Array.from(modules).map(value => `\"${value.replace(/\"/g, '')}\"`).join(',');
    const moduleCapabilities = await rest<CapabilityRow[]>(
      env,
      `platform_capabilities?select=id,module_id&module_id=in.(${moduleFilter})`,
    );
    moduleCapabilities.forEach(row => capabilities.add(row.id));
  }

  return json({
    companyId: session.companyId,
    userId: session.user.id,
    role: session.role,
    products: Array.from(products).sort(),
    modules: Array.from(modules).sort(),
    capabilities: Array.from(capabilities).sort(),
    limits,
  });
}

export async function handlePlatformCoreRequest(request: Request, env: AuthEnv, session: AuthSession) {
  const url = new URL(request.url);
  try {
    if (request.method === 'GET' && (url.pathname === '/api/platform/entitlements' || url.pathname === '/api/platform/me')) {
      return getEntitlements(env, session);
    }
    return null;
  } catch (error) {
    return json({
      error: {
        code: 'PLATFORM_CORE_ERROR',
        message: error instanceof Error ? error.message : 'Ошибка Platform Core',
      },
    }, 500);
  }
}
