import app from './index';
import { handleAuthRequest, requireSession, type AuthEnv, type AuthSession } from './auth';
import { requireBearerSession } from './bearer-auth';
import { handleBulkOperationsRequest } from './bulk-operations';
import { handleCrmPlatformInternalRequest, authorizeCrmPermission, type CrmPlatformEnv } from './crm-kanban-platform';
import { handleDealDetails } from './deal-details';
import { handleGoogleAuthRequest } from './google-auth';
import { handleMarketingAnalyticsRequest } from './marketing-analytics';
import { handleMetaAdsRequest } from './meta-ads';
import { getMetaPublicConfig, handleMetaRequest, type MetaEnv } from './meta-auth';
import { handlePlatformCoreRequest } from './platform-core';
import { handleTeamRequest } from './team';
import { handleWorkManagementRequest } from './work-management';

interface Env extends AuthEnv, MetaEnv, CrmPlatformEnv {
  ASSETS: Fetcher;
  APP_ENV: string;
}

const RELEASE = 'bulk-operations-v1';

const apiError = (status: number, code: string, message: string, details?: unknown) => new Response(JSON.stringify({ error: { code, message, details } }), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-imds-release': RELEASE },
});

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-imds-release': RELEASE },
});

const isMutation = (method: string) => !['GET', 'HEAD', 'OPTIONS'].includes(method);

function hasAllowedOrigin(request: Request) {
  if (!isMutation(request.method)) return true;
  const origin = request.headers.get('origin');
  return Boolean(origin && origin === new URL(request.url).origin);
}

function canWrite(session: AuthSession, pathname: string) {
  if (session.role === 'owner' || session.role === 'admin' || session.role === 'administrator') return true;
  if (session.role !== 'manager') return false;
  return pathname === '/api/deals'
    || /^\/api\/deals\/[^/]+$/.test(pathname)
    || /^\/api\/deals\/[^/]+\/move$/.test(pathname)
    || pathname === '/api/tasks'
    || /^\/api\/tasks\/[^/]+$/.test(pathname)
    || pathname === '/api/projects'
    || pathname === '/api/bulk-operations/execute';
}

function requiredCrmPermission(request: Request, pathname: string): string | null {
  if (request.method === 'GET' && pathname === '/api/pipelines') return 'crm.pipelines.read';
  if (request.method === 'GET' && pathname === '/api/deals') return 'crm.deals.read';
  if (request.method === 'POST' && pathname === '/api/deals') return 'crm.deals.create';
  if (request.method === 'PATCH' && /^\/api\/deals\/[^/]+\/move$/.test(pathname)) return 'crm.deals.move';
  if (request.method === 'PATCH' && /^\/api\/deals\/[^/]+$/.test(pathname)) return 'crm.deals.update';
  if (request.method === 'GET' && /^\/api\/deals\/[^/]+$/.test(pathname)) return 'crm.deals.read';
  return null;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    const internalResponse = await handleCrmPlatformInternalRequest(request, env);
    if (internalResponse) return internalResponse;

    if (url.pathname === '/health') {
      return json({ status: 'ok', service: 'imds-marketing-edge', environment: env.APP_ENV, release: RELEASE, auth: 'supabase-bearer', timestamp: new Date().toISOString() });
    }

    if (request.method === 'GET' && url.pathname === '/api/config') {
      return json({
        environment: env.APP_ENV,
        release: RELEASE,
        auth: 'supabase-bearer',
        supabaseConfigured: Boolean(env.SUPABASE_URL),
        platformConfigured: Boolean(env.PLATFORM_API_URL && env.PLATFORM_SERVICE_TOKEN),
      });
    }

    if (request.method === 'GET' && url.pathname === '/api/integrations/meta/config') {
      return getMetaPublicConfig(env);
    }

    if (url.pathname.startsWith('/api/auth/google/')) {
      if (!hasAllowedOrigin(request)) return apiError(403, 'INVALID_ORIGIN', 'Недопустимый источник запроса');
      const googleResponse = await handleGoogleAuthRequest(request, env);
      if (googleResponse) return googleResponse;
    }

    if (url.pathname.startsWith('/api/auth/')) {
      if (!hasAllowedOrigin(request)) return apiError(403, 'INVALID_ORIGIN', 'Недопустимый источник запроса');
      const authResponse = await handleAuthRequest(request, env);
      if (authResponse) return authResponse;
    }

    if (url.pathname.startsWith('/api/')) {
      const session = await requireBearerSession(request, env) ?? await requireSession(request, env);
      if (!session) return apiError(401, 'UNAUTHORIZED', 'Не авторизован');
      if (!hasAllowedOrigin(request)) return apiError(403, 'INVALID_ORIGIN', 'Недопустимый источник запроса');
      if (isMutation(request.method) && !canWrite(session, url.pathname)) return apiError(403, 'FORBIDDEN', 'Недостаточно прав для выполнения операции');

      const permission = requiredCrmPermission(request, url.pathname);
      if (permission) {
        const decision = await authorizeCrmPermission(env, session.companyId, permission);
        if (!decision.allowed) {
          const status = decision.reason === 'MODULE_READ_ONLY' ? 409 : 403;
          return apiError(status, decision.reason, 'Операция CRM Kanban запрещена платформой', {
            installationId: decision.installationId,
            permission,
            limits: decision.effectiveLimits,
          });
        }
      }

      const tenantEnv: Env = { ...env, DEFAULT_COMPANY_ID: session.companyId };
      const specializedResponse = await handlePlatformCoreRequest(request, tenantEnv, session)
        ?? await handleBulkOperationsRequest(request, tenantEnv, session)
        ?? await handleWorkManagementRequest(request, tenantEnv, session)
        ?? await handleMarketingAnalyticsRequest(request, tenantEnv, session)
        ?? await handleMetaAdsRequest(request, tenantEnv, session)
        ?? await handleMetaRequest(request, tenantEnv, session)
        ?? await handleDealDetails(request, tenantEnv)
        ?? await handleTeamRequest(request, tenantEnv);
      const response = specializedResponse ?? await app.fetch(request, tenantEnv);
      const decorated = new Response(response.body, response);
      decorated.headers.set('x-imds-release', RELEASE);
      return decorated;
    }

    const response = await app.fetch(request, env);
    const decorated = new Response(response.body, response);
    decorated.headers.set('x-imds-release', RELEASE);
    return decorated;
  },
} satisfies ExportedHandler<Env>;
