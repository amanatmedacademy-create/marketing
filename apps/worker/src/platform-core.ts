import type { AuthEnv, AuthSession } from './auth';
import { resolvePlatformTenantId, type CrmPlatformEnv } from './crm-kanban-platform';

type EntitlementRow = {
  entitlement_type: 'product' | 'module' | 'capability';
  entitlement_id: string;
  limits: Record<string, unknown> | null;
  starts_at: string;
  expires_at: string | null;
};

type ProductRow = { id: string; name: string; description: string | null; metadata: Record<string, unknown> };
type ModuleRow = {
  id: string;
  name: string;
  description: string | null;
  category: string;
  route: string | null;
  navigation_label: string | null;
  navigation_order: number;
  metadata: Record<string, unknown>;
};
type ProductModuleRow = { product_id: string; module_id: string; enabled_by_default: boolean; limits: Record<string, unknown> | null };
type CapabilityRow = { id: string; module_id: string };

type CentralBootstrapModule = {
  installationId: string;
  code: string;
  version: string;
  status: string;
  healthStatus: string;
  placement: Record<string, unknown>;
  permissions: string[];
  limits: Record<string, unknown>;
  config: Record<string, unknown>;
};

type CentralBootstrap = {
  tenant: { id: string; displayName: string };
  product: { code: string; shellVersion: string };
  modules: CentralBootstrapModule[];
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

async function getCentralBootstrap(env: CrmPlatformEnv, companyId: string): Promise<CentralBootstrap | null> {
  if (!env.PLATFORM_API_URL || !env.PLATFORM_SERVICE_TOKEN) return null;
  const platformTenantId = await resolvePlatformTenantId(env, companyId);
  if (!platformTenantId) return null;

  const response = await fetch(`${env.PLATFORM_API_URL.replace(/\/$/, '')}/v1/platform/bootstrap?product=marketing`, {
    headers: {
      authorization: `Bearer ${env.PLATFORM_SERVICE_TOKEN}`,
      'x-tenant-id': platformTenantId,
      accept: 'application/json',
    },
  });
  if (response.status === 404) return null;
  const payload = await response.json() as { data?: CentralBootstrap; error?: { message?: string } };
  if (!response.ok || !payload.data) throw new Error(payload.error?.message ?? 'Central platform bootstrap failed');
  return payload.data;
}

async function getEntitlements(env: AuthEnv & CrmPlatformEnv, session: AuthSession) {
  const now = new Date().toISOString();
  const entitlements = await rest<EntitlementRow[]>(
    env,
    `platform_company_entitlements?select=entitlement_type,entitlement_id,limits,starts_at,expires_at&company_id=eq.${encodeURIComponent(session.companyId)}&status=eq.active&starts_at=lte.${encodeURIComponent(now)}&or=(expires_at.is.null,expires_at.gt.${encodeURIComponent(now)})`,
  );

  const productIds = new Set(entitlements.filter(row => row.entitlement_type === 'product').map(row => row.entitlement_id));
  const moduleIds = new Set(entitlements.filter(row => row.entitlement_type === 'module').map(row => row.entitlement_id));
  const capabilityIds = new Set(entitlements.filter(row => row.entitlement_type === 'capability').map(row => row.entitlement_id));
  const limits: Record<string, unknown> = {};
  entitlements.forEach(row => mergeLimits(limits, row.limits));

  if (productIds.size) {
    const productFilter = Array.from(productIds).map(value => `\"${value.replace(/\"/g, '')}\"`).join(',');
    const productModules = await rest<ProductModuleRow[]>(
      env,
      `platform_product_modules?select=product_id,module_id,enabled_by_default,limits&product_id=in.(${productFilter})`,
    );
    productModules.filter(row => row.enabled_by_default).forEach(row => {
      moduleIds.add(row.module_id);
      mergeLimits(limits, row.limits);
    });
  }

  if (moduleIds.size) {
    const moduleFilter = Array.from(moduleIds).map(value => `\"${value.replace(/\"/g, '')}\"`).join(',');
    const moduleCapabilities = await rest<CapabilityRow[]>(
      env,
      `platform_capabilities?select=id,module_id&module_id=in.(${moduleFilter})`,
    );
    moduleCapabilities.forEach(row => capabilityIds.add(row.id));
  }

  const [products, localModules, central] = await Promise.all([
    productIds.size
      ? rest<ProductRow[]>(env, `platform_products?select=id,name,description,metadata&id=in.(${Array.from(productIds).map(value => `\"${value.replace(/\"/g, '')}\"`).join(',')})`)
      : Promise.resolve([]),
    moduleIds.size
      ? rest<ModuleRow[]>(env, `platform_modules?select=id,name,description,category,route,navigation_label,navigation_order,metadata&id=in.(${Array.from(moduleIds).map(value => `\"${value.replace(/\"/g, '')}\"`).join(',')})`)
      : Promise.resolve([]),
    getCentralBootstrap(env, session.companyId),
  ]);

  const modulesById = new Map<string, {
    id: string;
    name: string;
    description: string | null;
    category: string;
    route: string | null;
    navigationLabel: string | null;
    navigationOrder: number;
    metadata: Record<string, unknown>;
  }>();

  for (const module of localModules) {
    modulesById.set(module.id, {
      id: module.id,
      name: module.name,
      description: module.description,
      category: module.category,
      route: module.route,
      navigationLabel: module.navigation_label,
      navigationOrder: module.navigation_order,
      metadata: module.metadata ?? {},
    });
  }

  for (const module of central?.modules ?? []) {
    const route = typeof module.placement.route === 'string' ? module.placement.route : '/crm/kanban';
    const label = typeof module.placement.label === 'string' ? module.placement.label : 'Канбан';
    const order = typeof module.placement.order === 'number' ? module.placement.order : 25;
    modulesById.set(module.code, {
      id: module.code,
      name: module.code === 'crm.kanban' ? 'CRM Kanban' : module.code,
      description: 'Модуль, подключённый через IMDS Platform.',
      category: module.code.startsWith('crm.') ? 'crm' : 'platform',
      route,
      navigationLabel: label,
      navigationOrder: order,
      metadata: {
        source: 'imds-platform',
        installationId: module.installationId,
        version: module.version,
        status: module.status,
        healthStatus: module.healthStatus,
        config: module.config,
      },
    });
    module.permissions.forEach(permission => capabilityIds.add(permission));
    mergeLimits(limits, module.limits);
  }

  return json({
    companyId: session.companyId,
    userId: session.user.id,
    role: session.role,
    products,
    modules: Array.from(modulesById.values()).sort((a, b) => a.navigationOrder - b.navigationOrder),
    capabilities: Array.from(capabilityIds).sort(),
    limits,
    platform: central ? {
      tenant: central.tenant,
      product: central.product,
      source: 'central',
    } : {
      source: 'local-fallback',
    },
  });
}

export async function handlePlatformCoreRequest(request: Request, env: AuthEnv & CrmPlatformEnv, session: AuthSession) {
  const url = new URL(request.url);
  try {
    if (request.method === 'GET' && (url.pathname === '/api/platform/entitlements' || url.pathname === '/api/platform/me' || url.pathname === '/api/platform/bootstrap')) {
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
