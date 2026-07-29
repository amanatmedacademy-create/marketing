import app from './index';
import { handleAnalytics } from './analytics';
import { authError, authenticateRequest, handleAuthRequest, isPublicApiPath } from './auth';
import { isFrontendAdmin } from './credentials';
import type { Env, WorkerExecutionContext, WorkerScheduledController } from './integrations';

type AuthEnv = Env & {
  SUPABASE_ANON_KEY?: string;
  AUTH_ALLOWED_EMAIL_DOMAINS?: string;
  AUTH_AUTO_APPROVE?: string;
};

export default {
  async fetch(request: Request, env: AuthEnv): Promise<Response> {
    const url = new URL(request.url);
    try {
      const authResponse = await handleAuthRequest(request, env, url);
      if (authResponse) return authResponse;

      if (url.pathname.startsWith('/api/') && !isPublicApiPath(url.pathname)) {
        const frontendAdminRequest = url.pathname.startsWith('/api/integrations/') && isFrontendAdmin(request, env);
        if (!frontendAdminRequest) {
          const user = await authenticateRequest(request, env);
          if (!user) return authError();
          if (user.status === 'blocked') return authError(403, 'Доступ пользователя заблокирован');
          if (user.status !== 'active') return authError(403, 'Аккаунт ожидает подтверждения администратора');
        }
      }

      const analytics = await handleAnalytics(request, env, url);
      if (analytics) return analytics;
    } catch (error) {
      console.error(error);
      return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Analytics error' }), {
        status: 500,
        headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
      });
    }
    return app.fetch(request, env);
  },

  async scheduled(controller: WorkerScheduledController, env: AuthEnv, ctx: WorkerExecutionContext): Promise<void> {
    await app.scheduled(controller, env, ctx);
  },
};