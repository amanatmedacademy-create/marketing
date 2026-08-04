import type { AuthSession } from './auth';
import type { MetaEnv } from './meta-auth';

type PerformanceRow = {
  provider: string;
  metric_date: string;
  account_external_id?: string;
  account_name?: string | null;
  campaign_external_id?: string;
  campaign_name?: string | null;
  campaign_status?: string | null;
  ad_group_external_id?: string;
  ad_group_name?: string | null;
  currency: string | null;
  spend: number | string;
  impressions: number | string;
  reach: number | string;
  clicks: number | string;
  link_clicks: number | string;
  video_views?: number | string;
  leads: number | string;
  qualified_leads: number | string;
  arrived?: number | string;
  sales: number | string;
  revenue: number | string;
  purchases: number | string;
  purchase_value: number | string;
  synced_at?: string | null;
};

type LegacyMetaRow = {
  ad_account_id: string;
  campaign_id: string | null;
  campaign_name: string | null;
  adset_id: string | null;
  adset_name: string | null;
  insight_date: string;
  currency: string | null;
  spend: number | string;
  impressions: number | string;
  reach: number | string;
  clicks: number | string;
  inline_link_clicks: number | string;
  leads: number | string;
  purchases: number | string;
  purchase_value: number | string;
  synced_at: string | null;
};

type MetaConnectionRow = {
  ad_accounts?: Array<{ id?: string; name?: string; currency?: string; timezone_name?: string }>;
};

type OAuthConnectionRow = {
  accounts?: Array<Record<string, unknown>>;
};

type AccountMetadata = {
  name: string;
  currency?: string;
  timezone?: string;
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});

function assertEnv(env: MetaEnv) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('Supabase service environment is not configured');
}

async function supabaseRest<T>(env: MetaEnv, path: string): Promise<T> {
  assertEnv(env);
  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY!,
      authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      'content-type': 'application/json',
    },
  });
  if (!response.ok) throw new Error(`Marketing analytics lookup failed: ${response.status} ${await response.text()}`);
  return response.json() as Promise<T>;
}

function dateRange(url: URL) {
  const until = url.searchParams.get('until') || new Date().toISOString().slice(0, 10);
  const defaultSince = new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10);
  const since = url.searchParams.get('since') || defaultSince;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(since) || !/^\d{4}-\d{2}-\d{2}$/.test(until)) throw new Error('since and until must use YYYY-MM-DD');
  if (since > until) throw new Error('since cannot be after until');
  return { since, until };
}

function previousRange(since: string, until: string) {
  const start = new Date(`${since}T00:00:00Z`);
  const end = new Date(`${until}T00:00:00Z`);
  const days = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86400000) + 1);
  const previousEnd = new Date(start.getTime() - 86400000);
  const previousStart = new Date(previousEnd.getTime() - (days - 1) * 86400000);
  return { since: previousStart.toISOString().slice(0, 10), until: previousEnd.toISOString().slice(0, 10) };
}

function numeric(value: string | number | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeCurrency(value: string | null | undefined) {
  const currency = value?.trim().toUpperCase();
  return currency || 'UNKNOWN';
}

function aggregate(rows: PerformanceRow[]) {
  return rows.reduce((total, row) => {
    total.spend += numeric(row.spend);
    total.impressions += numeric(row.impressions);
    total.reach += numeric(row.reach);
    total.clicks += numeric(row.clicks);
    total.linkClicks += numeric(row.link_clicks);
    total.videoViews += numeric(row.video_views);
    total.leads += numeric(row.leads);
    total.qualifiedLeads += numeric(row.qualified_leads);
    total.arrived += numeric(row.arrived);
    total.sales += numeric(row.sales) || numeric(row.purchases);
    total.revenue += numeric(row.revenue) || numeric(row.purchase_value);
    return total;
  }, { spend: 0, impressions: 0, reach: 0, clicks: 0, linkClicks: 0, videoViews: 0, leads: 0, qualifiedLeads: 0, arrived: 0, sales: 0, revenue: 0 });
}

function derived(totals: ReturnType<typeof aggregate>) {
  const performanceClicks = totals.linkClicks || totals.clicks;
  return {
    ctr: totals.impressions ? performanceClicks / totals.impressions * 100 : null,
    cpc: performanceClicks ? totals.spend / performanceClicks : null,
    cpm: totals.impressions ? totals.spend / totals.impressions * 1000 : null,
    cpl: totals.leads ? totals.spend / totals.leads : null,
    cpql: totals.qualifiedLeads ? totals.spend / totals.qualifiedLeads : null,
    cac: totals.sales ? totals.spend / totals.sales : null,
    roas: totals.spend ? totals.revenue / totals.spend : null,
    roi: totals.spend ? (totals.revenue - totals.spend) / totals.spend * 100 : null,
    vtr: totals.impressions ? totals.videoViews / totals.impressions * 100 : null,
  };
}

function aggregateByCurrency(rows: PerformanceRow[]) {
  const groups = rows.reduce<Record<string, PerformanceRow[]>>((result, row) => {
    const currency = normalizeCurrency(row.currency);
    (result[currency] ||= []).push(row);
    return result;
  }, {});
  return Object.entries(groups)
    .map(([currency, currencyRows]) => {
      const totals = aggregate(currencyRows);
      return { currency, totals, metrics: derived(totals), rows: currencyRows.length };
    })
    .sort((a, b) => b.totals.spend - a.totals.spend);
}

async function loadCanonical(env: MetaEnv, session: AuthSession, since: string, until: string, clientId?: string | null, provider?: string | null) {
  const filters = [
    `company_id=eq.${encodeURIComponent(session.companyId)}`,
    `metric_date=gte.${encodeURIComponent(since)}`,
    `metric_date=lte.${encodeURIComponent(until)}`,
    clientId ? `client_id=eq.${encodeURIComponent(clientId)}` : '',
    provider ? `provider=eq.${encodeURIComponent(provider)}` : '',
  ].filter(Boolean).join('&');
  return supabaseRest<PerformanceRow[]>(env,
    `marketing_ad_performance_daily?select=provider,metric_date,account_external_id,account_name,campaign_external_id,campaign_name,campaign_status,ad_group_external_id,ad_group_name,currency,spend,impressions,reach,clicks,link_clicks,video_views,leads,qualified_leads,arrived,sales,revenue,purchases,purchase_value,synced_at&${filters}&order=metric_date.asc`,
  );
}

async function loadMetaAccountMap(env: MetaEnv, session: AuthSession) {
  const rows = await supabaseRest<MetaConnectionRow[]>(env,
    `meta_connections?select=ad_accounts&company_id=eq.${encodeURIComponent(session.companyId)}&product=eq.ads&status=eq.connected`,
  ).catch(() => []);
  const map = new Map<string, AccountMetadata>();
  for (const row of rows) {
    for (const account of row.ad_accounts ?? []) {
      if (!account.id) continue;
      const normalized = account.id.replace(/^act_/, '');
      const metadata = {
        name: account.name || account.id,
        currency: normalizeCurrency(account.currency),
        timezone: account.timezone_name,
      };
      map.set(normalized, metadata);
      map.set(`act_${normalized}`, metadata);
    }
  }
  return map;
}

function readText(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

async function loadOAuthAccountMap(env: MetaEnv, session: AuthSession, provider: string) {
  const rows = await supabaseRest<OAuthConnectionRow[]>(env,
    `marketing_oauth_connections?select=accounts&company_id=eq.${encodeURIComponent(session.companyId)}&provider=eq.${encodeURIComponent(provider)}&status=eq.connected&limit=1`,
  ).catch(() => []);
  const map = new Map<string, AccountMetadata>();
  for (const account of rows[0]?.accounts ?? []) {
    const id = readText(account, ['advertiser_id', 'customer_id', 'account_id', 'id']);
    if (!id) continue;
    map.set(id, {
      name: readText(account, ['advertiser_name', 'customer_name', 'account_name', 'name']) || id,
      currency: normalizeCurrency(readText(account, ['currency', 'currency_code'])),
      timezone: readText(account, ['timezone', 'timezone_name']),
    });
  }
  return map;
}

async function loadProviderAccountMap(env: MetaEnv, session: AuthSession, provider: string) {
  if (provider === 'meta_ads') return loadMetaAccountMap(env, session);
  return loadOAuthAccountMap(env, session, provider);
}

function applyAccountMetadata(rows: PerformanceRow[], accountMap: Map<string, AccountMetadata>) {
  return rows.map((row) => {
    const id = row.account_external_id || '';
    const normalized = id.replace(/^act_/, '');
    const account = accountMap.get(id) || accountMap.get(normalized) || accountMap.get(`act_${normalized}`);
    return {
      ...row,
      account_name: account?.name || row.account_name,
      // OAuth/provider account currency is authoritative. Row currency is only a fallback.
      currency: account?.currency && account.currency !== 'UNKNOWN' ? account.currency : normalizeCurrency(row.currency),
    };
  });
}

async function loadLegacyMeta(env: MetaEnv, session: AuthSession, since: string, until: string) {
  const filters = [`company_id=eq.${encodeURIComponent(session.companyId)}`, `insight_date=gte.${encodeURIComponent(since)}`, `insight_date=lte.${encodeURIComponent(until)}`].join('&');
  const [rows, accounts] = await Promise.all([
    supabaseRest<LegacyMetaRow[]>(env,
      `meta_ads_insights_daily?select=ad_account_id,campaign_id,campaign_name,adset_id,adset_name,insight_date,currency,spend,impressions,reach,clicks,inline_link_clicks,leads,purchases,purchase_value,synced_at&${filters}&order=insight_date.asc`,
    ),
    loadMetaAccountMap(env, session),
  ]);
  return rows.map<PerformanceRow>((row) => {
    const account = accounts.get(row.ad_account_id) || accounts.get(row.ad_account_id.replace(/^act_/, ''));
    return {
      provider: 'meta_ads',
      metric_date: row.insight_date,
      account_external_id: row.ad_account_id,
      account_name: account?.name || row.ad_account_id,
      campaign_external_id: row.campaign_id || '',
      campaign_name: row.campaign_name,
      campaign_status: null,
      ad_group_external_id: row.adset_id || '',
      ad_group_name: row.adset_name,
      currency: account?.currency && account.currency !== 'UNKNOWN' ? account.currency : normalizeCurrency(row.currency),
      spend: row.spend,
      impressions: row.impressions,
      reach: row.reach,
      clicks: row.clicks,
      link_clicks: row.inline_link_clicks,
      leads: row.leads,
      qualified_leads: 0,
      arrived: 0,
      sales: row.purchases,
      revenue: row.purchase_value,
      purchases: row.purchases,
      purchase_value: row.purchase_value,
      synced_at: row.synced_at,
    };
  });
}

async function loadProviderRows(env: MetaEnv, session: AuthSession, since: string, until: string, clientId: string | null, provider: string) {
  let rows: PerformanceRow[] = [];
  let source: 'canonical' | 'legacy_meta' = 'canonical';
  try {
    rows = await loadCanonical(env, session, since, until, clientId, provider);
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (!message.includes('404') && !message.includes('PGRST205')) throw error;
  }
  if (!rows.length && provider === 'meta_ads' && !clientId) {
    rows = await loadLegacyMeta(env, session, since, until);
    source = 'legacy_meta';
  }
  const accountMap = await loadProviderAccountMap(env, session, provider);
  return { rows: applyAccountMetadata(rows, accountMap), source };
}

async function overview(request: Request, env: MetaEnv, session: AuthSession) {
  const url = new URL(request.url);
  const { since, until } = dateRange(url);
  const clientId = url.searchParams.get('clientId');
  let rows: PerformanceRow[] = [];
  let source: 'canonical' | 'legacy_meta' = 'canonical';
  try { rows = await loadCanonical(env, session, since, until, clientId); }
  catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (!message.includes('404') && !message.includes('PGRST205')) throw error;
  }
  if (!rows.length && !clientId) { rows = await loadLegacyMeta(env, session, since, until); source = 'legacy_meta'; }
  const totals = aggregate(rows);
  const totalsByCurrency = aggregateByCurrency(rows);
  const byProvider = Object.entries(rows.reduce<Record<string, PerformanceRow[]>>((groups, row) => {
    (groups[row.provider] ||= []).push(row);
    return groups;
  }, {})).map(([provider, providerRows]) => {
    const providerTotals = aggregate(providerRows);
    return { provider, totals: providerTotals, metrics: derived(providerTotals), totalsByCurrency: aggregateByCurrency(providerRows) };
  });
  return json({
    range: { since, until },
    clientId,
    currency: totalsByCurrency.length === 1 ? totalsByCurrency[0].currency : 'MIXED',
    mixedCurrencies: totalsByCurrency.length > 1,
    totalsByCurrency,
    source,
    totals,
    metrics: derived(totals),
    byProvider,
    rows: rows.length,
  });
}

function buildCampaignPayload(rows: PerformanceRow[]) {
  const grouped = new Map<string, PerformanceRow[]>();
  for (const row of rows) {
    const key = `${row.account_external_id || 'unknown'}:${row.campaign_external_id || 'unknown'}`;
    const current = grouped.get(key) || [];
    current.push(row);
    grouped.set(key, current);
  }
  return [...grouped.values()].map((campaignRows) => {
    const totals = aggregate(campaignRows);
    const adGroupRows = campaignRows.reduce<Record<string, PerformanceRow[]>>((groups, row) => {
      if (row.ad_group_external_id) (groups[row.ad_group_external_id] ||= []).push(row);
      return groups;
    }, {});
    const adGroups = Object.entries(adGroupRows).map(([id, rowsForGroup]) => {
      const groupTotals = aggregate(rowsForGroup);
      return { id, name: rowsForGroup.find((row) => row.ad_group_name)?.ad_group_name || id, totals: groupTotals, metrics: derived(groupTotals) };
    }).sort((a, b) => b.totals.spend - a.totals.spend);
    return {
      campaignId: campaignRows[0]?.campaign_external_id || 'unknown',
      campaignName: campaignRows.find((row) => row.campaign_name)?.campaign_name || campaignRows[0]?.campaign_external_id || 'Без названия',
      accountId: campaignRows[0]?.account_external_id || 'unknown',
      accountName: campaignRows.find((row) => row.account_name)?.account_name || campaignRows[0]?.account_external_id || 'Неизвестный кабинет',
      status: campaignRows.find((row) => row.campaign_status)?.campaign_status || 'UNKNOWN',
      currency: normalizeCurrency(campaignRows.find((row) => row.currency)?.currency),
      totals,
      metrics: derived(totals),
      adGroups,
    };
  }).sort((a, b) => b.totals.spend - a.totals.spend);
}

function buildAccounts(rows: PerformanceRow[]) {
  const accountGroups = rows.reduce<Record<string, PerformanceRow[]>>((groups, row) => {
    const key = row.account_external_id || 'unknown';
    (groups[key] ||= []).push(row);
    return groups;
  }, {});
  return Object.entries(accountGroups).map(([id, accountRows]) => {
    const totals = aggregate(accountRows);
    return {
      accountId: id,
      accountName: accountRows.find((row) => row.account_name)?.account_name || id,
      currency: normalizeCurrency(accountRows.find((row) => row.currency)?.currency),
      campaignCount: new Set(accountRows.map((row) => row.campaign_external_id).filter(Boolean)).size,
      totals,
      metrics: derived(totals),
    };
  }).sort((a, b) => b.totals.spend - a.totals.spend);
}

function buildTrend(rows: PerformanceRow[]) {
  return Object.entries(rows.reduce<Record<string, PerformanceRow[]>>((groups, row) => {
    (groups[row.metric_date] ||= []).push(row);
    return groups;
  }, {})).sort(([a], [b]) => a.localeCompare(b)).map(([date, dateRows]) => ({ date, ...aggregate(dateRows) }));
}

async function tiktokCampaigns(request: Request, env: MetaEnv, session: AuthSession) {
  const url = new URL(request.url);
  const { since, until } = dateRange(url);
  const previous = previousRange(since, until);
  const clientId = url.searchParams.get('clientId');
  const accountId = url.searchParams.get('accountId');
  const [currentResult, previousResult] = await Promise.all([
    loadProviderRows(env, session, since, until, clientId, 'tiktok_ads'),
    loadProviderRows(env, session, previous.since, previous.until, clientId, 'tiktok_ads'),
  ]);
  const allCurrentRows = currentResult.rows;
  const currentRows = accountId ? allCurrentRows.filter((row) => row.account_external_id === accountId) : allCurrentRows;
  const previousRows = accountId ? previousResult.rows.filter((row) => row.account_external_id === accountId) : previousResult.rows;
  const totals = aggregate(currentRows);
  const previousTotals = aggregate(previousRows);
  const totalsByCurrency = aggregateByCurrency(currentRows);
  const previousTotalsByCurrency = aggregateByCurrency(previousRows);
  return json({
    range: { since, until },
    previousRange: previous,
    clientId,
    accountId,
    provider: 'tiktok_ads',
    source: currentResult.source,
    currency: totalsByCurrency.length === 1 ? totalsByCurrency[0].currency : totalsByCurrency.length ? 'MIXED' : 'UNKNOWN',
    mixedCurrencies: totalsByCurrency.length > 1,
    totalsByCurrency,
    previousTotalsByCurrency,
    totals,
    metrics: derived(totals),
    previousTotals,
    previousMetrics: derived(previousTotals),
    accounts: buildAccounts(allCurrentRows),
    campaigns: buildCampaignPayload(currentRows),
    trend: buildTrend(currentRows),
  });
}

async function metaCampaigns(request: Request, env: MetaEnv, session: AuthSession) {
  const url = new URL(request.url);
  const { since, until } = dateRange(url);
  const previous = previousRange(since, until);
  const clientId = url.searchParams.get('clientId');
  const accountId = url.searchParams.get('accountId');
  const [currentResult, previousResult] = await Promise.all([
    loadProviderRows(env, session, since, until, clientId, 'meta_ads'),
    loadProviderRows(env, session, previous.since, previous.until, clientId, 'meta_ads'),
  ]);
  const allCurrentRows = currentResult.rows;
  const currentRows = accountId ? allCurrentRows.filter((row) => row.account_external_id === accountId) : allCurrentRows;
  const previousRows = accountId ? previousResult.rows.filter((row) => row.account_external_id === accountId) : previousResult.rows;
  const accounts = buildAccounts(allCurrentRows);
  const totals = aggregate(currentRows);
  const previousTotals = aggregate(previousRows);
  const totalsByCurrency = aggregateByCurrency(currentRows);
  const previousTotalsByCurrency = aggregateByCurrency(previousRows);
  const lastMetricDate = allCurrentRows.map((row) => row.metric_date).sort().at(-1) || null;
  const lastSyncedAt = allCurrentRows.map((row) => row.synced_at).filter((value): value is string => Boolean(value)).sort().at(-1) || null;
  return json({
    range: { since, until },
    previousRange: previous,
    clientId,
    accountId,
    provider: 'meta_ads',
    source: currentResult.source,
    currency: totalsByCurrency.length === 1 ? totalsByCurrency[0].currency : totalsByCurrency.length ? 'MIXED' : 'UNKNOWN',
    mixedCurrencies: totalsByCurrency.length > 1,
    totalsByCurrency,
    previousTotalsByCurrency,
    totals,
    metrics: derived(totals),
    previousTotals,
    previousMetrics: derived(previousTotals),
    accounts,
    campaigns: buildCampaignPayload(currentRows),
    trend: buildTrend(currentRows),
    freshness: { lastMetricDate, lastSyncedAt },
  });
}

export async function handleMarketingAnalyticsRequest(request: Request, env: MetaEnv, session: AuthSession) {
  const path = new URL(request.url).pathname;
  try {
    if (request.method === 'GET' && path === '/api/marketing/analytics/overview') return overview(request, env, session);
    if (request.method === 'GET' && path === '/api/marketing/analytics/tiktok/campaigns') return tiktokCampaigns(request, env, session);
    if (request.method === 'GET' && path === '/api/marketing/analytics/meta/campaigns') return metaCampaigns(request, env, session);
    return null;
  } catch (error) {
    return json({ error: { code: 'MARKETING_ANALYTICS_ERROR', message: error instanceof Error ? error.message : 'Marketing analytics request failed' } }, 500);
  }
}
