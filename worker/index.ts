interface Env {
  ASSETS: Fetcher;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  APP_ORIGIN?: string;
}

type JsonRecord = Record<string, unknown>;

const json = (data: unknown, status = 200, headers: HeadersInit = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...headers,
    },
  });

const corsHeaders = (request: Request, env: Env): HeadersInit => {
  const origin = request.headers.get('origin');
  if (!origin) return {};
  const allowedOrigin = env.APP_ORIGIN || new URL(request.url).origin;
  return origin === allowedOrigin
    ? {
        'access-control-allow-origin': origin,
        'access-control-allow-credentials': 'true',
        vary: 'origin',
      }
    : {};
};

const supabaseHeaders = (env: Env, extra: HeadersInit = {}): HeadersInit => ({
  apikey: env.SUPABASE_SERVICE_ROLE_KEY,
  authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
  'content-type': 'application/json',
  ...extra,
});

async function supabaseRequest(env: Env, path: string, init: RequestInit = {}): Promise<Response> {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return json({ error: 'Supabase is not configured' }, 503);
  }

  return fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: supabaseHeaders(env, init.headers),
  });
}

async function proxySupabase(response: Response, request: Request, env: Env) {
  const body = await response.text();
  return new Response(body || null, {
    status: response.status,
    headers: {
      'content-type': response.headers.get('content-type') || 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...corsHeaders(request, env),
    },
  });
}

async function handleLeads(request: Request, env: Env, url: URL) {
  if (request.method === 'GET') {
    const limit = Math.min(Math.max(Number(url.searchParams.get('limit') || 100), 1), 500);
    const stage = url.searchParams.get('stage');
    const source = url.searchParams.get('source');
    const params = new URLSearchParams({ select: '*', order: 'created_at.desc', limit: String(limit) });
    if (stage) params.set('stage', `eq.${stage}`);
    if (source) params.set('source', `eq.${source}`);
    return proxySupabase(await supabaseRequest(env, `marketing_leads?${params.toString()}`), request, env);
  }

  if (request.method === 'POST') {
    const payload = (await request.json()) as JsonRecord;
    return proxySupabase(
      await supabaseRequest(env, 'marketing_leads', {
        method: 'POST',
        headers: { prefer: 'return=representation' },
        body: JSON.stringify(payload),
      }),
      request,
      env,
    );
  }

  return json({ error: 'Method not allowed' }, 405, corsHeaders(request, env));
}

async function handleLeadById(request: Request, env: Env, id: string) {
  if (!id) return json({ error: 'Lead id is required' }, 400, corsHeaders(request, env));

  if (request.method === 'PATCH') {
    const payload = (await request.json()) as JsonRecord;
    return proxySupabase(
      await supabaseRequest(env, `marketing_leads?id=eq.${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { prefer: 'return=representation' },
        body: JSON.stringify(payload),
      }),
      request,
      env,
    );
  }

  if (request.method === 'DELETE') {
    return proxySupabase(
      await supabaseRequest(env, `marketing_leads?id=eq.${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: { prefer: 'return=representation' },
      }),
      request,
      env,
    );
  }

  return json({ error: 'Method not allowed' }, 405, corsHeaders(request, env));
}

async function handleDashboard(request: Request, env: Env, url: URL) {
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  const params = new URLSearchParams({ select: '*' });
  if (from) params.set('date', `gte.${from}`);
  if (to) params.append('date', `lte.${to}`);
  return proxySupabase(
    await supabaseRequest(env, `marketing_dashboard_daily?${params.toString()}&order=date.asc`),
    request,
    env,
  );
}

async function handleSources(request: Request, env: Env) {
  return proxySupabase(
    await supabaseRequest(env, 'marketing_source_summary?select=*&order=revenue.desc'),
    request,
    env,
  );
}

async function handleAds(request: Request, env: Env) {
  return proxySupabase(
    await supabaseRequest(env, 'marketing_ads_summary?select=*&order=revenue.desc'),
    request,
    env,
  );
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS' && url.pathname.startsWith('/api/')) {
      return new Response(null, {
        status: 204,
        headers: {
          ...corsHeaders(request, env),
          'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
          'access-control-allow-headers': 'content-type,authorization',
          'access-control-max-age': '86400',
        },
      });
    }

    try {
      if (url.pathname === '/api/health') {
        return json(
          {
            ok: true,
            service: 'amanat-marketing-api',
            supabaseConfigured: Boolean(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY),
          },
          200,
          corsHeaders(request, env),
        );
      }

      if (url.pathname === '/api/leads') return handleLeads(request, env, url);
      if (url.pathname.startsWith('/api/leads/')) {
        return handleLeadById(request, env, url.pathname.split('/').pop() || '');
      }
      if (url.pathname === '/api/dashboard') return handleDashboard(request, env, url);
      if (url.pathname === '/api/sources') return handleSources(request, env);
      if (url.pathname === '/api/ads') return handleAds(request, env);

      if (url.pathname.startsWith('/api/')) {
        return json({ error: 'API route not found' }, 404, corsHeaders(request, env));
      }

      return env.ASSETS.fetch(request);
    } catch (error) {
      console.error(error);
      return json({ error: 'Internal server error' }, 500, corsHeaders(request, env));
    }
  },
};
