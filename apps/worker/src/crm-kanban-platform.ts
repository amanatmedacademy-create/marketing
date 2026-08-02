import type { AuthEnv } from './auth';

export interface CrmPlatformEnv extends AuthEnv {
  CRM_PLATFORM_TOKEN?: string;
  PLATFORM_API_URL?: string;
  PLATFORM_SERVICE_TOKEN?: string;
}

type InternalCommand = {
  installationId?: string;
  organizationId?: string;
  companyId?: string;
  hostProductCode?: string;
  moduleCode?: string;
  moduleVersion?: string;
  config?: Record<string, unknown>;
  limits?: Record<string, unknown>;
  permissions?: string[];
  idempotencyKey?: string;
  traceId?: string;
};

type PlatformDecision = {
  allowed: boolean;
  installationId: string | null;
  reason: string;
  effectiveLimits: Record<string, unknown>;
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  },
});

function assertServiceEnv(env: CrmPlatformEnv): asserts env is CrmPlatformEnv & {
  SUPABASE_SERVICE_ROLE_KEY: string;
  CRM_PLATFORM_TOKEN: string;
} {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY || !env.CRM_PLATFORM_TOKEN) {
    throw new Error('CRM platform service environment is not configured');
  }
}

function authorizeInternalRequest(request: Request, env: CrmPlatformEnv) {
  assertServiceEnv(env);
  const authorization = request.headers.get('authorization') ?? '';
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  if (!token || token !== env.CRM_PLATFORM_TOKEN) {
    return json({ error: { code: 'UNAUTHORIZED', message: 'Invalid CRM platform service token' } }, 401);
  }
  return null;
}

async function rpc<T>(env: CrmPlatformEnv, name: string, body: Record<string, unknown>): Promise<T> {
  assertServiceEnv(env);
  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) as unknown : null;
  if (!response.ok) throw new Error(`CRM platform RPC ${name} failed: ${text}`);
  return payload as T;
}

function requireCommand(body: InternalCommand) {
  const installationId = body.installationId?.trim();
  const idempotencyKey = body.idempotencyKey?.trim();
  if (!installationId || !idempotencyKey) throw new Error('installationId and idempotencyKey are required');
  return { installationId, idempotencyKey };
}

async function provision(body: InternalCommand, env: CrmPlatformEnv) {
  const { installationId, idempotencyKey } = requireCommand(body);
  const companyId = (body.companyId ?? body.organizationId)?.trim();
  if (!companyId) throw new Error('companyId is required');
  if (body.moduleCode && body.moduleCode !== 'crm.kanban') throw new Error('Unsupported module code');

  return rpc<Record<string, unknown>>(env, 'provision_crm_kanban', {
    installation_id_value: installationId,
    company_id_value: companyId,
    host_product_code_value: body.hostProductCode ?? 'marketing',
    module_version_value: body.moduleVersion ?? '1.0.0',
    config_value: body.config ?? {},
    limits_value: body.limits ?? {},
    permissions_value: body.permissions ?? [],
    idempotency_key_value: idempotencyKey,
    trace_id_value: body.traceId ?? null,
  });
}

async function setState(body: InternalCommand, env: CrmPlatformEnv, targetStatus: 'active' | 'suspended' | 'archived') {
  const { installationId, idempotencyKey } = requireCommand(body);
  return rpc<Record<string, unknown>>(env, 'set_crm_kanban_state', {
    installation_id_value: installationId,
    target_status_value: targetStatus,
    idempotency_key_value: idempotencyKey,
    trace_id_value: body.traceId ?? null,
  });
}

export async function handleCrmPlatformInternalRequest(request: Request, env: CrmPlatformEnv) {
  const url = new URL(request.url);
  if (!url.pathname.startsWith('/internal/platform/')) return null;

  const denied = authorizeInternalRequest(request, env);
  if (denied) return denied;

  try {
    if (request.method === 'GET' && url.pathname === '/internal/platform/modules/health') {
      const installationId = url.searchParams.get('installationId')?.trim();
      if (!installationId) return json({ error: { code: 'VALIDATION_ERROR', message: 'installationId is required' } }, 400);
      return json(await rpc(env, 'crm_kanban_health', { installation_id_value: installationId }));
    }

    if (request.method !== 'POST') return json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' } }, 405);
    const body = await request.json() as InternalCommand;

    if (url.pathname === '/internal/platform/modules/provision') return json(await provision(body, env), 200);
    if (url.pathname === '/internal/platform/modules/repair') return json(await provision(body, env), 200);
    if (url.pathname === '/internal/platform/modules/upgrade') return json(await provision(body, env), 200);
    if (url.pathname === '/internal/platform/modules/suspend') return json(await setState(body, env, 'suspended'), 200);
    if (url.pathname === '/internal/platform/modules/resume') return json(await setState(body, env, 'active'), 200);
    if (url.pathname === '/internal/platform/modules/uninstall') return json(await setState(body, env, 'archived'), 200);

    return json({ error: { code: 'NOT_FOUND', message: 'Internal platform route not found' } }, 404);
  } catch (error) {
    return json({
      error: {
        code: 'CRM_PLATFORM_COMMAND_FAILED',
        message: error instanceof Error ? error.message : 'CRM platform command failed',
      },
    }, 500);
  }
}

export async function authorizeCrmPermission(
  env: CrmPlatformEnv,
  tenantId: string,
  permission: string,
): Promise<PlatformDecision> {
  if (!env.PLATFORM_API_URL || !env.PLATFORM_SERVICE_TOKEN) {
    return { allowed: false, installationId: null, reason: 'PLATFORM_NOT_CONFIGURED', effectiveLimits: {} };
  }
  const response = await fetch(`${env.PLATFORM_API_URL.replace(/\/$/, '')}/v1/platform/authorize`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.PLATFORM_SERVICE_TOKEN}`,
      'content-type': 'application/json',
      'x-tenant-id': tenantId,
    },
    body: JSON.stringify({
      tenantId,
      hostProductCode: 'marketing',
      moduleCode: 'crm.kanban',
      permission,
    }),
  });
  const payload = await response.json() as { data?: PlatformDecision; error?: { message?: string } };
  if (!response.ok || !payload.data) {
    return { allowed: false, installationId: null, reason: payload.error?.message ?? 'PLATFORM_AUTHORIZATION_FAILED', effectiveLimits: {} };
  }
  return payload.data;
}
