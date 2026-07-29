import type { Env } from './integrations';

type Row = Record<string, unknown>;
const num = (value: unknown) => Number(value || 0);
const text = (value: unknown, fallback = '') => typeof value === 'string' && value.trim() ? value.trim() : fallback;

async function query<T>(env: Env, path: string): Promise<T> {
  const response = await fetch(`${env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/${path}`, {
    headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` },
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`Ad manager query failed (${response.status})`);
  return (body ? JSON.parse(body) : []) as T;
}

function dateRange(days: number, url: URL) {
  const to = url.searchParams.get('to') || new Date().toISOString().slice(0, 10);
  const end = new Date(`${to}T23:59:59.999Z`);
  const from = url.searchParams.get('from') || new Date(end.getTime() - (days - 1) * 86400000).toISOString().slice(0, 10);
  return { from, to };
}

export async function handleAdManager(_request: Request, env: Env, url: URL): Promise<Response | null> {
  if (url.pathname !== '/api/analytics/ad-manager') return null;
  const days = Math.min(Math.max(Number(url.searchParams.get('days') || 30), 1), 365);
  const { from, to } = dateRange(days, url);
  const rows = await query<Row[]>(env, `marketing_ads?select=report_date,source,platform,account_id,account_name,campaign_id,campaign_name,adset_id,adset_name,ad_id,creative_name,status,impressions,reach,clicks,link_clicks,spend,leads,target_leads,arrived,sales,revenue,utm_source,utm_medium,utm_campaign,utm_content&and=(report_date.gte.${from},report_date.lte.${to})&limit=50000`);

  const map = new Map<string, Row>();
  for (const row of rows) {
    const key = `${text(row.account_id)}:${text(row.campaign_id)}:${text(row.adset_id)}:${text(row.ad_id)}`;
    const item = map.get(key) || {
      key,
      account_id: text(row.account_id), account_name: text(row.account_name, 'Без названия'),
      campaign_id: text(row.campaign_id), campaign_name: text(row.campaign_name, 'Без кампании'),
      adset_id: text(row.adset_id), adset_name: text(row.adset_name, 'Без группы'),
      ad_id: text(row.ad_id), ad_name: text(row.creative_name, 'Без объявления'),
      source: text(row.source), platform: text(row.platform), status: text(row.status, 'UNKNOWN'),
      utm_source: text(row.utm_source), utm_medium: text(row.utm_medium), utm_campaign: text(row.utm_campaign), utm_content: text(row.utm_content),
      impressions: 0, reach: 0, clicks: 0, link_clicks: 0, spend: 0, leads: 0, target_leads: 0, arrived: 0, sales: 0, revenue: 0,
    };
    for (const field of ['impressions','reach','clicks','link_clicks','spend','leads','target_leads','arrived','sales','revenue']) item[field] = num(item[field]) + num(row[field]);
    map.set(key, item);
  }

  const result = [...map.values()].map((item) => {
    const impressions = num(item.impressions), clicks = num(item.clicks), linkClicks = num(item.link_clicks), spend = num(item.spend), leads = num(item.leads), reach = num(item.reach);
    return {
      ...item,
      frequency: reach ? impressions / reach : 0,
      cpm: impressions ? spend * 1000 / impressions : 0,
      ctr: impressions ? clicks * 100 / impressions : 0,
      link_ctr: impressions ? linkClicks * 100 / impressions : 0,
      cpc: clicks ? spend / clicks : 0,
      cost_per_result: leads ? spend / leads : 0,
    };
  });

  const accounts = Array.from(new Map(result.map((item) => [String(item.account_id), { id: item.account_id, name: item.account_name }])).values());
  return new Response(JSON.stringify({ period: { from, to, days }, accounts, rows: result }), {
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}
