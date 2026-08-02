import type { AuthSession } from './auth';
import type { MetaEnv } from './meta-auth';

type StoredAdsConnection = {
  access_token: string;
  ad_accounts: Array<{ id: string; name?: string; currency?: string }>;
};

type MetaAction = { action_type?: string; value?: string };
type MetaInsight = {
  account_id?: string;
  campaign_id?: string;
  campaign_name?: string;
  adset_id?: string;
  adset_name?: string;
  ad_id?: string;
  ad_name?: string;
  date_start?: string;
  spend?: string;
  impressions?: string;
  reach?: string;
  clicks?: string;
  inline_link_clicks?: string;
  actions?: MetaAction[];
  action_values?: MetaAction[];
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});

function graphVersion(env: MetaEnv) {
  return env.META_GRAPH_VERSION?.trim() || 'v23.0';
}

function assertEnv(env: MetaEnv) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('Supabase service environment is not configured');
}

async function supabaseRest(env: MetaEnv, path: string, init: RequestInit = {}) {
  assertEnv(env);
  return fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY!,
      authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      'content-type': 'application/json',
      prefer: 'return=representation,resolution=merge-duplicates',
      ...init.headers,
    },
  });
}

function actionValue(actions: MetaAction[] | undefined, candidates: string[]) {
  const row = actions?.find(item => item.action_type && candidates.includes(item.action_type));
  return Number(row?.value ?? 0);
}

async function loadAdsConnection(env: MetaEnv, companyId: string) {
  const response = await supabaseRest(env, `meta_connections?select=access_token,ad_accounts&company_id=eq.${encodeURIComponent(companyId)}&product=eq.ads&status=eq.connected&limit=1`);
  if (!response.ok) throw new Error(`Meta Ads connection lookup failed: ${await response.text()}`);
  const [connection] = await response.json() as StoredAdsConnection[];
  if (!connection?.access_token) throw new Error('Meta Ads is not connected');
  return connection;
}

async function fetchInsights(env: MetaEnv, accountId: string, token: string, since: string, until: string) {
  const fields = [
    'account_id','campaign_id','campaign_name','adset_id','adset_name','ad_id','ad_name',
    'date_start','spend','impressions','reach','clicks','inline_link_clicks','actions','action_values',
  ].join(',');
  const params = new URLSearchParams({
    fields,
    level: 'ad',
    time_increment: '1',
    time_range: JSON.stringify({ since, until }),
    limit: '500',
    access_token: token,
  });
  const response = await fetch(`https://graph.facebook.com/${graphVersion(env)}/${accountId}/insights?${params.toString()}`);
  const payload = await response.json() as { data?: MetaInsight[]; paging?: { next?: string }; error?: { message?: string } };
  if (!response.ok) throw new Error(payload.error?.message || `Meta insights error (${response.status})`);
  const rows = payload.data ?? [];
  let next = payload.paging?.next;
  while (next) {
    const nextResponse = await fetch(next);
    const nextPayload = await nextResponse.json() as { data?: MetaInsight[]; paging?: { next?: string }; error?: { message?: string } };
    if (!nextResponse.ok) throw new Error(nextPayload.error?.message || `Meta insights pagination error (${nextResponse.status})`);
    rows.push(...(nextPayload.data ?? []));
    next = nextPayload.paging?.next;
  }
  return rows;
}

async function upsertInsights(env: MetaEnv, session: AuthSession, account: { id: string; currency?: string }, rows: MetaInsight[]) {
  if (!rows.length) return 0;
  const records = rows.map(row => ({
    company_id: session.companyId,
    ad_account_id: row.account_id ? `act_${row.account_id.replace(/^act_/, '')}` : account.id,
    campaign_id: row.campaign_id ?? '',
    campaign_name: row.campaign_name ?? null,
    adset_id: row.adset_id ?? '',
    adset_name: row.adset_name ?? null,
    ad_id: row.ad_id ?? '',
    ad_name: row.ad_name ?? null,
    insight_date: row.date_start,
    currency: account.currency ?? null,
    spend: Number(row.spend ?? 0),
    impressions: Number(row.impressions ?? 0),
    reach: Number(row.reach ?? 0),
    clicks: Number(row.clicks ?? 0),
    inline_link_clicks: Number(row.inline_link_clicks ?? 0),
    leads: actionValue(row.actions, ['lead', 'onsite_conversion.lead_grouped', 'offsite_conversion.fb_pixel_lead']),
    purchases: actionValue(row.actions, ['purchase', 'omni_purchase', 'offsite_conversion.fb_pixel_purchase']),
    purchase_value: actionValue(row.action_values, ['purchase', 'omni_purchase', 'offsite_conversion.fb_pixel_purchase']),
    raw: row,
    synced_at: new Date().toISOString(),
  }));
  const response = await supabaseRest(env, 'meta_ads_insights_daily?on_conflict=company_id,ad_account_id,insight_date,campaign_id,adset_id,ad_id', {
    method: 'POST',
    body: JSON.stringify(records),
  });
  if (!response.ok) throw new Error(`Meta insights storage failed: ${await response.text()}`);
  return records.length;
}

async function syncInsights(request: Request, env: MetaEnv, session: AuthSession) {
  const body = await request.json().catch(() => ({})) as { since?: string; until?: string };
  const today = new Date().toISOString().slice(0, 10);
  const defaultSince = new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10);
  const since = body.since || defaultSince;
  const until = body.until || today;
  const connection = await loadAdsConnection(env, session.companyId);
  let synced = 0;
  const accounts: Array<{ id: string; rows: number }> = [];
  for (const account of connection.ad_accounts ?? []) {
    const rows = await fetchInsights(env, account.id, connection.access_token, since, until);
    const count = await upsertInsights(env, session, account, rows);
    synced += count;
    accounts.push({ id: account.id, rows: count });
  }
  return json({ success: true, since, until, synced, accounts });
}

async function listSummary(request: Request, env: MetaEnv, session: AuthSession) {
  const url = new URL(request.url);
  const since = url.searchParams.get('since');
  const until = url.searchParams.get('until');
  const filters = [
    `company_id=eq.${encodeURIComponent(session.companyId)}`,
    since ? `insight_date=gte.${encodeURIComponent(since)}` : '',
    until ? `insight_date=lte.${encodeURIComponent(until)}` : '',
  ].filter(Boolean).join('&');
  const response = await supabaseRest(env, `meta_ads_insights_daily?select=ad_account_id,insight_date,currency,spend,impressions,reach,clicks,inline_link_clicks,leads,purchases,purchase_value&${filters}&order=insight_date.asc`);
  if (!response.ok) throw new Error(`Meta insights lookup failed: ${await response.text()}`);
  const rows = await response.json() as Array<Record<string, string | number | null>>;
  return json({ rows });
}

export async function handleMetaAdsRequest(request: Request, env: MetaEnv, session: AuthSession) {
  const path = new URL(request.url).pathname;
  try {
    if (request.method === 'POST' && path === '/api/integrations/meta/ads/sync') return syncInsights(request, env, session);
    if (request.method === 'GET' && path === '/api/integrations/meta/ads/insights') return listSummary(request, env, session);
    return null;
  } catch (error) {
    return json({ error: { code: 'META_ADS_ERROR', message: error instanceof Error ? error.message : 'Ошибка Meta Ads' } }, 500);
  }
}
