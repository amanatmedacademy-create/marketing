import app from './index';
import { handleAuthRequest, requireSession, type AuthEnv, type AuthSession } from './auth';

interface Env extends AuthEnv {
  ASSETS: Fetcher;
  APP_ENV: string;
}

const apiError = (status: number, code: string, message: string) => new Response(JSON.stringify({
  error: { code, message },
}), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  },
});

const isMutation = (method: string) => !['GET', 'HEAD', 'OPTIONS'].includes(method);

function hasAllowedOrigin(request: Request) {
  if (!isMutation(request.method)) return true;
  const origin = request.headers.get('origin');
  if (!origin) return false;
  return origin === new URL(request.url).origin;
}

function canWrite(session: AuthSession, pathname: string) {
  if (session.role === 'owner' || session.role === 'admin') return true;
  if (session.role !== 'manager') return false;
  return pathname === '/api/deals' || /^\/api\/deals\/[^/]+\/move$/.test(pathname);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname.startsWith('/api/auth/')) {
      if (!hasAllowedOrigin(request)) return apiError(403, 'INVALID_ORIGIN', 'Недопустимый источник запроса');
      const authResponse = await handleAuthRequest(request, env);
      if (authResponse) return authResponse;
    }

    if (url.pathname.startsWith('/api/') && url.pathname !== '/api/config') {
      const session = await requireSession(request, env);
      if (!session) return apiError(401, 'UNAUTHORIZED', 'Не авторизован');
      if (!hasAllowedOrigin(request)) return apiError(403, 'INVALID_ORIGIN', 'Недопустимый источник запроса');
      if (isMutation(request.method) && !canWrite(session, url.pathname)) {
        return apiError(403, 'FORBIDDEN', 'Недостаточно прав для выполнения операции');
      }

      const tenantEnv: Env = { ...env, DEFAULT_COMPANY_ID: session.companyId };
      return app.fetch(request, tenantEnv);
    }

    return app.fetch(request, env);
  },
} satisfies ExportedHandler<Env>;
