import app from './index';
import { handleAuthRequest, requireUser, type AuthEnv } from './auth';

interface Env extends AuthEnv {
  ASSETS: Fetcher;
  APP_ENV: string;
}

const unauthorized = () => new Response(JSON.stringify({
  error: { code: 'UNAUTHORIZED', message: 'Не авторизован' },
}), {
  status: 401,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  },
});

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname.startsWith('/api/auth/')) {
      const authResponse = await handleAuthRequest(request, env);
      if (authResponse) return authResponse;
    }

    if (url.pathname.startsWith('/api/') && url.pathname !== '/api/config') {
      const user = await requireUser(request, env);
      if (!user) return unauthorized();
    }

    return app.fetch(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;
