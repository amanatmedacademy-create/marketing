import {
  handleIntegrationRequest,
  runAllSyncs,
  runScheduledSync,
  type Env,
  type WorkerExecutionContext,
  type WorkerScheduledController,
} from './integrations';
import {
  handleCredentialRequest,
  hydrateIntegrationEnv,
  isFrontendAdmin,
  updateCredentialVerification,
  type IntegrationProvider,
} from './credentials';

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

  return fetch(`${env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/${path}`, {
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
    const params = new URLSearchParams({ select: '*', order: 'lead_created_at.desc.nullslast,created_at.desc', limit: String(limit) });
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
  const summary = await supabaseRequest(env, 'marketing_ads_summary?select=*&order=revenue.desc');
  if (summary.ok || summary.status !== 404) return proxySupabase(summary, request, env);
  return proxySupabase(
    await supabaseRequest(env, 'marketing_ads?select=row_key:id,*&order=report_date.desc,revenue.desc'),
    request,
    env,
  );
}

async function handleFrontendIntegrationAction(request: Request, env: Env, url: URL): Promise<Response | null> {
  if (!isFrontendAdmin(request, env)) return null;

  if (url.pathname === '/api/integrations/sync' && request.method === 'POST') {
    const payload = (await request.json().catch(() => ({}))) as JsonRecord;
    const source = typeof payload.source === 'string' ? payload.source : 'all';
    const days = Math.min(Math.max(Number(payload.days || 90), 1), 365);
    const results = await runAllSyncs(env, { source, days });
    return json({ ok: true, results }, 200, corsHeaders(request, env));
  }

  if (url.pathname.startsWith('/api/integrations/test/') && request.method === 'POST') {
    const provider = url.pathname.split('/').pop() as IntegrationProvider;
    if (!['bitrix', 'meta', 'tiktok', 'n8n'].includes(provider)) {
      return json({ error: 'Неизвестная интеграция' }, 404, corsHeaders(request, env));
    }
    if (provider === 'n8n') {
      const ok = Boolean(env.N8N_WEBHOOK_SECRET);
      await updateCredentialVerification(env, provider, ok, ok ? undefined : new Error('Webhook secret не настроен'));
      return json(ok ? { ok: true, message: 'n8n endpoint готов' } : { error: 'Webhook secret не настроен' }, ok ? 200 : 400, corsHeaders(request, env));
    }
    try {
      const results = await runAllSyncs(env, { source: provider, days: 1 });
      const failed = results.some((result) => result.skipped || result.reason);
      if (failed) throw new Error(results.map((result) => result.reason).filter(Boolean).join('; ') || 'Проверка не выполнена');
      await updateCredentialVerification(env, provider, true);
      return json({ ok: true, results }, 200, corsHeaders(request, env));
    } catch (error) {
      await updateCredentialVerification(env, provider, false, error);
      return json({ error: error instanceof Error ? error.message : String(error) }, 400, corsHeaders(request, env));
    }
  }

  return null;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS' && url.pathname.startsWith('/api/')) {
      return new Response(null, {
        status: 204,
        headers: {
          ...corsHeaders(request, env),
          'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
          'access-control-allow-headers': 'content-type,authorization,x-admin-key,x-webhook-secret,x-hub-signature-256',
          'access-control-max-age': '86400',
        },
      });
    }

    try {
      const credentialResponse = await handleCredentialRequest(request, env, url);
      if (credentialResponse) return credentialResponse;

      const runtimeEnv = await hydrateIntegrationEnv(env);

      if (url.pathname === '/api/health') {
        return json(
          {
            ok: true,
            service: 'amanat-marketing-api',
            supabaseConfigured: Boolean(runtimeEnv.SUPABASE_URL && runtimeEnv.SUPABASE_SERVICE_ROLE_KEY),
          },
          200,
          corsHeaders(request, runtimeEnv),
        );
      }

      const frontendIntegrationResponse = await handleFrontendIntegrationAction(request, runtimeEnv, url);
      if (frontendIntegrationResponse) return frontendIntegrationResponse;

      const integrationResponse = await handleIntegrationRequest(request, runtimeEnv, url);
      if (integrationResponse) return integrationResponse;

      if (url.pathname === '/api/leads') return handleLeads(request, runtimeEnv, url);
      if (url.pathname.startsWith('/api/leads/')) {
        return handleLeadById(request, runtimeEnv, url.pathname.split('/').pop() || '');
      }
      if (url.pathname === '/api/dashboard') return handleDashboard(request, runtimeEnv, url);
      if (url.pathname === '/api/sources') return handleSources(request, runtimeEnv);
      if (url.pathname === '/api/ads') return handleAds(request, runtimeEnv);

      if (url.pathname.startsWith('/api/')) {
        return json({ error: 'API route not found' }, 404, corsHeaders(request, runtimeEnv));
      }

      return runtimeEnv.ASSETS.fetch(request);
    } catch (error) {
      console.error(error);
      return json(
        { error: error instanceof Error ? error.message : 'Internal server error' },
        500,
        corsHeaders(request, env),
      );
    }
  },

  async scheduled(controller: WorkerScheduledController, env: Env, ctx: WorkerExecutionContext): Promise<void> {
    const runtimeEnv = await hydrateIntegrationEnv(env);
    await runScheduledSync(controller, runtimeEnv, ctx);
  },
};
