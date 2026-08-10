import type { Env } from './integrations';
import { processMetaGrowthConversions } from './metaGrowthConversions';
import { requireCompanyId, type TenantScopedEnv } from './tenantScope';

type Row = Record<string, unknown>;
type ScopedEnv = Env & TenantScopedEnv;

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});

function headers(env: Env, extra: HeadersInit = {}): Headers {
  const next = new Headers(extra);
  next.set('apikey', env.SUPABASE_SERVICE_ROLE_KEY);
  next.set('authorization', `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`);
  next.set('accept', 'application/json');
  if (!next.has('content-type')) next.set('content-type', 'application/json');
  return next;
}

async function db<T>(env: Env, path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/${path}`, {
    ...init,
    headers: headers(env, init.headers),
    cache: 'no-store',
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`Growth Engine DB ${response.status}: ${body.slice(0, 1200)}`);
  return (body ? JSON.parse(body) : null) as T;
}

const num = (value: unknown) => Number(value || 0);
const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';
const isAdmin = (request: Request) => request.headers.get('x-amanat-auth-role') === 'administrator';

async function overview(env: ScopedEnv): Promise<Response> {
  const companyId = requireCompanyId(env);
  const scope = `company_id=eq.${encodeURIComponent(companyId)}`;
  const [events, lost, conversions, destinations] = await Promise.all([
    db<Row[]>(env, `patient_journey_events?select=event_type,value,occurred_at&${scope}&order=occurred_at.desc&limit=50000`),
    db<Row[]>(env, `lost_opportunities?select=id,status,estimated_value,reason,detected_at&${scope}&order=detected_at.desc&limit=50000`),
    db<Row[]>(env, `conversion_events?select=id,event_name,destination,sync_status,value,occurred_at&${scope}&order=occurred_at.desc&limit=50000`),
    db<Row[]>(env, `growth_conversion_destinations?select=provider,external_destination_id,enabled&${scope}`),
  ]);

  const funnel: Record<string, number> = {};
  for (const row of events) funnel[text(row.event_type)] = (funnel[text(row.event_type)] || 0) + 1;
  const openLost = lost.filter((row) => ['open', 'recovering'].includes(text(row.status)));
  const recoverableValue = openLost.reduce((sum, row) => sum + num(row.estimated_value), 0);
  const pendingConversions = conversions.filter((row) => ['pending', 'processing', 'failed'].includes(text(row.sync_status)));

  return json({
    funnel,
    journeyEvents: events.length,
    openLostOpportunities: openLost.length,
    recoverableValue,
    pendingConversions: pendingConversions.length,
    sentConversions: conversions.filter((row) => text(row.sync_status) === 'sent').length,
    skippedConversions: conversions.filter((row) => text(row.sync_status) === 'skipped').length,
    destinations,
  });
}

async function journey(env: ScopedEnv, url: URL): Promise<Response> {
  const companyId = requireCompanyId(env);
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit') || 250), 1), 2000);
  const params = new URLSearchParams({
    select: 'id,lead_id,event_type,occurred_at,channel,source,campaign_id,adset_id,ad_id,value,currency,metadata',
    company_id: `eq.${companyId}`,
    order: 'occurred_at.desc',
    limit: String(limit),
  });
  const leadId = (url.searchParams.get('lead_id') || '').trim();
  if (leadId) params.set('lead_id', `eq.${leadId}`);
  return json(await db<Row[]>(env, `patient_journey_events?${params}`));
}

async function conversions(env: ScopedEnv, url: URL): Promise<Response> {
  const companyId = requireCompanyId(env);
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit') || 250), 1), 2000);
  const params = new URLSearchParams({
    select: 'id,lead_id,event_name,occurred_at,destination,value,currency,campaign_id,adset_id,ad_id,sync_status,attempts,last_error,sent_at',
    company_id: `eq.${companyId}`,
    order: 'occurred_at.desc',
    limit: String(limit),
  });
  const status = (url.searchParams.get('status') || '').trim();
  if (status) params.set('sync_status', `eq.${status}`);
  return json(await db<Row[]>(env, `conversion_events?${params}`));
}

async function destinationSettings(request: Request, env: ScopedEnv): Promise<Response> {
  const companyId = requireCompanyId(env);
  if (request.method === 'GET') {
    return json(await db<Row[]>(env, `growth_conversion_destinations?company_id=eq.${encodeURIComponent(companyId)}&select=provider,external_destination_id,enabled,config,updated_at&order=provider.asc`));
  }
  if (request.method !== 'PUT') return json({ error: 'Method not allowed' }, 405);
  if (!isAdmin(request)) return json({ error: 'Настройки Growth Engine доступны только администратору' }, 403);
  const payload = await request.json().catch(() => ({})) as Row;
  const provider = text(payload.provider);
  const externalDestinationId = text(payload.externalDestinationId);
  if (!['meta', 'google', 'tiktok'].includes(provider)) return json({ error: 'Unsupported provider' }, 400);
  if (!externalDestinationId) return json({ error: 'Destination ID is required' }, 400);
  const stored = {
    company_id: companyId,
    provider,
    external_destination_id: externalDestinationId,
    enabled: payload.enabled !== false,
    config: payload.config && typeof payload.config === 'object' && !Array.isArray(payload.config) ? payload.config : {},
    updated_at: new Date().toISOString(),
  };
  const rows = await db<Row[]>(env, 'growth_conversion_destinations?on_conflict=company_id,provider&select=provider,external_destination_id,enabled,config,updated_at', {
    method: 'POST',
    headers: { prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify(stored),
  });
  return json(rows[0] || stored);
}

async function syncMeta(request: Request, env: ScopedEnv): Promise<Response> {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!isAdmin(request)) return json({ error: 'Отправлять offline conversions может только администратор' }, 403);
  const payload = await request.json().catch(() => ({})) as Row;
  const limit = Math.min(Math.max(Number(payload.limit || 25), 1), 100);
  return json({ ok: true, ...(await processMetaGrowthConversions(env, limit)) });
}

async function lostOpportunities(request: Request, env: ScopedEnv, url: URL): Promise<Response> {
  const companyId = requireCompanyId(env);
  if (request.method === 'GET') {
    const limit = Math.min(Math.max(Number(url.searchParams.get('limit') || 250), 1), 2000);
    const params = new URLSearchParams({
      select: 'id,lead_id,call_id,status,reason,estimated_value,currency,owner_user_id,owner_name,next_action,next_action_at,detected_at,recovered_at,metadata',
      company_id: `eq.${companyId}`,
      order: 'detected_at.desc',
      limit: String(limit),
    });
    const status = (url.searchParams.get('status') || '').trim();
    if (status) params.set('status', `eq.${status}`);
    return json(await db<Row[]>(env, `lost_opportunities?${params}`));
  }
  return json({ error: 'Method not allowed' }, 405);
}

async function lostOpportunityById(request: Request, env: ScopedEnv, id: string): Promise<Response> {
  if (request.method !== 'PATCH') return json({ error: 'Method not allowed' }, 405);
  const companyId = requireCompanyId(env);
  const payload = await request.json().catch(() => ({})) as Row;
  const allowed: Row = {};
  for (const key of ['status', 'next_action', 'next_action_at', 'owner_user_id', 'owner_name']) {
    if (Object.prototype.hasOwnProperty.call(payload, key)) allowed[key] = payload[key];
  }
  const status = text(allowed.status);
  if (status && !['open', 'recovering', 'recovered', 'lost'].includes(status)) return json({ error: 'Invalid status' }, 400);
  if (status === 'recovered') allowed.recovered_at = new Date().toISOString();
  allowed.updated_at = new Date().toISOString();
  const rows = await db<Row[]>(env, `lost_opportunities?id=eq.${encodeURIComponent(id)}&company_id=eq.${encodeURIComponent(companyId)}&select=*`, {
    method: 'PATCH',
    headers: { prefer: 'return=representation' },
    body: JSON.stringify(allowed),
  });
  if (!rows.length) return json({ error: 'Opportunity not found in current clinic' }, 404);
  return json(rows[0]);
}

export async function handleGrowthEngine(request: Request, env: Env, url: URL): Promise<Response | null> {
  const scoped = env as ScopedEnv;
  if (url.pathname === '/api/growth/overview' && request.method === 'GET') return overview(scoped);
  if (url.pathname === '/api/growth/journey' && request.method === 'GET') return journey(scoped, url);
  if (url.pathname === '/api/growth/conversions' && request.method === 'GET') return conversions(scoped, url);
  if (url.pathname === '/api/growth/destinations') return destinationSettings(request, scoped);
  if (url.pathname === '/api/growth/conversions/meta/sync') return syncMeta(request, scoped);
  if (url.pathname === '/api/growth/lost-opportunities') return lostOpportunities(request, scoped, url);
  if (url.pathname.startsWith('/api/growth/lost-opportunities/')) return lostOpportunityById(request, scoped, decodeURIComponent(url.pathname.split('/').pop() || ''));
  return null;
}
