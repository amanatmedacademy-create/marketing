import app from './index';
import { handleAnalytics } from './analytics';
import { authError, authenticateRequest, handleAuthRequest, isPublicApiPath, type AuthEnv } from './auth';
import { isFrontendAdmin } from './credentials';
import type { WorkerExecutionContext, WorkerScheduledController } from './integrations';

const INTERNAL_ROLE_HEADER = 'x-amanat-auth-role';
const INTERNAL_USER_HEADER = 'x-amanat-auth-user';

function isIntegrationAdminPath(pathname: string): boolean {
  return pathname === '/api/integrations/sync'
    || pathname.startsWith('/api/integrations/config')
    || pathname.startsWith('/api/integrations/test/');
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
  async fetch(request: Request, env: AuthEnv): Promise<Response> {
    const url = new URL(request.url);
    let forwardedRequest = withTrustedIdentity(request);

    try {
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
          if (isIntegrationAdminPath(url.pathname) && user.role !== 'administrator') {
            return authError(403, 'Настройки интеграций доступны только администратору');
          }
          forwardedRequest = withTrustedIdentity(request, user.role, user.id);
        }
      }

      const analytics = await handleAnalytics(forwardedRequest, env, url);
      if (analytics) return analytics;
    } catch (error) {
      console.error(error);
      return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Analytics error' }), {
        status: 500,
        headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
      });
    }

    return app.fetch(forwardedRequest, env);
  },

  async scheduled(controller: WorkerScheduledController, env: AuthEnv, ctx: WorkerExecutionContext): Promise<void> {
    await app.scheduled(controller, env, ctx);
  },
};
