import app from './index';
import { handleAdManager } from './adManager';
import { handleAdPreview, type AdPreviewEnv } from './adPreview';
import { handleAnalytics } from './analytics';
import { handleConversionMatrix } from './conversionMatrix';
import { authError, authenticateRequest, handleAuthRequest, isPublicApiPath, type AuthEnv } from './auth';
import { correlationId, handleAuditApi, planAudit, recordAudit, recordErrorEvent, requestClient, requestUserId } from './auditLog';
import { handleCallCenterChat } from './callCenterChat';
import { hydrateIntegrationEnv } from './credentials';
import { handleDealWorkspace } from './dealWorkspace';
import { handleMarketingChat } from './marketingChat';
import { handleMetaAdsetMetrics } from './metaAdsetMetrics';
import { handleMetaBackfillRequest, type MetaBackfillEnv } from './metaBackfill';
import { handleMetaCatalogRequest, type MetaCatalogEnv } from './metaCatalog';
import { handleMetaOAuthRequest, type MetaOAuthEnv } from './metaOAuth';
import { handleMetaOAuthStart, type MetaOAuthStartEnv } from './metaOAuthStart';
import { handleMetaReachSync } from './metaReachSync';
import { handleMetaSdkRequest, type MetaSdkEnv } from './metaSdk';
import { handleMetaSelectionRequest, type MetaSelectionEnv } from './metaSelection';
import { handleOperationsRequest } from './operations';
import { handleSalesFunnel } from './salesFunnel';
import { handleTenantSyncRequest, runTenantScheduledSync, type TenantSyncEnv } from './tenantSync';
import { handleTenantWebhookRequest, type TenantWebhookEnv } from './tenantWebhooks';
import { handleVoiceTranscriptionRequest, type VoiceTranscriptionEnv } from './voiceTranscription';
import { handleWabaClinicFlowOutreachRequest, type WabaClinicFlowOutreachEnv } from './wabaClinicFlowOutreach';
import { handleWabaEmbeddedSignupRequest, type WabaEmbeddedSignupEnv } from './wabaEmbeddedSignup';
import { handleWabaFlowsRequest, type WabaFlowsEnv } from './wabaFlows';
import { handleWabaMessagingRequest, type WabaMessagingEnv } from './wabaMessaging';
import { handleWabaMessagingV2Request, type WabaMessagingV2Env } from './wabaMessagingV2';
import type { WorkerExecutionContext, WorkerScheduledController } from './integrations';

const INTERNAL_ROLE_HEADER = 'x-amanat-auth-role';
const INTERNAL_USER_HEADER = 'x-amanat-auth-user';

type MainEnv = AuthEnv
  & AdPreviewEnv
  & MetaOAuthEnv
  & MetaOAuthStartEnv
  & MetaSdkEnv
  & MetaCatalogEnv
  & MetaBackfillEnv
  & MetaSelectionEnv
  & TenantSyncEnv
  & TenantWebhookEnv
  & WabaEmbeddedSignupEnv
  & WabaFlowsEnv
  & WabaClinicFlowOutreachEnv
  & WabaMessagingEnv
  & WabaMessagingV2Env
  & VoiceTranscriptionEnv
  & { FRONTEND_ADMIN_KEY?: string };

function isIntegrationAdminPath(pathname: string): boolean {
  return pathname === '/api/integrations/sync'
    || pathname.startsWith('/api/integrations/config')
    || pathname.startsWith('/api/integrations/test/')
    || pathname === '/api/integrations/meta/start'
    || pathname === '/api/integrations/meta/connect'
    || pathname === '/api/integrations/meta/oauth-config'
    || pathname === '/api/integrations/meta/sdk-config'
    || pathname === '/api/integrations/meta/sdk-connect'
    || pathname === '/api/integrations/meta/catalog'
    || pathname === '/api/integrations/meta/selection'
    || pathname === '/api/integrations/meta/backfill'
    || pathname === '/api/integrations/meta/reach-sync'
    || pathname === '/api/integrations/meta/adsets/sync'
    || pathname === '/api/integrations/meta/conversions'
    || pathname === '/api/integrations/waba/config'
    || pathname === '/api/integrations/waba/connect'
    || pathname === '/api/integrations/waba/flows/config'
    || pathname === '/api/integrations/waba/flows/setup'
    || pathname.startsWith('/api/integrations/waba/flows/clinic/');
}

function secureEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let result = 0;
  for (let index = 0; index < left.length; index += 1) result |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return result === 0;
}

function bearer(request: Request): string {
  const value = request.headers.get('authorization') || '';
  return value.toLowerCase().startsWith('bearer ') ? value.slice(7).trim() : '';
}

function hasLegacyAdminKey(request: Request, env: MainEnv): boolean {
  const supplied = bearer(request) || request.headers.get('x-admin-key') || '';
  return Boolean(env.FRONTEND_ADMIN_KEY && supplied && secureEqual(supplied, env.FRONTEND_ADMIN_KEY));
}

function withTrustedIdentity(request: Request, role?: string, userId?: string): Request {
  const headers = new Headers(request.headers);
  headers.delete(INTERNAL_ROLE_HEADER);
  headers.delete(INTERNAL_USER_HEADER);
  if (role) headers.set(INTERNAL_ROLE_HEADER, role);
  if (userId) headers.set(INTERNAL_USER_HEADER, userId);
  return new Request(request, { headers });
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
        const callbackResponse = await handleMetaOAuthRequest(request, env, url, ctx);
        if (callbackResponse) return callbackResponse;
      }

      const authResponse = await handleAuthRequest(request, env, url);
      if (authResponse) return authResponse;

      if (url.pathname.startsWith('/api/') && !isPublicApiPath(url.pathname)) {
        const legacyAdmin = isIntegrationAdminPath(url.pathname) && hasLegacyAdminKey(request, env);
        if (legacyAdmin) {
          forwardedRequest = withTrustedIdentity(request, 'administrator', 'legacy-admin-key');
        } else {
          const user = await authenticateRequest(request, env);
          if (!user) return authError();
          if (user.status === 'blocked') return authError(403, 'Доступ пользователя заблокирован');
          if (user.status !== 'active') return authError(403, 'Аккаунт ожидает подтверждения администратора');
          if (isIntegrationAdminPath(url.pathname) && user.role !== 'administrator') return authError(403, 'Настройки интеграций доступны только администратору');
          forwardedRequest = withTrustedIdentity(request, user.role, user.id);
        }
      }

      if (forwardedRequest === request) forwardedRequest = withTrustedIdentity(request);
      const runtimeEnv = await hydrateIntegrationEnv(env);

      const clinicFlowOutreach = await handleWabaClinicFlowOutreachRequest(forwardedRequest, runtimeEnv, url);
      if (clinicFlowOutreach) return clinicFlowOutreach;
      const wabaFlows = await handleWabaFlowsRequest(forwardedRequest, runtimeEnv, url);
      if (wabaFlows) return wabaFlows;
      const wabaMessagingV2 = await handleWabaMessagingV2Request(forwardedRequest, runtimeEnv, url);
      if (wabaMessagingV2) return wabaMessagingV2;
      const wabaMessaging = await handleWabaMessagingRequest(forwardedRequest, runtimeEnv, url);
      if (wabaMessaging) return wabaMessaging;
      const tenantWebhook = await handleTenantWebhookRequest(forwardedRequest, runtimeEnv, url);
      if (tenantWebhook) return tenantWebhook;
      const auditApi = await handleAuditApi(forwardedRequest, runtimeEnv, url);
      if (auditApi) return auditApi;
      const tenantSync = await handleTenantSyncRequest(forwardedRequest, runtimeEnv, url);
      if (tenantSync) return tenantSync;
      const chatResponse = await handleMarketingChat(forwardedRequest, runtimeEnv, url);
      if (chatResponse) return chatResponse;
      const wabaResponse = await handleWabaEmbeddedSignupRequest(forwardedRequest, runtimeEnv, url);
      if (wabaResponse) return wabaResponse;
      const metaSdkResponse = await handleMetaSdkRequest(forwardedRequest, runtimeEnv, url);
      if (metaSdkResponse) return metaSdkResponse;
      const metaOAuthStartResponse = handleMetaOAuthStart(forwardedRequest, runtimeEnv, url);
      if (metaOAuthStartResponse) return metaOAuthStartResponse;
      const metaOAuthResponse = await handleMetaOAuthRequest(forwardedRequest, runtimeEnv, url, ctx);
      if (metaOAuthResponse) return metaOAuthResponse;
      const metaSelectionResponse = await handleMetaSelectionRequest(forwardedRequest, runtimeEnv, url);
      if (metaSelectionResponse) return metaSelectionResponse;
      const metaCatalogResponse = await handleMetaCatalogRequest(forwardedRequest, runtimeEnv, url);
      if (metaCatalogResponse) return metaCatalogResponse;
      const metaBackfillResponse = await handleMetaBackfillRequest(forwardedRequest, runtimeEnv, url);
      if (metaBackfillResponse) return metaBackfillResponse;
      const metaReach = await handleMetaReachSync(forwardedRequest, runtimeEnv, url);
      if (metaReach) return metaReach;
      const metaAdsets = await handleMetaAdsetMetrics(forwardedRequest, runtimeEnv, url);
      if (metaAdsets) return metaAdsets;
      const adPreview = await handleAdPreview(forwardedRequest, runtimeEnv, url);
      if (adPreview) return adPreview;
      const adManager = await handleAdManager(forwardedRequest, runtimeEnv, url);
      if (adManager) return adManager;
      const dealWorkspace = await handleDealWorkspace(forwardedRequest, runtimeEnv, url);
      if (dealWorkspace) return dealWorkspace;
      const salesFunnel = await handleSalesFunnel(forwardedRequest, runtimeEnv, url);
      if (salesFunnel) return salesFunnel;
      const voiceTranscription = await handleVoiceTranscriptionRequest(forwardedRequest, runtimeEnv, url);
      if (voiceTranscription) return voiceTranscription;
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
        background(ctx, recordAudit(env, { userId: requestUserId(forwardedRequest), action: plan.action, entityType: plan.entityType, entityId: plan.entityId, after: plan.captureBody ? auditBody : null, ip, userAgent, correlationId: requestCorrelationId }));
      }

      if (url.pathname.startsWith('/api/') && response.status >= 500) {
        const detail = await response.clone().text().catch(() => '');
        background(ctx, recordErrorEvent(env, { source: url.pathname.split('/').filter(Boolean)[1] || 'worker', endpoint: `${request.method} ${url.pathname}`, code: String(response.status), message: detail.slice(0, 600) || `HTTP ${response.status}`, correlationId: requestCorrelationId }));
      }

      const decorated = new Response(response.body, response);
      decorated.headers.set('x-correlation-id', requestCorrelationId);
      return decorated;
    } catch (error) {
      console.error(error);
      const message = error instanceof Error ? error.message : 'Analytics error';
      if (url.pathname.startsWith('/api/')) {
        background(ctx, recordErrorEvent(env, { source: url.pathname.split('/').filter(Boolean)[1] || 'worker', endpoint: `${request.method} ${url.pathname}`, code: '500', message, correlationId: requestCorrelationId }));
      }
      return new Response(JSON.stringify({ error: message }), { status: 500, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-correlation-id': requestCorrelationId } });
    }
  },

  async scheduled(controller: WorkerScheduledController, env: MainEnv, ctx: WorkerExecutionContext): Promise<void> {
    const runtimeEnv = await hydrateIntegrationEnv(env);
    ctx.waitUntil(
      runTenantScheduledSync(controller, runtimeEnv)
        .then((results) => console.log('Scheduled tenant sync completed', results))
        .catch((error) => console.error('Scheduled tenant sync failed', error)),
    );
  },
};