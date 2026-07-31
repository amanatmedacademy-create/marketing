interface Env {
  ASSETS: Fetcher;
  APP_ENV: string;
  SUPABASE_URL: string;
  SUPABASE_PUBLISHABLE_KEY?: string;
  API_ORIGIN?: string;
}

const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), {
    ...init,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...init.headers,
    },
  });

const securityHeaders = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
};

async function proxyApi(request: Request, env: Env): Promise<Response> {
  if (!env.API_ORIGIN) {
    return json(
      {
        error: {
          code: 'API_NOT_CONFIGURED',
          message: 'API_ORIGIN is not configured for this environment.',
        },
      },
      { status: 503 },
    );
  }

  const incoming = new URL(request.url);
  const target = new URL(`${incoming.pathname}${incoming.search}`, env.API_ORIGIN);
  const headers = new Headers(request.headers);
  headers.set('x-forwarded-host', incoming.host);
  headers.set('x-forwarded-proto', incoming.protocol.replace(':', ''));

  return fetch(target, {
    method: request.method,
    headers,
    body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body,
    redirect: 'manual',
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/health') {
      return json({
        status: 'ok',
        service: 'imds-crm-edge',
        environment: env.APP_ENV,
        timestamp: new Date().toISOString(),
      });
    }

    if (url.pathname === '/api/config') {
      return json({
        supabaseUrl: env.SUPABASE_URL,
        supabasePublishableKey: env.SUPABASE_PUBLISHABLE_KEY ?? '',
      });
    }

    if (url.pathname.startsWith('/api/')) {
      const response = await proxyApi(request, env);
      const proxied = new Response(response.body, response);
      Object.entries(securityHeaders).forEach(([key, value]) => proxied.headers.set(key, value));
      return proxied;
    }

    const assetResponse = await env.ASSETS.fetch(request);
    const response = new Response(assetResponse.body, assetResponse);
    Object.entries(securityHeaders).forEach(([key, value]) => response.headers.set(key, value));
    return response;
  },
} satisfies ExportedHandler<Env>;
