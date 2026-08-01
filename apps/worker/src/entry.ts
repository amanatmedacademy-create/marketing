import app from './index';
import { handleAuthRequest, requireSession, type AuthEnv, type AuthSession } from './auth';
import { requireBearerSession } from './bearer-auth';
import { handleGoogleAuthRequest } from './google-auth';

interface Env extends AuthEnv {
  ASSETS: Fetcher;
  APP_ENV: string;
}

const RELEASE = 'supabase-auth-v3';

const apiError = (status: number, code: string, message: string) => new Response(JSON.stringify({ error: { code, message } }), {
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
  if (session.role === 'owner' || session.role === 'admin') return true;
  if (session.role !== 'manager') return false;
  return pathname === '/api/deals' || /^\/api\/deals\/[^/]+\/move$/.test(pathname);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/health') {
      return json({ status: 'ok', service: 'imds-crm-edge', environment: env.APP_ENV, release: RELEASE, auth: 'supabase-bearer', timestamp: new Date().toISOString() });
    }

    if (request.method === 'GET' && url.pathname === '/api/config') {
      return json({ environment: env.APP_ENV, release: RELEASE, auth: 'supabase-bearer', supabaseConfigured: Boolean(env.SUPABASE_URL) });
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

      const response = await app.fetch(request, { ...env, DEFAULT_COMPANY_ID: session.companyId });
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
