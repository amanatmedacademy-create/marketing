import type { Env } from './integrations';

type RecordValue = Record<string, unknown>;
type Level = 'platform' | 'account' | 'campaign' | 'adset' | 'ad';

const num = (value: unknown) => Number(value || 0);
const text = (value: unknown, fallback = '') => typeof value === 'string' && value.trim() ? value.trim() : fallback;

const DEFAULT_SCORING_SETTINGS: RecordValue = {
  id: 'default', min_days: 4, min_leads: 10, scale_roas: 3.5, grow_roas: 2,
  observe_roas: 1.5, scale_target_rate: 55, grow_target_rate: 45,
  pause_target_rate: 35, frequency_alert: 4, unattributed_alert: 5,
  client_cookie_days: 365, click_id_days: 28, attribution_model: 'last_click',
};

class AnalyticsQueryError extends Error {
  constructor(readonly resource: string, readonly status: number, readonly detail: string) {
    super(`Analytics query failed for ${resource} (${status})`);
    this.name = 'AnalyticsQueryError';
  }
}

async function query<T>(env: Env, resource: string, path: string): Promise<T> {
  const response = await fetch(`${env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/${path}`, {
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      'content-type': 'application/json',
    },
  });
  const body = await response.text();
  if (!response.ok) throw new AnalyticsQueryError(resource, response.status, body);
  return (body ? JSON.parse(body) : []) as T;
}

function dateRange(days: number, url: URL) {
  const to = url.searchParams.get('to') || new Date().toISOString().slice(0, 10);
  const end = new Date(`${to}T23:59:59.999Z`);
  const from = url.searchParams.get('from') || new Date(end.getTime() - (days - 1) * 86400000).toISOString().slice(0, 10);
  return { from, to };
}

function recommendation(row: RecordValue, settings: RecordValue) {
  const spend = num(row.spend), revenue = num(row.revenue), leads = num(row.crm_leads);
  const targetRate = leads ? num(row.target_leads) * 100 / leads : 0;
  const roas = spend ? revenue / spend : 0;
  const days = num(row.active_days);
  if (days < num(settings.min_days) || leads < num(settings.min_leads)) return 'Недостаточно данных';
  if (roas >= num(settings.scale_roas) && targetRate >= num(settings.scale_target_rate)) return 'Масштабировать';
  if (roas >= num(settings.grow_roas) && targetRate >= num(settings.grow_target_rate)) return 'Растить';
  if (roas >= num(settings.observe_roas) && targetRate >= num(settings.pause_target_rate)) return 'Наблюдать';
  return 'Отключить';
}

const metricFields = ['spend','revenue','impressions','reach','clicks','link_clicks','ads_leads','crm_leads','target_leads','in_work','rejected','appointments','arrived','deals_in_work','deals_rejected','sales'] as const;

function emptyMetrics(): RecordValue {
  return Object.fromEntries(metricFields.map((field) => [field, 0]));
}

function addMetrics(target: RecordValue, source: RecordValue) {
  for (const field of metricFields) target[field] = num(target[field]) + num(source[field]);
}

function finalize(row: RecordValue, settings: RecordValue) {
  const spend = num(row.spend), revenue = num(row.revenue), impressions = num(row.impressions);
  const clicks = num(row.clicks), linkClicks = num(row.link_clicks), crmLeads = num(row.crm_leads);
  const appointments = num(row.appointments), arrived = num(row.arrived), sales = num(row.sales);
  return {
    ...row,
    roas: spend ? revenue / spend : 0,
    romi: spend ? (revenue - spend) * 100 / spend : 0,
    cpl: crmLeads ? spend / crmLeads : 0,
    cost_per_target: num(row.target_leads) ? spend / num(row.target_leads) : 0,
    cost_per_appointment: appointments ? spend / appointments : 0,
    cost_per_arrival: arrived ? spend / arrived : 0,
    cac: sales ? spend / sales : 0,
    cpm: impressions ? spend * 1000 / impressions : 0,
    cpc: clicks ? spend / clicks : 0,
    ctr: impressions ? clicks * 100 / impressions : 0,
    link_ctr: impressions ? linkClicks * 100 / impressions : 0,
    frequency: num(row.reach) ? impressions / num(row.reach) : 0,
    recommendation: recommendation(row, settings),
  };
}

function normalizedPlatform(row: RecordValue) {
  return text(row.platform, text(row.source, 'Не определено'));
}

function identity(row: RecordValue) {
  return {
    platform: normalizedPlatform(row),
    source: text(row.source, normalizedPlatform(row)),
    account_id: text(row.account_id),
    account_name: text(row.account_name, text(row.account_id, 'Без кабинета')),
    campaign_id: text(row.campaign_id),
    campaign_name: text(row.campaign_name, text(row.campaign, text(row.utm_campaign, 'Без кампании'))),
    adset_id: text(row.adset_id),
    adset_name: text(row.adset_name, text(row.adset_id, 'Без группы')),
    ad_id: text(row.ad_id),
    ad_name: text(row.ad_name, text(row.creative_name, text(row.ad_id, 'Без объявления'))),
    utm_source: text(row.utm_source), utm_medium: text(row.utm_medium),
    utm_campaign: text(row.utm_campaign), utm_content: text(row.utm_content),
  };
}

function hierarchyKey(level: Level, row: ReturnType<typeof identity>) {
  const parts = [row.platform];
  if (level === 'platform') return parts.join('|');
  parts.push(row.account_id || row.account_name);
  if (level === 'account') return parts.join('|');
  parts.push(row.campaign_id || row.campaign_name);
  if (level === 'campaign') return parts.join('|');
  parts.push(row.adset_id || row.adset_name);
  if (level === 'adset') return parts.join('|');
  parts.push(row.ad_id || row.ad_name);
  return parts.join('|');
}

function parentKey(level: Level, row: ReturnType<typeof identity>) {
  if (level === 'platform') return null;
  if (level === 'account') return hierarchyKey('platform', row);
  if (level === 'campaign') return hierarchyKey('account', row);
  if (level === 'adset') return hierarchyKey('campaign', row);
  return hierarchyKey('adset', row);
}

export async function handleAnalytics(request: Request, env: Env, url: URL): Promise<Response | null> {
  if (url.pathname !== '/api/analytics/overview') return null;
  const days = Math.min(Math.max(Number(url.searchParams.get('days') || 7), 1), 365);
  const { from, to } = dateRange(days, url);
  const leadFilter = `and=(lead_created_at.gte.${from}T00:00:00Z,lead_created_at.lte.${to}T23:59:59Z)`;
  const adFilter = `and=(report_date.gte.${from},report_date.lte.${to})`;

  const settled = await Promise.allSettled([
    query<RecordValue[]>(env, 'marketing_leads', `marketing_leads?select=external_id,source,platform,campaign,stage,is_target,appointment_at,arrived_at,sold_at,sale_amount,lead_created_at,qualified_at,rejected_at,deal_created_at,deal_rejected_at,utm_source,utm_medium,utm_campaign,utm_content,campaign_id,adset_id,ad_id,internal_client_id,fbclid,gclid,ttclid,yclid,vk_click_id&${leadFilter}&limit=50000`),
    query<RecordValue[]>(env, 'marketing_ads', `marketing_ads?select=report_date,source,platform,account_id,account_name,campaign_id,campaign_name,adset_id,adset_name,ad_id,creative_name,status,impressions,reach,clicks,link_clicks,spend,leads,target_leads,arrived,sales,revenue,utm_source,utm_medium,utm_campaign,utm_content&${adFilter}&limit=50000`),
    query<RecordValue[]>(env, 'marketing_dashboard_daily', `marketing_dashboard_daily?select=*&date=gte.${from}&date=lte.${to}&order=date.asc`),
    query<RecordValue[]>(env, 'marketing_scoring_settings', 'marketing_scoring_settings?select=*&id=eq.default&limit=1'),
    query<RecordValue[]>(env, 'analytics_attribution_health', 'analytics_attribution_health?select=*'),
  ]);

  const unavailable: string[] = [];
  const unwrap = (result: PromiseSettledResult<RecordValue[]>, resource: string): RecordValue[] => {
    if (result.status === 'fulfilled') return result.value;
    unavailable.push(resource);
    console.error(`[analytics] источник ${resource} недоступен:`, result.reason);
    return [];
  };

  const leads = unwrap(settled[0], 'marketing_leads');
  const ads = unwrap(settled[1], 'marketing_ads');
  const daily = unwrap(settled[2], 'marketing_dashboard_daily');
  const settingsRows = unwrap(settled[3], 'marketing_scoring_settings');
  const healthRows = unwrap(settled[4], 'analytics_attribution_health');

  if (unavailable.includes('marketing_leads') && unavailable.includes('marketing_ads')) {
    return new Response(JSON.stringify({ error: 'Аналитика недоступна: не удалось прочитать данные из базы', unavailable }), {
      status: 503, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    });
  }

  const settings = { ...DEFAULT_SCORING_SETTINGS, ...(settingsRows[0] || {}) };
  const leafMap = new Map<string, RecordValue>();
  const datesByLeaf = new Map<string, Set<string>>();

  const ensureLeaf = (raw: RecordValue) => {
    const id = identity(raw);
    const key = hierarchyKey('ad', id);
    const existing = leafMap.get(key);
    if (existing) return existing;
    const row: RecordValue = { key, level: 'ad', parent_key: parentKey('ad', id), ...id, ...emptyMetrics(), active_days: 0 };
    leafMap.set(key, row);
    return row;
  };

  for (const ad of ads) {
    const row = ensureLeaf(ad);
    addMetrics(row, {
      spend: ad.spend, revenue: ad.revenue, impressions: ad.impressions, reach: ad.reach,
      clicks: ad.clicks, link_clicks: ad.link_clicks, ads_leads: ad.leads,
    });
    const dates = datesByLeaf.get(text(row.key)) || new Set<string>();
    dates.add(text(ad.report_date));
    datesByLeaf.set(text(row.key), dates);
    row.active_days = dates.size;
  }

  const adById = new Map<string, RecordValue>();
  const adsetById = new Map<string, RecordValue>();
  const campaignById = new Map<string, RecordValue>();
  for (const row of leafMap.values()) {
    if (text(row.ad_id)) adById.set(text(row.ad_id), row);
    if (text(row.adset_id) && !adsetById.has(text(row.adset_id))) adsetById.set(text(row.adset_id), row);
    if (text(row.campaign_id) && !campaignById.has(text(row.campaign_id))) campaignById.set(text(row.campaign_id), row);
  }

  for (const lead of leads) {
    const matched = (text(lead.ad_id) && adById.get(text(lead.ad_id)))
      || (text(lead.adset_id) && adsetById.get(text(lead.adset_id)))
      || (text(lead.campaign_id) && campaignById.get(text(lead.campaign_id)));
    const row = matched || ensureLeaf(lead);
    row.crm_leads = num(row.crm_leads) + 1;
    row.target_leads = num(row.target_leads) + (lead.is_target ? 1 : 0);
    row.appointments = num(row.appointments) + (lead.appointment_at ? 1 : 0);
    row.arrived = num(row.arrived) + (lead.arrived_at ? 1 : 0);
    row.sales = num(row.sales) + (lead.sold_at ? 1 : 0);
    row.revenue = num(row.revenue) + num(lead.sale_amount);
    row.rejected = num(row.rejected) + (lead.rejected_at ? 1 : 0);
    row.deals_in_work = num(row.deals_in_work) + (lead.deal_created_at && !lead.sold_at && !lead.deal_rejected_at ? 1 : 0);
    row.deals_rejected = num(row.deals_rejected) + (lead.deal_rejected_at ? 1 : 0);
    row.in_work = num(row.in_work) + (!lead.rejected_at && !lead.appointment_at && !lead.sold_at ? 1 : 0);
  }

  const hierarchyMap = new Map<string, RecordValue>();
  const ensureHierarchy = (level: Level, id: ReturnType<typeof identity>) => {
    const key = hierarchyKey(level, id);
    const existing = hierarchyMap.get(key);
    if (existing) return existing;
    const labels: Record<Level, string> = {
      platform: id.platform, account: id.account_name, campaign: id.campaign_name,
      adset: id.adset_name, ad: id.ad_name,
    };
    const row: RecordValue = { key, level, parent_key: parentKey(level, id), label: labels[level], ...id, ...emptyMetrics(), active_days: 0 };
    hierarchyMap.set(key, row);
    return row;
  };

  for (const leaf of leafMap.values()) {
    const id = identity(leaf);
    for (const level of ['platform','account','campaign','adset','ad'] as Level[]) {
      const target = ensureHierarchy(level, id);
      addMetrics(target, leaf);
      target.active_days = Math.max(num(target.active_days), num(leaf.active_days));
    }
  }

  const hierarchy = [...hierarchyMap.values()].map((row) => finalize(row, settings));
  const campaigns = hierarchy.filter((row) => row.level === 'campaign').sort((a, b) => num(b.revenue) - num(a.revenue));
  const platforms = hierarchy.filter((row) => row.level === 'platform').map((row) => ({
    ...row, platform: row.label, campaigns: campaigns.filter((campaign) => campaign.parent_key && String(campaign.key).startsWith(`${row.key}|`)).length,
    leads: num(row.crm_leads), sale_rate: num(row.crm_leads) ? num(row.sales) * 100 / num(row.crm_leads) : 0,
  }));

  const hourly = Array.from({ length: 24 }, (_, hour) => ({ hour, leads: 0, appointments: 0, rate: 0 }));
  const weekdays = Array.from({ length: 7 }, (_, day) => ({ day, leads: 0, appointments: 0, rate: 0 }));
  const delays = Array.from({ length: 7 }, (_, index) => ({ day: index + 1, appointments: 0, rate: 0 }));
  for (const lead of leads) {
    const created = new Date(text(lead.lead_created_at));
    if (Number.isNaN(created.getTime())) continue;
    const h = created.getUTCHours(), d = (created.getUTCDay() + 6) % 7;
    hourly[h].leads += 1; weekdays[d].leads += 1;
    if (lead.appointment_at) {
      hourly[h].appointments += 1; weekdays[d].appointments += 1;
      const appointment = new Date(text(lead.appointment_at));
      const delay = Math.max(1, Math.min(7, Math.floor((appointment.getTime() - created.getTime()) / 86400000) + 1));
      delays[delay - 1].appointments += 1;
    }
  }
  hourly.forEach((row) => { row.rate = row.leads ? row.appointments * 100 / row.leads : 0; });
  weekdays.forEach((row) => { row.rate = row.leads ? row.appointments * 100 / row.leads : 0; });
  delays.forEach((row) => { row.rate = leads.length ? row.appointments * 100 / leads.length : 0; });

  const totals = platforms.reduce<{ leads:number; target_leads:number; arrived:number; sales:number; spend:number; revenue:number }>((acc, row) => ({
    leads: acc.leads + num(row.crm_leads), target_leads: acc.target_leads + num(row.target_leads), arrived: acc.arrived + num(row.arrived),
    sales: acc.sales + num(row.sales), spend: acc.spend + num(row.spend), revenue: acc.revenue + num(row.revenue),
  }), { leads:0, target_leads:0, arrived:0, sales:0, spend:0, revenue:0 });

  return new Response(JSON.stringify({ period:{ from, to, days }, totals, daily, platforms, campaigns, hierarchy, hourly, weekdays, delays, attribution:healthRows[0] || { total_leads:0, unattributed_leads:0, unattributed_rate:0 }, settings, unavailable }), {
    headers: { 'content-type':'application/json; charset=utf-8', 'cache-control':'no-store' },
  });
}
