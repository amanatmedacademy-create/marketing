import type { Env } from './integrations';

type RecordValue = Record<string, unknown>;

const num = (value: unknown) => Number(value || 0);
const text = (value: unknown, fallback = '') => typeof value === 'string' && value.trim() ? value.trim() : fallback;

/**
 * Значения по умолчанию дублируют defaults из
 * supabase/migrations/202607290009_repair_analytics_schema.sql.
 * Нужны, чтобы отсутствующая строка настроек не обнуляла пороги:
 * при пустом объекте num() вернул бы 0 и любая кампания получила бы
 * рекомендацию «Масштабировать».
 */
const DEFAULT_SCORING_SETTINGS: RecordValue = {
  id: 'default',
  min_days: 4,
  min_leads: 10,
  scale_roas: 3.5,
  grow_roas: 2,
  observe_roas: 1.5,
  scale_target_rate: 55,
  grow_target_rate: 45,
  pause_target_rate: 35,
  frequency_alert: 4,
  unattributed_alert: 5,
  client_cookie_days: 365,
  click_id_days: 28,
  attribution_model: 'last_click',
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
  // Тело ответа Supabase содержит имена таблиц и структуру схемы —
  // оно уходит только в лог воркера, наружу не отдаётся.
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
  const spend = num(row.spend);
  const revenue = num(row.revenue);
  const leads = num(row.crm_leads);
  const targetRate = leads ? num(row.target_leads) * 100 / leads : 0;
  const roas = spend ? revenue / spend : 0;
  const days = num(row.active_days);
  if (days < num(settings.min_days) || leads < num(settings.min_leads)) return 'Недостаточно данных';
  if (roas >= num(settings.scale_roas) && targetRate >= num(settings.scale_target_rate)) return 'Масштабировать';
  if (roas >= num(settings.grow_roas) && targetRate >= num(settings.grow_target_rate)) return 'Растить';
  if (roas >= num(settings.observe_roas) && targetRate >= num(settings.pause_target_rate)) return 'Наблюдать';
  return 'Отключить';
}

export async function handleAnalytics(request: Request, env: Env, url: URL): Promise<Response | null> {
  if (url.pathname !== '/api/analytics/overview') return null;
  const days = Math.min(Math.max(Number(url.searchParams.get('days') || 7), 1), 365);
  const { from, to } = dateRange(days, url);
  const leadFilter = `and=(lead_created_at.gte.${from}T00:00:00Z,lead_created_at.lte.${to}T23:59:59Z)`;
  const adFilter = `and=(report_date.gte.${from},report_date.lte.${to})`;

  // allSettled вместо all: раньше отсутствие любой из пяти таблиц роняло
  // весь эндпоинт в 500 и дашборд оставался полностью пустым.
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

  // Лиды и реклама — базовые источники. Если недоступны оба, считать нечего:
  // отдаём 503 с перечнем источников, но без деталей ответа Supabase.
  if (unavailable.includes('marketing_leads') && unavailable.includes('marketing_ads')) {
    return new Response(
      JSON.stringify({
        error: 'Аналитика недоступна: не удалось прочитать данные из базы',
        unavailable,
        hint: 'Проверьте, что миграции supabase/migrations применены к проекту',
      }),
      { status: 503, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } },
    );
  }

  const settings = { ...DEFAULT_SCORING_SETTINGS, ...(settingsRows[0] || {}) };
  const campaignMap = new Map<string, RecordValue>();
  for (const ad of ads) {
    const key = text(ad.campaign_id) || `${text(ad.platform, 'Не определено')}:${text(ad.campaign_name, 'Без кампании')}`;
    const row = campaignMap.get(key) || {
      key,
      platform: text(ad.platform, 'Не определено'), source: text(ad.source, text(ad.platform, 'Не определено')),
      campaign_id: text(ad.campaign_id), campaign_name: text(ad.campaign_name, 'Без кампании'),
      utm_source: text(ad.utm_source), utm_medium: text(ad.utm_medium), utm_campaign: text(ad.utm_campaign),
      spend: 0, revenue: 0, impressions: 0, reach: 0, clicks: 0, link_clicks: 0,
      ads_leads: 0, crm_leads: 0, target_leads: 0, in_work: 0, rejected: 0, appointments: 0,
      arrived: 0, deals_in_work: 0, deals_rejected: 0, sales: 0, active_days: 0,
    };
    row.spend = num(row.spend) + num(ad.spend);
    row.revenue = num(row.revenue) + num(ad.revenue);
    row.impressions = num(row.impressions) + num(ad.impressions);
    row.reach = num(row.reach) + num(ad.reach);
    row.clicks = num(row.clicks) + num(ad.clicks);
    row.link_clicks = num(row.link_clicks) + num(ad.link_clicks);
    row.ads_leads = num(row.ads_leads) + num(ad.leads);
    const dates = new Set<string>(Array.isArray(row._dates) ? row._dates as string[] : []);
    dates.add(text(ad.report_date));
    row._dates = [...dates];
    row.active_days = dates.size;
    campaignMap.set(key, row);
  }

  const sourceKey = (lead: RecordValue) => text(lead.campaign_id) || `${text(lead.platform, text(lead.source, 'Не определено'))}:${text(lead.campaign, text(lead.utm_campaign, 'Без кампании'))}`;
  for (const lead of leads) {
    const key = sourceKey(lead);
    const row = campaignMap.get(key) || {
      key, platform: text(lead.platform, text(lead.source, 'Не определено')), source: text(lead.source, 'Не определено'),
      campaign_id: text(lead.campaign_id), campaign_name: text(lead.campaign, text(lead.utm_campaign, 'Без кампании')),
      utm_source: text(lead.utm_source), utm_medium: text(lead.utm_medium), utm_campaign: text(lead.utm_campaign),
      spend: 0, revenue: 0, impressions: 0, reach: 0, clicks: 0, link_clicks: 0, ads_leads: 0,
      crm_leads: 0, target_leads: 0, in_work: 0, rejected: 0, appointments: 0, arrived: 0,
      deals_in_work: 0, deals_rejected: 0, sales: 0, active_days: 0,
    };
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
    campaignMap.set(key, row);
  }

  const campaigns = [...campaignMap.values()].map((row): RecordValue => {
    delete row._dates;
    const spend = num(row.spend), revenue = num(row.revenue), impressions = num(row.impressions), clicks = num(row.clicks), linkClicks = num(row.link_clicks), crmLeads = num(row.crm_leads);
    return {
      ...row,
      roas: spend ? revenue / spend : 0,
      cpl: crmLeads ? spend / crmLeads : 0,
      cpm: impressions ? spend * 1000 / impressions : 0,
      ctr: impressions ? clicks * 100 / impressions : 0,
      link_ctr: impressions ? linkClicks * 100 / impressions : 0,
      frequency: num(row.reach) ? impressions / num(row.reach) : 0,
      recommendation: recommendation(row, settings),
    };
  }).sort((a, b) => num(b.revenue) - num(a.revenue));

  const platformMap = new Map<string, RecordValue>();
  for (const campaign of campaigns) {
    const key = text(campaign.platform, 'Не определено');
    const row = platformMap.get(key) || { platform: key, campaigns: 0, spend: 0, revenue: 0, leads: 0, target_leads: 0, arrived: 0, sales: 0, impressions: 0 };
    row.campaigns = num(row.campaigns) + 1;
    for (const field of ['spend','revenue','crm_leads','target_leads','arrived','sales','impressions']) row[field === 'crm_leads' ? 'leads' : field] = num(row[field === 'crm_leads' ? 'leads' : field]) + num(campaign[field]);
    platformMap.set(key, row);
  }
  const platforms = [...platformMap.values()].map((row) => ({ ...row, roas: num(row.spend) ? num(row.revenue) / num(row.spend) : 0, sale_rate: num(row.leads) ? num(row.sales) * 100 / num(row.leads) : 0 }));

  const hourly = Array.from({ length: 24 }, (_, hour) => ({ hour, leads: 0, appointments: 0, rate: 0 }));
  const weekdays = Array.from({ length: 7 }, (_, day) => ({ day, leads: 0, appointments: 0, rate: 0 }));
  const delays = Array.from({ length: 7 }, (_, index) => ({ day: index + 1, appointments: 0, rate: 0 }));
  for (const lead of leads) {
    const created = new Date(text(lead.lead_created_at));
    if (Number.isNaN(created.getTime())) continue;
    const h = created.getUTCHours();
    const d = (created.getUTCDay() + 6) % 7;
    hourly[h].leads += 1;
    weekdays[d].leads += 1;
    if (lead.appointment_at) {
      hourly[h].appointments += 1;
      weekdays[d].appointments += 1;
      const appointment = new Date(text(lead.appointment_at));
      const delay = Math.max(1, Math.min(7, Math.floor((appointment.getTime() - created.getTime()) / 86400000) + 1));
      delays[delay - 1].appointments += 1;
    }
  }
  hourly.forEach((row) => { row.rate = row.leads ? row.appointments * 100 / row.leads : 0; });
  weekdays.forEach((row) => { row.rate = row.leads ? row.appointments * 100 / row.leads : 0; });
  delays.forEach((row) => { row.rate = leads.length ? row.appointments * 100 / leads.length : 0; });

  const totals = campaigns.reduce<{ leads: number; target_leads: number; arrived: number; sales: number; spend: number; revenue: number }>((acc, row) => ({
    leads: acc.leads + num(row.crm_leads), target_leads: acc.target_leads + num(row.target_leads), arrived: acc.arrived + num(row.arrived),
    sales: acc.sales + num(row.sales), spend: acc.spend + num(row.spend), revenue: acc.revenue + num(row.revenue),
  }), { leads: 0, target_leads: 0, arrived: 0, sales: 0, spend: 0, revenue: 0 });

  return new Response(JSON.stringify({ period: { from, to, days }, totals, daily, platforms, campaigns, hourly, weekdays, delays, attribution: healthRows[0] || { total_leads: 0, unattributed_leads: 0, unattributed_rate: 0 }, settings, unavailable }), {
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}
