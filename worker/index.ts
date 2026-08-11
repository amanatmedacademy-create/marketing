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
import { detectAdvertisingCurrencies } from './adCurrencies';
import { handleIntegrationLifecycle } from './integrationLifecycle';
import { handleGoogleIntegrationRequest } from './googleIntegrations';
import { handleMarketingAssistantRequest } from './marketingAssistant';
import { handleAutomationEngineRequest, runAutomationEngine } from './automationEngine';
import { handleTenantDataApi } from './tenantDataApi';
import { handleGrowthEngine } from './growthEngine';
import { handlePhoneWorkspace } from './phoneWorkspace';
import { zadarmaRequest } from './zadarmaTelephony';
import { handleZadarmaWebhookSetup } from './zadarmaWebhookSetup';
import { handleTelephonySettings } from './telephonySettings';

type JsonRecord = Record<string, unknown>;

const json = (data: unknown, status = 200, headers: HeadersInit = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers } });

const corsHeaders = (request: Request, env: Env): HeadersInit => {
  const origin = request.headers.get('origin');
  if (!origin) return {};
  const allowedOrigin = env.APP_ORIGIN || new URL(request.url).origin;
  return origin === allowedOrigin ? { 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true', vary: 'origin' } : {};
};

const supabaseHeaders = (env: Env, extra: HeadersInit = {}): HeadersInit => ({ apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, 'content-type': 'application/json', ...extra });

async function supabaseRequest(env: Env, path: string, init: RequestInit = {}): Promise<Response> {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return json({ error: 'Supabase is not configured' }, 503);
  return fetch(`${env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/${path}`, { ...init, headers: supabaseHeaders(env, init.headers) });
}

async function proxySupabase(response: Response, request: Request, env: Env) {
  const body = await response.text();
  return new Response(body || null, { status: response.status, headers: { 'content-type': response.headers.get('content-type') || 'application/json; charset=utf-8', 'cache-control': 'no-store', ...corsHeaders(request, env) } });
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
    return proxySupabase(await supabaseRequest(env, 'marketing_leads', { method: 'POST', headers: { prefer: 'return=representation' }, body: JSON.stringify(payload) }), request, env);
  }
  return json({ error: 'Method not allowed' }, 405, corsHeaders(request, env));
}

async function handleLeadById(request: Request, env: Env, id: string) {
  if (!id) return json({ error: 'Lead id is required' }, 400, corsHeaders(request, env));
  if (request.method === 'PATCH') {
    const payload = (await request.json()) as JsonRecord;
    return proxySupabase(await supabaseRequest(env, `marketing_leads?id=eq.${encodeURIComponent(id)}`, { method: 'PATCH', headers: { prefer: 'return=representation' }, body: JSON.stringify(payload) }), request, env);
  }
  if (request.method === 'DELETE') return proxySupabase(await supabaseRequest(env, `marketing_leads?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE', headers: { prefer: 'return=representation' } }), request, env);
  return json({ error: 'Method not allowed' }, 405, corsHeaders(request, env));
}

async function handleCalls(request: Request, env: Env, url: URL) {
  if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405, corsHeaders(request, env));
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit') || 100), 1), 500);
  const operator = url.searchParams.get('operator');
  const params = new URLSearchParams({ select: '*', order: 'started_at.desc', limit: String(limit) });
  if (operator) params.set('operator_name', `eq.${operator}`);
  return proxySupabase(await supabaseRequest(env, `marketing_calls?${params.toString()}`), request, env);
}

async function handleDashboard(request: Request, env: Env, url: URL) {
  const params = new URLSearchParams({ select: '*' });
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  if (from) params.set('date', `gte.${from}`);
  if (to) params.append('date', `lte.${to}`);
  return proxySupabase(await supabaseRequest(env, `marketing_dashboard_daily?${params.toString()}&order=date.asc`), request, env);
}

async function handleFrontendIntegrationAction(request: Request, env: Env, url: URL): Promise<Response | null> {
  if (!isFrontendAdmin(request, env)) return null;
  if (url.pathname === '/api/integrations/sync' && request.method === 'POST') {
    const payload = (await request.json().catch(() => ({}))) as JsonRecord;
    const source = typeof payload.source === 'string' ? payload.source : 'all';
    const days = Math.min(Math.max(Number(payload.days || 90), 1), 365);
    return json({ ok: true, results: await runAllSyncs(env, { source, days }) }, 200, corsHeaders(request, env));
  }
  if (url.pathname.startsWith('/api/integrations/test/') && request.method === 'POST') {
    const provider = url.pathname.split('/').pop() as IntegrationProvider;
    if (!['bitrix', 'meta', 'tiktok', 'n8n', 'zadarma'].includes(provider)) return json({ error: 'Неизвестная интеграция' }, 404, corsHeaders(request, env));
    if (provider === 'n8n') {
      const ok = Boolean(env.N8N_WEBHOOK_SECRET);
      await updateCredentialVerification(env, provider, ok, ok ? undefined : new Error('Webhook secret не настроен'));
      return json(ok ? { ok: true, message: 'n8n endpoint готов' } : { error: 'Webhook secret не настроен' }, ok ? 200 : 400, corsHeaders(request, env));
    }
    if (provider === 'zadarma') {
      try {
        const balance = await zadarmaRequest(env, '/v1/info/balance/');
        await updateCredentialVerification(env, provider, true);
        return json({ ok: true, message: 'Zadarma API доступна', balance }, 200, corsHeaders(request, env));
      } catch (error) {
        await updateCredentialVerification(env, provider, false, error);
        return json({ error: error instanceof Error ? error.message : String(error) }, 400, corsHeaders(request, env));
      }
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

async function handleRates(request: Request, env: Env): Promise<Response> {
  const response = await fetch('https://open.er-api.com/v6/latest/KZT', { headers: { accept: 'application/json' }, cf: { cacheTtl: 3600, cacheEverything: true } } as RequestInit);
  if (!response.ok) return json({ error: 'Exchange rates unavailable' }, 502, corsHeaders(request, env));
  const payload = await response.json() as JsonRecord;
  const rates = payload.rates && typeof payload.rates === 'object' ? payload.rates : {};
  return json({ base: 'KZT', rates, updatedAt: payload.time_last_update_utc || null }, 200, corsHeaders(request, env));
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS' && url.pathname.startsWith('/api/')) return new Response(null, { status: 204, headers: { ...corsHeaders(request, env), 'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS', 'access-control-allow-headers': 'content-type,authorization,x-admin-key,x-webhook-secret,x-hub-signature-256', 'access-control-max-age': '86400' } });
    try {
      const googleResponse = await handleGoogleIntegrationRequest(request, env, url);
      if (googleResponse) return googleResponse;
      const assistantResponse = await handleMarketingAssistantRequest(request, env, url);
      if (assistantResponse) return assistantResponse;
      const automationResponse = await handleAutomationEngineRequest(request, env, url);
      if (automationResponse) return automationResponse;
      const lifecycleResponse = await handleIntegrationLifecycle(request, env, url);
      if (lifecycleResponse) return lifecycleResponse;
      const credentialResponse = await handleCredentialRequest(request, env, url);
      if (credentialResponse) return credentialResponse;
      const runtimeEnv = await hydrateIntegrationEnv(env);
      const zadarmaWebhookSetup = await handleZadarmaWebhookSetup(request, runtimeEnv, url);
      if (zadarmaWebhookSetup) return zadarmaWebhookSetup;
      const telephonySettings = await handleTelephonySettings(request, runtimeEnv, url);
      if (telephonySettings) return telephonySettings;
      const phoneWorkspace = await handlePhoneWorkspace(request, runtimeEnv, url);
      if (phoneWorkspace) return phoneWorkspace;
      if (url.pathname === '/api/health') return json({ ok: true, service: 'amanat-marketing-api', supabaseConfigured: Boolean(runtimeEnv.SUPABASE_URL && runtimeEnv.SUPABASE_SERVICE_ROLE_KEY) }, 200, corsHeaders(request, runtimeEnv));
      if (url.pathname === '/api/exchange-rates' && request.method === 'GET') return handleRates(request, runtimeEnv);
      if (url.pathname === '/api/web-analytics' && request.method === 'GET') {
        return json([], 200, corsHeaders(request, runtimeEnv));
      }
      const tenantDataResponse = await handleTenantDataApi(request, runtimeEnv, url);
      if (tenantDataResponse) return tenantDataResponse;
      const growthResponse = await handleGrowthEngine(request, runtimeEnv, url);
      if (growthResponse) return growthResponse;
      const frontendIntegrationResponse = await handleFrontendIntegrationAction(request, runtimeEnv, url);
      if (frontendIntegrationResponse) return frontendIntegrationResponse;
      const integrationResponse = await handleIntegrationRequest(request, runtimeEnv, url);
      if (integrationResponse) return integrationResponse;
      if (url.pathname === '/api/leads') return handleLeads(request, runtimeEnv, url);
      if (url.pathname.startsWith('/api/leads/')) return handleLeadById(request, runtimeEnv, url.pathname.split('/').pop() || '');
      if (url.pathname === '/api/calls') return handleCalls(request, runtimeEnv, url);
      if (url.pathname === '/api/calls/operators' && request.method === 'GET') return proxySupabase(await supabaseRequest(runtimeEnv, 'marketing_call_operator_summary?select=*&order=appointments.desc,calls.desc'), request, runtimeEnv);
      if (url.pathname === '/api/dashboard') return handleDashboard(request, runtimeEnv, url);
      if (url.pathname === '/api/sources') return proxySupabase(await supabaseRequest(runtimeEnv, 'marketing_source_summary?select=*&order=revenue.desc'), request, runtimeEnv);
      if (url.pathname === '/api/ads') {
        const summary = await supabaseRequest(runtimeEnv, 'marketing_ads_summary?select=*&order=revenue.desc');
        return summary.ok || summary.status !== 404 ? proxySupabase(summary, request, runtimeEnv) : proxySupabase(await supabaseRequest(runtimeEnv, 'marketing_ads?select=row_key:id,*&order=report_date.desc,revenue.desc'), request, runtimeEnv);
      }
      if (url.pathname === '/api/ads/currencies' && request.method === 'GET') return json({ accounts: await detectAdvertisingCurrencies(runtimeEnv) }, 200, corsHeaders(request, runtimeEnv));
      if (url.pathname.startsWith('/api/')) return json({ error: 'API route not found' }, 404, corsHeaders(request, runtimeEnv));
      return runtimeEnv.ASSETS.fetch(request);
    } catch (error) {
      console.error(error);
      return json({ error: error instanceof Error ? error.message : 'Internal server error' }, 500, corsHeaders(request, env));
    }
  },
  async scheduled(controller: WorkerScheduledController, env: Env, ctx: WorkerExecutionContext): Promise<void> {
    const runtimeEnv = await hydrateIntegrationEnv(env);
    await runScheduledSync(controller, runtimeEnv, ctx);
    ctx.waitUntil(runAutomationEngine(runtimeEnv).then((result) => console.log('Automation engine completed', result)).catch((error) => console.error('Automation engine failed', error)));
  },
};