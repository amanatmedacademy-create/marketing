import app from './index';
import { handleAdManager } from './adManager';
import { handleAnalytics } from './analytics';
import { handleConversionMatrix } from './conversionMatrix';
import { authError, authenticateRequest, handleAuthRequest, isPublicApiPath, type AuthEnv } from './auth';
import { correlationId, handleAuditApi, planAudit, recordAudit, recordErrorEvent, requestClient, requestUserId } from './auditLog';
import { handleCallCenterChat } from './callCenterChat';
import { hydrateIntegrationEnv } from './credentials';
import { handleInboundSocialWebhook } from './inboundSocial';
import { handleMarketingChat } from './marketingChat';
import { handleMetaAdsetMetrics } from './metaAdsetMetrics';
import { handleMetaOAuthRequest, type MetaOAuthEnv } from './metaOAuth';
import { handleMetaOAuthStart, type MetaOAuthStartEnv } from './metaOAuthStart';
import { handleMetaReachSync } from './metaReachSync';
import { handleMetaSdkRequest, type MetaSdkEnv } from './metaSdk';
import { handleOperationsRequest } from './operations';
import { handleSalesFunnel } from './salesFunnel';
import { handleWabaEmbeddedSignupRequest, type WabaEmbeddedSignupEnv } from './wabaEmbeddedSignup';
import type { WorkerExecutionContext, WorkerScheduledController } from './integrations';

const INTERNAL_ROLE_HEADER = 'x-amanat-auth-role';
const INTERNAL_USER_HEADER = 'x-amanat-auth-user';

type MainEnv = AuthEnv & MetaOAuthEnv & MetaOAuthStartEnv & MetaSdkEnv & WabaEmbeddedSignupEnv;

function isIntegrationAdminPath(pathname: string): boolean {
  return pathname === '/api/integrations/sync'
    || pathname.startsWith('/api/integrations/config')
    || pathname.startsWith('/api/integrations/test/')
    || pathname === '/api/integrations/meta/start'
    || pathname === '/api/integrations/meta/connect'
    || pathname === '/api/integrations/meta/oauth-config'
    || pathname === '/api/integrations/meta/sdk-config'
    || pathname === '/api/integrations/meta/sdk-connect'
    || pathname === '/api/integrations/meta/reach-sync'
    || pathname === '/api/integrations/meta/adsets/sync'
    || pathname === '/api/integrations/waba/config'
    || pathname === '/api/integrations/waba/connect';
}

function requiresMarketingWriteAccess(method: string, pathname: string): boolean {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) return false;
  return pathname === '/api/leads'
    || pathname.startsWith('/api/leads/')
    || pathname === '/api/funnel/leads'
    || pathname.startsWith('/api/funnel/leads/');
}

function canWriteMarketingData(role: string): boolean {
  return role === 'administrator' || role === 'marketer';
}

function withTrustedIdentity(request: Request, role?: string, userId?: string): Request {
  const headers = new Headers(request.headers);
  headers.delete(INTERNAL_ROLE_HEADER);
  headers.delete(INTERNAL_USER_HEADER);
  if (role) headers.set(INTERNAL_ROLE_HEADER, role);
  if (userId) headers.set(INTERNAL_USER_HEADER, userId);
  return new Request(request, { headers });
}

function applySecurityHeaders(response: Response): Response {
  const decorated = new Response(response.body, response);
  decorated.headers.set('x-content-type-options', 'nosniff');
  decorated.headers.set('referrer-policy', 'strict-origin-when-cross-origin');
  decorated.headers.set('permissions-policy', 'camera=(), microphone=(), geolocation=()');
  decorated.headers.set('x-frame-options', 'DENY');
  decorated.headers.set('content-security-policy', "default-src 'self'; base-uri 'self'; frame-ancestors 'none'; object-src 'none'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self' https://*.supabase.co https://graph.facebook.com https://business.facebook.com; form-action 'self'");
  return decorated;
}

const AUDIT_BODY_LIMIT = 32 * 1024;

async function captureJsonBody(request: Request): Promise<Record<string, unknown> | null> {
  if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return null;
  if (!(request.headers.get('content-type') || '').includes('application/json')) return null;
  try {
    const text = await request.clone().text();
    if (!text || text.length > AUDIT_BODY_LIMIT) return null;
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function background(ctx: WorkerExecutionContext | undefined, task: Promise<unknown>): void {
  if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(task);
}

export default {
  async fetch(request: Request, env: MainEnv, ctx?: WorkerExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const requestCorrelationId = correlationId(request);
    let forwardedRequest = request;

    const route = async (): Promise<Response> => {
      if (url.pathname === '/api/integrations/meta/callback') {
        const callbackResponse = await handleMetaOAuthRequest(request, env, url);
        if (callbackResponse) return callbackResponse;
      }

      const authResponse = await handleAuthRequest(request, env, url);
      if (authResponse) return authResponse;

      if (url.pathname.startsWith('/api/') && !isPublicApiPath(url.pathname)) {
        const user = await authenticateRequest(request, env);
        if (!user) return authError();
        if (user.status === 'blocked') return authError(403, 'Доступ пользователя заблокирован');
        if (user.status !== 'active') return authError(403, 'Аккаунт ожидает подтверждения администратора');
        if (isIntegrationAdminPath(url.pathname) && user.role !== 'administrator') {
          return authError(403, 'Настройки интеграций доступны только администратору');
        }
        if (requiresMarketingWriteAccess(request.method, url.pathname) && !canWriteMarketingData(user.role)) {
          return authError(403, 'Недостаточно прав для изменения маркетинговых данных');
        }
        forwardedRequest = withTrustedIdentity(request, user.role, user.id);
      }

      if (forwardedRequest === request) forwardedRequest = withTrustedIdentity(request);
      const runtimeEnv = await hydrateIntegrationEnv(env);

      const inboundSocial = await handleInboundSocialWebhook(forwardedRequest, runtimeEnv, url);
      if (inboundSocial) return inboundSocial;
      const auditApi = await handleAuditApi(forwardedRequest, runtimeEnv, url);
      if (auditApi) return auditApi;
      const chatResponse = await handleMarketingChat(forwardedRequest, runtimeEnv, url);
      if (chatResponse) return chatResponse;
      const wabaResponse = await handleWabaEmbeddedSignupRequest(forwardedRequest, runtimeEnv, url);
      if (wabaResponse) return wabaResponse;
      const metaSdkResponse = await handleMetaSdkRequest(forwardedRequest, runtimeEnv, url);
      if (metaSdkResponse) return metaSdkResponse;
      const metaOAuthStartResponse = handleMetaOAuthStart(forwardedRequest, runtimeEnv, url);
      if (metaOAuthStartResponse) return metaOAuthStartResponse;
      const metaOAuthResponse = await handleMetaOAuthRequest(forwardedRequest, runtimeEnv, url);
      if (metaOAuthResponse) return metaOAuthResponse;
      const metaReach = await handleMetaReachSync(forwardedRequest, runtimeEnv, url);
      if (metaReach) return metaReach;
      const metaAdsets = await handleMetaAdsetMetrics(forwardedRequest, runtimeEnv, url);
      if (metaAdsets) return metaAdsets;
      const adManager = await handleAdManager(forwardedRequest, runtimeEnv, url);
      if (adManager) return adManager;
      const salesFunnel = await handleSalesFunnel(forwardedRequest, runtimeEnv, url);
      if (salesFunnel) return salesFunnel;
      const callCenter = await handleCallCenterChat(forwardedRequest, runtimeEnv, url);
      if (callCenter) return callCenter;
      const conversionMatrix = await handleConversionMatrix(forwardedRequest, runtimeEnv, url);
      if (conversionMatrix) return conversionMatrix;
      const analytics = await handleAnalytics(forwardedRequest, runtimeEnv, url);
      if (analytics) return analytics;
      const operations = await handleOperationsRequest(forwardedRequest, runtimeEnv, url);
      if (operations) return operations;

      return app.fetch(forwardedRequest, runtimeEnv);
    };

    try {
      const auditBody = url.pathname.startsWith('/api/') ? await captureJsonBody(request) : null;
      const plan = url.pathname.startsWith('/api/') ? planAudit(request.method, url.pathname.replace(/\/+$/, '') || '/', auditBody) : null;

      const response = await route();

      if (plan && response.status < 400) {
        const { ip, userAgent } = requestClient(request);
        background(ctx, recordAudit(env, {
          userId: requestUserId(forwardedRequest),
          action: plan.action,
          entityType: plan.entityType,
          entityId: plan.entityId,
          after: plan.captureBody ? auditBody : null,
          ip,
          userAgent,
          correlationId: requestCorrelationId
        }));
      }

      if (url.pathname.startsWith('/api/') && response.status >= 500) {
        const detail = await response.clone().text().catch(() => '');
        background(ctx, recordErrorEvent(env, {
          source: url.pathname.split('/').filter(Boolean)[1] || 'worker',
          endpoint: `${request.method} ${url.pathname}`,
          code: String(response.status),
          message: detail.slice(0, 600) || `HTTP ${response.status}`,
          correlationId: requestCorrelationId
        }));
      }

      const decorated = applySecurityHeaders(response);
      decorated.headers.set('x-correlation-id', requestCorrelationId);
      return decorated;
    } catch (error) {
      console.error(error);
      const message = error instanceof Error ? error.message : 'Internal server error';
      if (url.pathname.startsWith('/api/')) {
        background(ctx, recordErrorEvent(env, {
          source: url.pathname.split('/').filter(Boolean)[1] || 'worker',
          endpoint: `${request.method} ${url.pathname}`,
          code: '500',
          message,
          correlationId: requestCorrelationId
        }));
      }
      return applySecurityHeaders(new Response(JSON.stringify({ error: 'Внутренняя ошибка сервиса', correlationId: requestCorrelationId }), {
        status: 500,
        headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-correlation-id': requestCorrelationId },
      }));
    }
  },

  async scheduled(controller: WorkerScheduledController, env: MainEnv, ctx: WorkerExecutionContext): Promise<void> {
    await app.scheduled(controller, env, ctx);
  },
};
