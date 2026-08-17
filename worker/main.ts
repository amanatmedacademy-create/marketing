import app from './index';
import { handleAdManager } from './adManager';
import { handleAdPreview, type AdPreviewEnv } from './adPreview';
import { handleAnalytics } from './analytics';
import { correlationId, handleAuditApi, planAudit, recordAudit, recordErrorEvent, requestClient, requestUserId } from './auditLog';
import { authError, authenticateRequest, handleAuthRequest, isPublicApiPath, type AuthEnv } from './auth';
import { handleCallCenterChat } from './callCenterChat';
import { handleCallTranscription, type CallTranscriptionEnv } from './callTranscription';
import { handleClinicSchedule } from './clinicSchedule';
import { resolveCompanyId } from './companyContext';
import { handleConversionMatrix } from './conversionMatrix';
import { hydrateIntegrationEnv } from './credentials';
import { handleDealWorkspace } from './dealWorkspace';
import { handleLeadCaptureRequest, type LeadCaptureEnv } from './leadCapture';
import { handleMarketingChat } from './marketingChat';
import { handleMetaAdsetMetrics } from './metaAdsetMetrics';
import { handleMetaBackfillRequest, type MetaBackfillEnv } from './metaBackfill';
import { handleMetaCatalogRequest, type MetaCatalogEnv } from './metaCatalog';
import { handleMetaOAuthRequest, type MetaOAuthEnv } from './metaOAuth';
import { handleMetaOAuthStart, type MetaOAuthStartEnv } from './metaOAuthStart';
import { handleMetaReachSync } from './metaReachSync';
import { handleMetaSdkRequest, type MetaSdkEnv } from './metaSdk';
import { handleMetaSelectionRequest, type MetaSelectionEnv } from './metaSelection';
import { guardMetaSignedWebhook } from './metaWebhookGuard';
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
import { handleZadarmaTelephony, type ZadarmaTelephonyEnv } from './zadarmaTelephony';
import { handleZadarmaWebhook } from './zadarmaWebhook';
import type { WorkerExecutionContext, WorkerScheduledController } from './integrations';

const INTERNAL_ROLE_HEADER = 'x-amanat-auth-role';
const INTERNAL_USER_HEADER = 'x-amanat-auth-user';
const INTERNAL_VERIFIED_HEADER = 'x-amanat-auth-verified';
const COMPANY_HEADER = 'x-imds-company-id';

type MainEnv = AuthEnv
  & AdPreviewEnv
  & LeadCaptureEnv
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
  & ZadarmaTelephonyEnv
  & CallTranscriptionEnv
  & { CURRENT_COMPANY_ID?: string };

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

function isAdminRole(role: string): boolean {
  return role === 'administrator' || role === 'super_admin';
}

function effectiveUserRole(user: { role: string; platformRole?: string }): string {
  return user.platformRole === 'super_admin' ? 'super_admin' : user.role;
}

function verifiedIdentity(request: Request): { role: string; userId: string } | null {
  if (request.headers.get(INTERNAL_VERIFIED_HEADER) !== '1') return null;
  const role = (request.headers.get(INTERNAL_ROLE_HEADER) || '').trim();
  const userId = (request.headers.get(INTERNAL_USER_HEADER) || '').trim();
  return role && userId ? { role, userId } : null;
}

function withTrustedIdentity(request: Request, role?: string, userId?: string): Request {
  const headers = new Headers(request.headers);
  headers.delete(INTERNAL_ROLE_HEADER);
  headers.delete(INTERNAL_USER_HEADER);
  headers.delete(INTERNAL_VERIFIED_HEADER);
  headers.delete('x-admin-key');
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
    const forwardingSource = request.clone() as Request;
    let forwardedRequest = request;
    let requestEnv: MainEnv = env;

    const route = async (): Promise<Response> => {
      // Health must never depend on tenant context, telephony or integration credentials.
      if (url.pathname === '/api/health') return app.fetch(withTrustedIdentity(forwardingSource), env);

      const zadarmaWebhook = await handleZadarmaWebhook(request, env, url);
      if (zadarmaWebhook) return zadarmaWebhook;

      if (url.pathname === '/api/integrations/meta/callback') {
        const callbackResponse = await handleMetaOAuthRequest(request, env, url, ctx);
        if (callbackResponse) return callbackResponse;
      }

      const authResponse = await handleAuthRequest(request, env, url);
      if (authResponse) return authResponse;

      if (url.pathname.startsWith('/api/') && !isPublicApiPath(url.pathname)) {
        const verified = verifiedIdentity(request);
        if (verified) {
          if (isIntegrationAdminPath(url.pathname) && !isAdminRole(verified.role)) {
            return authError(403, 'Настройки интеграций доступны только супер-администратору');
          }
          const requestedCompany = (request.headers.get(COMPANY_HEADER) || '').trim();
          try {
            const companyId = await resolveCompanyId(requestedCompany ? { ...env, CURRENT_COMPANY_ID: requestedCompany } : env, verified.userId);
            requestEnv = { ...env, CURRENT_COMPANY_ID: companyId };
          } catch (error) {
            return authError(409, error instanceof Error ? error.message : 'Выберите клинику для продолжения');
          }
          forwardedRequest = withTrustedIdentity(forwardingSource, verified.role, verified.userId);
        } else {
          const user = await authenticateRequest(request, env);
          if (!user) return authError();
          if (user.status === 'blocked') return authError(403, 'Доступ пользователя заблокирован');
          if (user.status !== 'active') return authError(403, 'Аккаунт ожидает подтверждения администратора');
          const role = effectiveUserRole(user);
          if (isIntegrationAdminPath(url.pathname) && !isAdminRole(role)) {
            return authError(403, 'Настройки интеграций доступны только супер-администратору');
          }
          const requestedCompany = (request.headers.get(COMPANY_HEADER) || '').trim();
          try {
            const companyId = await resolveCompanyId(requestedCompany ? { ...env, CURRENT_COMPANY_ID: requestedCompany } : env, user.id);
            requestEnv = { ...env, CURRENT_COMPANY_ID: companyId };
          } catch (error) {
            return authError(409, error instanceof Error ? error.message : 'Выберите клинику для продолжения');
          }
          forwardedRequest = withTrustedIdentity(forwardingSource, role, user.id);
        }
      }

      if (forwardedRequest === request) forwardedRequest = withTrustedIdentity(forwardingSource);
      const runtimeEnv = await hydrateIntegrationEnv(requestEnv);
      const webhookGuard = await guardMetaSignedWebhook(forwardedRequest, runtimeEnv, url.pathname);
      if (webhookGuard) return webhookGuard;

      const clinicSchedule = await handleClinicSchedule(forwardedRequest, runtimeEnv, url);
      if (clinicSchedule) return clinicSchedule;
      const callTranscription = await handleCallTranscription(forwardedRequest, runtimeEnv, url);
      if (callTranscription) return callTranscription;
      const telephonyResponse = await handleZadarmaTelephony(forwardedRequest, runtimeEnv, url);
      if (telephonyResponse) return telephonyResponse;
      const leadCapture = await handleLeadCaptureRequest(forwardedRequest, runtimeEnv, url);
      if (leadCapture) return leadCapture;
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
      const metaSelectionResponse = await handleMetaSelectionRequest(forwardedRequest, runtimeEnv, url);
      if (metaSelectionResponse) return metaSelectionResponse;
      const metaOAuthResponse = await handleMetaOAuthRequest(forwardedRequest, runtimeEnv, url, ctx);
      if (metaOAuthResponse) return metaOAuthResponse;
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
        background(ctx, recordAudit(requestEnv, { userId: requestUserId(forwardedRequest), action: plan.action, entityType: plan.entityType, entityId: plan.entityId, after: plan.captureBody ? auditBody : null, ip, userAgent, correlationId: requestCorrelationId }));
      }

      if (url.pathname.startsWith('/api/') && response.status >= 500) {
        const detail = await response.clone().text().catch(() => '');
        background(ctx, recordErrorEvent(requestEnv, { source: url.pathname.split('/').filter(Boolean)[1] || 'worker', endpoint: `${request.method} ${url.pathname}`, code: String(response.status), message: detail.slice(0, 600) || `HTTP ${response.status}`, correlationId: requestCorrelationId }));
      }

      const decorated = new Response(response.body, response);
      decorated.headers.set('x-correlation-id', requestCorrelationId);
      return decorated;
    } catch (error) {
      console.error(error);
      const message = error instanceof Error ? error.message : 'Analytics error';
      if (url.pathname.startsWith('/api/')) {
        background(ctx, recordErrorEvent(requestEnv, { source: url.pathname.split('/').filter(Boolean)[1] || 'worker', endpoint: `${request.method} ${url.pathname}`, code: '500', message, correlationId: requestCorrelationId }));
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
