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

    return withSecurityHeaders(notFound());
  } catch (error) {
    console.error('Unhandled API error', error);
    return withSecurityHeaders(json({ error: { code: 'INTERNAL_ERROR', message: 'Unexpected server error' } }, 500));
  }
}
