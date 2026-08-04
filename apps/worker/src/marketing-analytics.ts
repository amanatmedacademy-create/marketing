import type { AuthSession } from './auth';
import type { MetaEnv } from './meta-auth';

type PerformanceRow = {
  provider: string;
  metric_date: string;
  currency: string | null;
  spend: number | string;
  impressions: number | string;
  reach: number | string;
  clicks: number | string;
  link_clicks: number | string;
  leads: number | string;
  qualified_leads: number | string;
  sales: number | string;
  revenue: number | string;
  purchases: number | string;
  purchase_value: number | string;
};

type LegacyMetaRow = {
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
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});

function assertEnv(env: MetaEnv) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Supabase service environment is not configured');
  }
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
  if (!/^\d{4}-\d{2}-\d{2}$/.test(since) || !/^\d{4}-\d{2}-\d{2}$/.test(until)) {
    throw new Error('since and until must use YYYY-MM-DD');
  }
  if (since > until) throw new Error('since cannot be after until');
  return { since, until };
}

function numeric(value: string | number | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function aggregate(rows: PerformanceRow[]) {
  return rows.reduce((total, row) => {
    total.spend += numeric(row.spend);
    total.impressions += numeric(row.impressions);
    total.reach += numeric(row.reach);
    total.clicks += numeric(row.clicks);
    total.linkClicks += numeric(row.link_clicks);
    total.leads += numeric(row.leads);
    total.qualifiedLeads += numeric(row.qualified_leads);
    total.sales += numeric(row.sales) || numeric(row.purchases);
    total.revenue += numeric(row.revenue) || numeric(row.purchase_value);
    return total;
  }, {
    spend: 0,
    impressions: 0,
    reach: 0,
    clicks: 0,
    linkClicks: 0,
    leads: 0,
    qualifiedLeads: 0,
    sales: 0,
    revenue: 0,
  });
}

function derived(totals: ReturnType<typeof aggregate>) {
  return {
    ctr: totals.impressions ? totals.linkClicks / totals.impressions * 100 : null,
    cpc: totals.linkClicks ? totals.spend / totals.linkClicks : null,
    cpm: totals.impressions ? totals.spend / totals.impressions * 1000 : null,
    cpl: totals.leads ? totals.spend / totals.leads : null,
    cpql: totals.qualifiedLeads ? totals.spend / totals.qualifiedLeads : null,
    cac: totals.sales ? totals.spend / totals.sales : null,
    roas: totals.spend ? totals.revenue / totals.spend : null,
    roi: totals.spend ? (totals.revenue - totals.spend) / totals.spend * 100 : null,
  };
}

async function loadCanonical(env: MetaEnv, session: AuthSession, since: string, until: string, clientId?: string | null) {
  const filters = [
    `company_id=eq.${encodeURIComponent(session.companyId)}`,
    `metric_date=gte.${encodeURIComponent(since)}`,
    `metric_date=lte.${encodeURIComponent(until)}`,
    clientId ? `client_id=eq.${encodeURIComponent(clientId)}` : '',
  ].filter(Boolean).join('&');
  return supabaseRest<PerformanceRow[]>(env,
    `marketing_ad_performance_daily?select=provider,metric_date,currency,spend,impressions,reach,clicks,link_clicks,leads,qualified_leads,sales,revenue,purchases,purchase_value&${filters}&order=metric_date.asc`
  );
}

async function loadLegacyMeta(env: MetaEnv, session: AuthSession, since: string, until: string) {
  const filters = [
    `company_id=eq.${encodeURIComponent(session.companyId)}`,
    `insight_date=gte.${encodeURIComponent(since)}`,
    `insight_date=lte.${encodeURIComponent(until)}`,
  ].join('&');
  const rows = await supabaseRest<LegacyMetaRow[]>(env,
    `meta_ads_insights_daily?select=insight_date,currency,spend,impressions,reach,clicks,inline_link_clicks,leads,purchases,purchase_value&${filters}&order=insight_date.asc`
  );
  return rows.map<PerformanceRow>((row) => ({
    provider: 'meta_ads',
    metric_date: row.insight_date,
    currency: row.currency,
    spend: row.spend,
    impressions: row.impressions,
    reach: row.reach,
    clicks: row.clicks,
    link_clicks: row.inline_link_clicks,
    leads: row.leads,
    qualified_leads: 0,
    sales: row.purchases,
    revenue: row.purchase_value,
    purchases: row.purchases,
    purchase_value: row.purchase_value,
  }));
}

async function overview(request: Request, env: MetaEnv, session: AuthSession) {
  const url = new URL(request.url);
  const { since, until } = dateRange(url);
  const clientId = url.searchParams.get('clientId');

  let rows: PerformanceRow[] = [];
  let source: 'canonical' | 'legacy_meta' = 'canonical';
  try {
    rows = await loadCanonical(env, session, since, until, clientId);
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (!message.includes('404') && !message.includes('PGRST205')) throw error;
  }

  if (!rows.length && !clientId) {
    rows = await loadLegacyMeta(env, session, since, until);
    source = 'legacy_meta';
  }

  const totals = aggregate(rows);
  const byProvider = Object.entries(rows.reduce<Record<string, PerformanceRow[]>>((groups, row) => {
    (groups[row.provider] ||= []).push(row);
    return groups;
  }, {})).map(([provider, providerRows]) => {
    const providerTotals = aggregate(providerRows);
    return { provider, totals: providerTotals, metrics: derived(providerTotals) };
  });

  return json({
    range: { since, until },
    clientId,
    currency: rows.find((row) => row.currency)?.currency || 'KZT',
    source,
    totals,
    metrics: derived(totals),
    byProvider,
    rows: rows.length,
  });
}

export async function handleMarketingAnalyticsRequest(request: Request, env: MetaEnv, session: AuthSession) {
  const path = new URL(request.url).pathname;
  try {
    if (request.method === 'GET' && path === '/api/marketing/analytics/overview') {
      return overview(request, env, session);
    }
    return null;
  } catch (error) {
    return json({
      error: {
        code: 'MARKETING_ANALYTICS_ERROR',
        message: error instanceof Error ? error.message : 'Marketing analytics request failed',
      },
    }, 500);
  }
}
