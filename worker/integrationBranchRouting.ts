import { hydrateIntegrationEnv } from './credentials';
import { localDataJson, localDataRequest, type LocalDataEnv } from './localData';
import { branchScope, type TenantScopedEnv } from './tenantScope';
import { runTenantSyncs, type TenantSyncEnv, type TenantSyncResult } from './tenantSync';
import type { WorkerScheduledController } from './integrations';

type Row = Record<string, unknown>;
type RouterEnv = LocalDataEnv & TenantScopedEnv;
type CredentialRow = { company_id?: string; branch_id?: string | null; provider?: string; config_summary?: Row; status?: string };
export type RouteLease = { ids: string[]; companyId?: string; branchId?: string };
export type PreparedRoute = { env: RouterEnv; lease: RouteLease; response?: Response };

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
const text = (value: unknown): string => typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim();
const record = (value: unknown): Row => value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {};
const csv = (value: unknown): string[] => text(value).split(',').map((item) => item.trim()).filter(Boolean);
const digits = (value: unknown): string => text(value).replace(/\D/g, '');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ROUTED_PROVIDERS = new Set(['waba', 'zadarma', 'bitrix', 'meta', 'tiktok']);

async function db<T>(env: RouterEnv, path: string, init: RequestInit = {}, label = 'Integration branch routing'): Promise<T> {
  return localDataJson<T>(env, path, init, label);
}

function values(row: CredentialRow): Row { return record(record(row.config_summary).values); }
function host(value: unknown): string {
  const raw = text(value); if (!raw) return '';
  try { return new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`).hostname.toLowerCase(); }
  catch { return raw.replace(/^https?:\/\//i, '').split('/')[0].toLowerCase(); }
}
function active(row: CredentialRow): boolean { return ['configured', 'connected'].includes(text(row.status).toLowerCase()); }

async function credentials(env: RouterEnv, provider: string, companyId?: string): Promise<CredentialRow[]> {
  const params = new URLSearchParams({ provider: `eq.${provider}`, branch_id: 'not.is.null', select: 'company_id,branch_id,provider,config_summary,status' });
  if (companyId) params.set('company_id', `eq.${companyId}`);
  const rows = await db<CredentialRow[]>(env, `integration_credentials?${params}`, {}, 'Integration routing credentials');
  return rows.filter((row) => active(row) && UUID.test(text(row.company_id)) && UUID.test(text(row.branch_id)));
}

async function branches(env: RouterEnv, companyId: string): Promise<Array<{ id: string; phone: string }>> {
  const rows = await db<Row[]>(env, `crm_branches?company_id=eq.${encodeURIComponent(companyId)}&status=eq.active&select=id,phone`, {}, 'Integration routing branches');
  return rows.map((row) => ({ id: text(row.id), phone: digits(row.phone) })).filter((row) => UUID.test(row.id));
}

function uniqueRoute(rows: CredentialRow[], predicate: (row: CredentialRow) => boolean): CredentialRow | null {
  const matches = rows.filter(predicate);
  const branchIds = [...new Set(matches.map((row) => text(row.branch_id)).filter((id) => UUID.test(id)))];
  if (branchIds.length !== 1) return null;
  return matches.find((row) => text(row.branch_id) === branchIds[0]) || null;
}

async function createClaims(env: RouterEnv, companyId: string, branchId: string, provider: string, claims: Array<{ kind: string; value: string }>, ttlSeconds = 900): Promise<RouteLease> {
  if (!UUID.test(companyId) || !UUID.test(branchId) || !ROUTED_PROVIDERS.has(provider)) return { ids: [] };
  const now = Date.now();
  const expiresAt = new Date(now + Math.max(60, ttlSeconds) * 1000).toISOString();
  const normalized = claims.map((claim) => ({ kind: text(claim.kind).toLowerCase(), value: text(claim.value).toLowerCase() })).filter((claim) => claim.kind && claim.value);
  if (!normalized.some((claim) => claim.kind === 'wildcard')) normalized.push({ kind: 'wildcard', value: '*' });
  const payload = normalized.map((claim) => ({ company_id: companyId, branch_id: branchId, provider, route_kind: claim.kind, route_value: claim.value, expires_at: expiresAt }));
  const rows = await db<Array<{ id?: string }>>(env, 'imds_integration_route_claims?select=id', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify(payload) }, 'Create integration route claims');
  return { ids: rows.map((row) => text(row.id)).filter((id) => UUID.test(id)), companyId, branchId };
}

export async function releaseIntegrationRouteLease(env: RouterEnv, lease?: RouteLease | null): Promise<void> {
  const ids = lease?.ids || [];
  if (!ids.length) return;
  await localDataRequest(env, `imds_integration_route_claims?id=in.(${ids.map(encodeURIComponent).join(',')})`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } }).catch(() => undefined);
}

async function requestPayload(request: Request): Promise<Row> {
  if (request.method === 'GET' || request.method === 'HEAD') return {};
  const raw = await request.clone().text().catch(() => '');
  if (!raw) return {};
  if ((request.headers.get('content-type') || '').includes('application/json')) {
    try { return record(JSON.parse(raw)); } catch { return {}; }
  }
  const params = new URLSearchParams(raw); const result: Row = {};
  params.forEach((value, key) => { result[key] = value; });
  return result;
}

async function routeWaba(request: Request, env: RouterEnv): Promise<PreparedRoute> {
  if (request.method !== 'POST') return { env, lease: { ids: [] } };
  const payload = await requestPayload(request);
  const rows = await credentials(env, 'waba');
  let companyId = '';
  let branchId = '';
  const claims: Array<{ kind: string; value: string }> = [];
  for (const entry of Array.isArray(payload.entry) ? payload.entry.map(record) : []) {
    for (const change of Array.isArray(entry.changes) ? entry.changes.map(record) : []) {
      const value = record(change.value); const metadata = record(value.metadata); const phoneNumberId = text(metadata.phone_number_id);
      if (!phoneNumberId) continue;
      const route = uniqueRoute(rows, (row) => text(values(row).phoneNumberId) === phoneNumberId);
      if (!route) return { env, lease: { ids: [] }, response: json({ error: 'Не удалось однозначно определить филиал для WABA phone_number_id', code: 'BRANCH_ROUTE_UNRESOLVED', phoneNumberId }, 409) };
      const nextCompanyId = text(route.company_id); const nextBranchId = text(route.branch_id);
      if (branchId && (nextBranchId !== branchId || nextCompanyId !== companyId)) {
        return { env, lease: { ids: [] }, response: json({ error: 'Один WABA webhook содержит события разных филиалов', code: 'BRANCH_ROUTE_AMBIGUOUS' }, 409) };
      }
      companyId = nextCompanyId; branchId = nextBranchId;
      claims.push({ kind: 'phone_number_id', value: phoneNumberId });
      for (const message of Array.isArray(value.messages) ? value.messages.map(record) : []) { const phone = digits(message.from); if (phone) claims.push({ kind: 'phone', value: phone }); }
    }
  }
  if (!branchId) {
    const branchIds = [...new Set(rows.map((row) => `${text(row.company_id)}:${text(row.branch_id)}`))];
    if (branchIds.length !== 1 || !rows[0]) return { env, lease: { ids: [] }, response: json({ error: 'Не удалось определить филиал WABA webhook', code: 'BRANCH_ROUTE_UNRESOLVED' }, 409) };
    companyId = text(rows[0].company_id); branchId = text(rows[0].branch_id);
  }
  const lease = await createClaims(env, companyId, branchId, 'waba', claims.length ? claims : [{ kind: 'webhook', value: '*' }]);
  return { env: { ...env, CURRENT_COMPANY_ID: companyId, CURRENT_BRANCH_ID: branchId }, lease };
}

async function routeZadarma(request: Request, env: RouterEnv, url: URL): Promise<PreparedRoute> {
  const match = url.pathname.match(/^\/api\/telephony\/zadarma\/webhook\/([0-9a-f-]{36})$/i);
  if (!match || request.method !== 'POST') return { env, lease: { ids: [] } };
  const companyId = match[1]; const payload = await requestPayload(request); const event = text(payload.event).toUpperCase();
  const rows = await credentials(env, 'zadarma', companyId); const branchRows = await branches(env, companyId);
  const calledDid = digits(payload.called_did); const extension = text(payload.internal); const pbxCallId = text(payload.pbx_call_id); const caller = digits(payload.caller_id);
  let branchId = '';
  if (pbxCallId) {
    const calls = await db<Row[]>(env, `marketing_calls?company_id=eq.${encodeURIComponent(companyId)}&pbx_call_id=eq.${encodeURIComponent(pbxCallId)}&branch_id=not.is.null&select=branch_id&limit=2`, {}, 'Existing Zadarma call route').catch(() => []);
    const ids = [...new Set(calls.map((row) => text(row.branch_id)).filter((id) => UUID.test(id)))]; if (ids.length === 1) branchId = ids[0];
  }
  if (!branchId && calledDid) {
    const branchMatches = branchRows.filter((branch) => branch.phone && branch.phone === calledDid);
    if (branchMatches.length === 1) branchId = branchMatches[0].id;
    if (!branchId) {
      const route = uniqueRoute(rows, (row) => csv(values(row).inboundDids).map(digits).includes(calledDid)); if (route) branchId = text(route.branch_id);
    }
  }
  if (!branchId && extension) { const route = uniqueRoute(rows, (row) => text(values(row).pbxExtension) === extension); if (route) branchId = text(route.branch_id); }
  if (!branchId && rows.length) {
    const ids = [...new Set(rows.map((row) => text(row.branch_id)).filter((id) => UUID.test(id)))]; if (ids.length === 1) branchId = ids[0];
  }
  if (!branchId) return { env, lease: { ids: [] }, response: json({ error: 'Не удалось однозначно определить филиал Zadarma по DID/extension', code: 'BRANCH_ROUTE_UNRESOLVED', event, calledDid: calledDid || null, extension: extension || null }, 409) };
  const claims = [{ kind: 'did', value: calledDid }, { kind: 'extension', value: extension }, { kind: 'pbx_call_id', value: pbxCallId }, { kind: 'phone', value: caller }].filter((item) => item.value);
  const lease = await createClaims(env, companyId, branchId, 'zadarma', claims);
  return { env: { ...env, CURRENT_COMPANY_ID: companyId, CURRENT_BRANCH_ID: branchId }, lease };
}

async function routeBitrix(request: Request, env: RouterEnv): Promise<PreparedRoute> {
  if (request.method !== 'POST') return { env, lease: { ids: [] } };
  const payload = await requestPayload(request); const auth = record(payload.auth); const domain = host(auth.domain || payload['auth[domain]'] || payload.domain);
  const rows = await credentials(env, 'bitrix');
  let route = domain ? uniqueRoute(rows, (row) => host(values(row).webhookBaseUrl) === domain) : null;
  if (!route && rows.length === 1) route = rows[0];
  if (!route) return { env, lease: { ids: [] }, response: json({ error: 'Не удалось определить филиал Bitrix по webhook domain', code: 'BRANCH_ROUTE_UNRESOLVED', domain: domain || null }, 409) };
  const companyId = text(route.company_id); const branchId = text(route.branch_id); const lease = await createClaims(env, companyId, branchId, 'bitrix', [{ kind: 'domain', value: domain || '*' }]);
  return { env: { ...env, CURRENT_COMPANY_ID: companyId, CURRENT_BRANCH_ID: branchId }, lease };
}

async function routeMeta(request: Request, env: RouterEnv): Promise<PreparedRoute> {
  if (request.method !== 'POST') return { env, lease: { ids: [] } };
  const payload = await requestPayload(request); const rows = await credentials(env, 'meta');
  const adIds = new Set<string>();
  for (const entry of Array.isArray(payload.entry) ? payload.entry.map(record) : []) for (const change of Array.isArray(entry.changes) ? entry.changes.map(record) : []) { const value = record(change.value); const id = text(value.ad_id); if (id) adIds.add(id); }
  let route = adIds.size ? uniqueRoute(rows, (row) => csv(values(row).selectedAdIds).some((id) => adIds.has(id))) : null;
  if (!route && rows.length === 1) route = rows[0];
  if (!route) return { env, lease: { ids: [] }, response: json({ error: 'Не удалось определить филиал Meta webhook', code: 'BRANCH_ROUTE_UNRESOLVED', adIds: [...adIds] }, 409) };
  const companyId = text(route.company_id); const branchId = text(route.branch_id); const lease = await createClaims(env, companyId, branchId, 'meta', [{ kind: 'webhook', value: '*' }]);
  return { env: { ...env, CURRENT_COMPANY_ID: companyId, CURRENT_BRANCH_ID: branchId }, lease };
}

async function routeTikTok(request: Request, env: RouterEnv): Promise<PreparedRoute> {
  if (request.method !== 'POST') return { env, lease: { ids: [] } };
  const payload = await requestPayload(request); const data = record(payload.data); const advertiser = text(data.advertiser_id || data.advertiserId || payload.advertiser_id);
  const rows = await credentials(env, 'tiktok');
  let route = advertiser ? uniqueRoute(rows, (row) => csv(values(row).advertiserIds).includes(advertiser)) : null;
  if (!route && rows.length === 1) route = rows[0];
  if (!route) return { env, lease: { ids: [] }, response: json({ error: 'Не удалось определить филиал TikTok webhook', code: 'BRANCH_ROUTE_UNRESOLVED', advertiserId: advertiser || null }, 409) };
  const companyId = text(route.company_id); const branchId = text(route.branch_id); const lease = await createClaims(env, companyId, branchId, 'tiktok', [{ kind: 'advertiser_id', value: advertiser || '*' }]);
  return { env: { ...env, CURRENT_COMPANY_ID: companyId, CURRENT_BRANCH_ID: branchId }, lease };
}

export async function prepareInboundIntegrationRoute(request: Request, env: RouterEnv, url: URL): Promise<PreparedRoute> {
  const routed = url.pathname === '/api/webhooks/waba'
    || url.pathname.startsWith('/api/telephony/zadarma/webhook/')
    || url.pathname === '/api/webhooks/bitrix'
    || url.pathname === '/api/webhooks/meta'
    || url.pathname === '/api/webhooks/tiktok';
  if (!routed) return { env, lease: { ids: [] } };
  await localDataRequest(env, 'imds_integration_route_claims?expires_at=lt.now()', { method: 'DELETE', headers: { Prefer: 'return=minimal' } }).catch(() => undefined);
  if (url.pathname === '/api/webhooks/waba') return routeWaba(request, env);
  if (url.pathname.startsWith('/api/telephony/zadarma/webhook/')) return routeZadarma(request, env, url);
  if (url.pathname === '/api/webhooks/bitrix') return routeBitrix(request, env);
  if (url.pathname === '/api/webhooks/meta') return routeMeta(request, env);
  if (url.pathname === '/api/webhooks/tiktok') return routeTikTok(request, env);
  return { env, lease: { ids: [] } };
}

function manualProviders(request: Request, url: URL, payload: Row): string[] {
  if (url.pathname === '/api/integrations/sync') { const source = text(payload.source || 'all').toLowerCase(); return source === 'all' ? ['bitrix','meta','tiktok'] : ROUTED_PROVIDERS.has(source) ? [source] : []; }
  if (url.pathname.startsWith('/api/integrations/test/')) { const source = url.pathname.split('/').pop() || ''; return ROUTED_PROVIDERS.has(source) ? [source] : []; }
  if (url.pathname.startsWith('/api/integrations/meta/')) return ['meta'];
  return [];
}

export async function prepareManualIntegrationRoute(request: Request, env: RouterEnv, url: URL): Promise<{ lease: RouteLease; response?: Response }> {
  if (!url.pathname.startsWith('/api/integrations/')) return { lease: { ids: [] } };
  const scope = branchScope(env); const payload = await requestPayload(request); const providers = manualProviders(request, url, payload);
  if (!providers.length) return { lease: { ids: [] } };
  if (scope.all || !scope.branchId || !UUID.test(text(env.CURRENT_COMPANY_ID))) return { lease: { ids: [] }, response: json({ error: 'Для синхронизации выберите конкретный филиал', code: 'BRANCH_REQUIRED' }, 409) };
  const leases: RouteLease[] = [];
  for (const provider of providers) leases.push(await createClaims(env, text(env.CURRENT_COMPANY_ID), scope.branchId, provider, [{ kind: 'sync', value: '*' }], 3600));
  return { lease: { ids: leases.flatMap((lease) => lease.ids), companyId: text(env.CURRENT_COMPANY_ID), branchId: scope.branchId } };
}

export async function runBranchRoutedScheduledSync(controller: WorkerScheduledController, env: RouterEnv): Promise<TenantSyncResult[]> {
  const rows = (await db<CredentialRow[]>(env, 'integration_credentials?provider=in.(bitrix,meta,tiktok)&branch_id=not.is.null&select=company_id,branch_id,provider,config_summary,status&order=company_id.asc,branch_id.asc,provider.asc', {}, 'Scheduled branch credentials')).filter(active);
  const seen = new Set<string>(); const results: TenantSyncResult[] = []; const days = controller.cron === '30 2 * * *' ? 30 : 3;
  for (const row of rows) {
    const companyId = text(row.company_id); const branchId = text(row.branch_id); const provider = text(row.provider);
    if (!UUID.test(companyId) || !UUID.test(branchId) || !['bitrix','meta','tiktok'].includes(provider)) continue;
    const key = `${companyId}:${branchId}:${provider}`; if (seen.has(key)) continue; seen.add(key);
    const lease = await createClaims(env, companyId, branchId, provider, [{ kind: 'sync', value: '*' }], 3600);
    try {
      const runtime = await hydrateIntegrationEnv({ ...env, CURRENT_COMPANY_ID: companyId, CURRENT_BRANCH_ID: branchId } as TenantSyncEnv);
      results.push(...await runTenantSyncs(runtime as TenantSyncEnv, { source: provider, days }));
    } catch (error) {
      results.push({ source: provider as 'bitrix' | 'meta' | 'tiktok', fetched: 0, written: 0, from: '', to: '', companyId, skipped: true, reason: error instanceof Error ? error.message : String(error) });
    } finally { await releaseIntegrationRouteLease(env, lease); }
  }
  return results;
}

export async function handleBranchScopedMarketingData(request: Request, env: RouterEnv, url: URL): Promise<Response | null> {
  if (request.method !== 'GET' || !['/api/dashboard','/api/sources'].includes(url.pathname)) return null;
  const companyId = text(env.CURRENT_COMPANY_ID); const scope = branchScope(env); if (!UUID.test(companyId)) return null;
  const suffix = scope.branchId ? `&branch_id=eq.${encodeURIComponent(scope.branchId)}` : '';
  const [leads, ads] = await Promise.all([
    db<Row[]>(env, `marketing_leads?company_id=eq.${encodeURIComponent(companyId)}${suffix}&select=lead_created_at,source,platform,is_target,arrived_at,sold_at,sale_amount&limit=50000`, {}, 'Branch analytics leads'),
    db<Row[]>(env, `marketing_ads?company_id=eq.${encodeURIComponent(companyId)}${suffix}&select=report_date,source,platform,spend&limit=50000`, {}, 'Branch analytics ads'),
  ]);
  const from = text(url.searchParams.get('from')); const to = text(url.searchParams.get('to'));
  if (url.pathname === '/api/dashboard') {
    const map = new Map<string, Row>();
    const item = (date: string) => { const current = map.get(date) || { date, leads: 0, target_leads: 0, arrived: 0, sales: 0, spend: 0, revenue: 0 }; map.set(date, current); return current; };
    for (const lead of leads) { const date = text(lead.lead_created_at).slice(0,10); if (!date || (from && date < from) || (to && date > to)) continue; const row=item(date); row.leads=Number(row.leads||0)+1; row.target_leads=Number(row.target_leads||0)+(lead.is_target===true?1:0); row.arrived=Number(row.arrived||0)+(lead.arrived_at?1:0); row.sales=Number(row.sales||0)+(lead.sold_at?1:0); row.revenue=Number(row.revenue||0)+Number(lead.sale_amount||0); }
    for (const ad of ads) { const date=text(ad.report_date).slice(0,10); if(!date||(from&&date<from)||(to&&date>to))continue; const row=item(date); row.spend=Number(row.spend||0)+Number(ad.spend||0); }
    return json([...map.values()].sort((a,b)=>text(a.date).localeCompare(text(b.date))));
  }
  const map = new Map<string, Row>();
  const sourceItem=(source:string,platform:string)=>{const key=`${source}\u0000${platform}`;const current=map.get(key)||{source,platform,leads:0,target_leads:0,arrived:0,sales:0,spend:0,revenue:0};map.set(key,current);return current;};
  for(const lead of leads){const source=text(lead.source)||'Не определено';const platform=text(lead.platform)||'Не определено';const row=sourceItem(source,platform);row.leads=Number(row.leads||0)+1;row.target_leads=Number(row.target_leads||0)+(lead.is_target===true?1:0);row.arrived=Number(row.arrived||0)+(lead.arrived_at?1:0);row.sales=Number(row.sales||0)+(lead.sold_at?1:0);row.revenue=Number(row.revenue||0)+Number(lead.sale_amount||0);}
  for(const ad of ads){const source=text(ad.source)||text(ad.platform)||'Не определено';const platform=text(ad.platform)||source;const row=sourceItem(source,platform);row.spend=Number(row.spend||0)+Number(ad.spend||0);}
  return json([...map.values()].sort((a,b)=>Number(b.revenue||0)-Number(a.revenue||0)||Number(b.leads||0)-Number(a.leads||0)));
}

export async function integrationRoutingDiagnostics(env: RouterEnv): Promise<Response> {
  const companyId=text(env.CURRENT_COMPANY_ID); if(!UUID.test(companyId))return json({error:'Текущая клиника не определена'},409);
  const [branchRows, credentialRows]=await Promise.all([branches(env,companyId),db<CredentialRow[]>(env,`integration_credentials?company_id=eq.${encodeURIComponent(companyId)}&branch_id=not.is.null&select=company_id,branch_id,provider,config_summary,status&order=provider.asc`,{},'Routing diagnostics')]);
  const branchMap=new Map(branchRows.map((branch)=>[branch.id,branch]));
  const items=credentialRows.filter(active).map((row)=>{const value=values(row);const provider=text(row.provider);const routes:Row={};if(provider==='waba')routes.phoneNumberId=text(value.phoneNumberId)||null;if(provider==='zadarma'){routes.pbxExtension=text(value.pbxExtension)||null;routes.inboundDids=csv(value.inboundDids);routes.branchPhone=branchMap.get(text(row.branch_id))?.phone||null;}if(provider==='meta'){routes.adAccountIds=csv(value.adAccountIds);routes.selectedAdIds=csv(value.selectedAdIds);}if(provider==='tiktok')routes.advertiserIds=csv(value.advertiserIds);if(provider==='bitrix')routes.webhookHost=host(value.webhookBaseUrl)||null;return{provider,branchId:text(row.branch_id),status:row.status,routes};});
  return json({items});
}
