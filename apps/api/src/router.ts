import { AuthenticationError, resolveAuthContext } from './auth/resolve-auth-context';
import { handleHealth } from './modules/health/handler';
import { handleModuleCatalog } from './modules/module-catalog/handler';
import type { Env } from './index';
import { json, notFound, withSecurityHeaders } from './shared/http';

export async function routeRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);

  if (request.method === 'OPTIONS') {
    return withSecurityHeaders(new Response(null, { status: 204 }));
  }

  try {
    if (request.method === 'GET' && url.pathname === '/api/health') {
      return withSecurityHeaders(handleHealth(env));
    }

    if (request.method === 'GET' && url.pathname === '/api/modules') {
      return withSecurityHeaders(handleModuleCatalog());
    }

    if (request.method === 'GET' && url.pathname === '/api/me') {
      const auth = await resolveAuthContext(request, env);
      return withSecurityHeaders(json(auth));
    }

    return withSecurityHeaders(notFound());
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return withSecurityHeaders(json({
        error: {
          code: error.status === 403 ? 'FORBIDDEN' : 'UNAUTHENTICATED',
          message: error.message
        }
      }, error.status));
    }

    console.error('Unhandled API error', error);
    return withSecurityHeaders(json({ error: { code: 'INTERNAL_ERROR', message: 'Unexpected server error' } }, 500));
  }
}
