import app from './index';
import { handleAdManager } from './adManager';
import { handleAnalytics } from './analytics';
import { handleConversionMatrix } from './conversionMatrix';
import { authError, authenticateRequest, handleAuthRequest, isPublicApiPath, type AuthEnv } from './auth';
import { isFrontendAdmin } from './credentials';
import { handleMarketingChat } from './marketingChat';
import { handleMetaAdsetMetrics } from './metaAdsetMetrics';
import { handleMetaOAuthRequest, type MetaOAuthEnv } from './metaOAuth';
import { handleMetaOAuthStart, type MetaOAuthStartEnv } from './metaOAuthStart';
import { handleMetaSdkRequest, type MetaSdkEnv } from './metaSdk';
import { handleOperationsRequest } from './operations';
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
    || pathname === '/api/integrations/meta/adsets/sync'
    || pathname === '/api/integrations/waba/config'
    || pathname === '/api/integrations/waba/connect';
}

function withTrustedIdentity(request: Request, role?: string, userId?: string): Request {
  const headers = new Headers(request.headers);
  headers.delete(INTERNAL_ROLE_HEADER);
  headers.delete(INTERNAL_USER_HEADER);
  if (role) headers.set(INTERNAL_ROLE_HEADER, role);
  if (userId) headers.set(INTERNAL_USER_HEADER, userId);
  return new Request(request, { headers });
}

export default {
  async fetch(request: Request, env: MainEnv): Promise<Response> {
    const url = new URL(request.url);
    let forwardedRequest = request;

    try {
      if (url.pathname === '/api/integrations/meta/callback') {
        const callbackResponse = await handleMetaOAuthRequest(request, env, url);
        if (callbackResponse) return callbackResponse;
      }

      const authResponse = await handleAuthRequest(request, env, url);
      if (authResponse) return authResponse;

      if (url.pathname.startsWith('/api/') && !isPublicApiPath(url.pathname)) {
        const legacyAdmin = isIntegrationAdminPath(url.pathname) && isFrontendAdmin(request, env);
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

      const chatResponse = await handleMarketingChat(forwardedRequest, env, url);
      if (chatResponse) return chatResponse;
      const wabaResponse = await handleWabaEmbeddedSignupRequest(forwardedRequest, env, url);
      if (wabaResponse) return wabaResponse;
      const metaSdkResponse = await handleMetaSdkRequest(forwardedRequest, env, url);
      if (metaSdkResponse) return metaSdkResponse;
      const metaOAuthStartResponse = handleMetaOAuthStart(forwardedRequest, env, url);
      if (metaOAuthStartResponse) return metaOAuthStartResponse;
      const metaOAuthResponse = await handleMetaOAuthRequest(forwardedRequest, env, url);
      if (metaOAuthResponse) return metaOAuthResponse;
      const metaAdsets = await handleMetaAdsetMetrics(forwardedRequest, env, url);
      if (metaAdsets) return metaAdsets;
      const adManager = await handleAdManager(forwardedRequest, env, url);
      if (adManager) return adManager;
      const conversionMatrix = await handleConversionMatrix(forwardedRequest, env, url);
      if (conversionMatrix) return conversionMatrix;
      const analytics = await handleAnalytics(forwardedRequest, env, url);
      if (analytics) return analytics;
      const operations = await handleOperationsRequest(forwardedRequest, env, url);
      if (operations) return operations;
    } catch (error) {
      console.error(error);
      return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Analytics error' }), {
        status: 500,
        headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
      });
    }

    return app.fetch(forwardedRequest, env);
  },

  async scheduled(controller: WorkerScheduledController, env: MainEnv, ctx: WorkerExecutionContext): Promise<void> {
    await app.scheduled(controller, env, ctx);
  },
};