import type { Env } from './integrations';
import { requireCompanyId, type TenantScopedEnv } from './tenantScope';

type RecordValue = Record<string, unknown>;
type Level = 'platform' | 'account' | 'campaign' | 'adset' | 'ad';
type Identity = ReturnType<typeof identity>;
type ScopedEnv = Env & TenantScopedEnv;

const num = (value: unknown) => Number(value || 0);
const text = (value: unknown, fallback = '') => typeof value === 'string' && value.trim() ? value.trim() : fallback;
const PAGE_SIZE = 1000;
const MAX_ROWS = 200000;

class AnalyticsQueryError extends Error {
  constructor(readonly resource: string, readonly status: number, readonly detail: string) {
    super(`Analytics query failed for ${resource} (${status})`);
    this.name = 'AnalyticsQueryError';
  }
}

async function queryPage<T>(env: Env, resource: string, path: string, offset = 0, limit = PAGE_SIZE): Promise<T[]> {
  const response = await fetch(`${env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/${path}`, {
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      'content-type': 'application/json',
      Range: `${offset}-${offset + limit - 1}`,
      Prefer: 'count=exact',
    },
  });
  const body = await response.text();
  if (!response.ok) throw new AnalyticsQueryError(resource, response.status, body);
  return (body ? JSON.parse(body) : []) as T[];
}

async function queryAll<T>(env: Env, resource: string, path: string): Promise<T[]> {
  const rows: T[] = [];
  for (let offset = 0; offset < MAX_ROWS; offset += PAGE_SIZE) {
    const page = await queryPage<T>(env, resource, path, offset, PAGE_SIZE);
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
  }
  throw new AnalyticsQueryError(resource, 413, `Выборка превышает безопасный предел ${MAX_ROWS} строк`);
}

async function queryOne<T>(env: Env, resource: string, path: string): Promise<T[]> {
  return queryPage<T>(env, resource, path, 0, 100);
}

function dateRange(days: number, url: URL) {
  const to = url.searchParams.get('to') || new Date().toISOString().slice(0, 10);
  const end = new Date(`${to}T23:59:59.999Z`);
  const from = url.searchParams.get('from') || new Date(end.getTime() - (days - 1) * 86400000).toISOString().slice(0, 10);
  const start = new Date(`${from}T00:00:00.000Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) throw new Error('Некорректный период аналитики');
  return { from, to };
}

const metricFields = ['spend','revenue','ad_revenue','crm_revenue','impressions','reach','clicks','link_clicks','ads_leads','crm_leads','target_leads','in_work','rejected','appointments','arrived','deals_in_work','deals_rejected','sales'] as const;
const emptyMetrics = (): RecordValue => Object.fromEntries(metricFields.map((field) => [field, 0]));
function addMetrics(target: RecordValue, source: RecordValue) {
  for (const field of metricFields) target[field] = num(target[field]) + num(source[field]);
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
    utm_source: text(row.utm_source),
    utm_medium: text(row.utm_medium),
    utm_campaign: text(row.utm_campaign),
    utm_content: text(row.utm_content),
  };
}

function hierarchyKey(level: Level, row: Identity) {
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

function parentKey(level: Level, row: Identity) {
  if (level === 'platform') return null;
  if (level === 'account') return hierarchyKey('platform', row);
  if (level === 'campaign') return hierarchyKey('account', row);
  if (level === 'adset') return hierarchyKey('campaign', row);
  return hierarchyKey('adset', row);
}

function finalize(row: RecordValue): RecordValue {
  const spend = num(row.spend), impressions = num(row.impressions), clicks = num(row.clicks), linkClicks = num(row.link_clicks);
  const reach = num(row.reach);
  return {
    ...row,
    roas: null,
    romi: null,
    cpl: null,
    cost_per_target: null,
    cost_per_appointment: null,
    cost_per_arrival: null,
    cac: null,
    cpm: impressions ? spend * 1000 / impressions : 0,
    cpc: clicks ? spend / clicks : 0,
    ctr: impressions ? clicks * 100 / impressions : 0,
    link_ctr: impressions ? linkClicks * 100 / impressions : 0,
    frequency: reach ? impressions / reach : 0,
    recommendation: 'Рассчитывается после конвертации валюты',
  };
}

function addIndex(map: Map<string, Identity[]>, key: string, value: Identity) {
  if (!key) return;
  const list = map.get(key) || [];
  if (!list.some((item) => hierarchyKey('ad', item) === hierarchyKey('ad', value))) list.push(value);
  map.set(key, list);
}

function resolveIdentity(map: Map<string, Identity[]>, idValue: string, platform: string): Identity | undefined {
  if (!idValue) return undefined;
  const matches = map.get(idValue) || [];
  if (matches.length === 1) return matches[0];
  const normalized = platform.toLowerCase();
  const platformMatches = matches.filter((item) => item.platform.toLowerCase() === normalized || item.source.toLowerCase() === normalized);
  return platformMatches.length === 1 ? platformMatches[0] : undefined;
}

function aggregateDaily(rows: RecordValue[]): RecordValue[] {
  const map = new Map<string, RecordValue>();
  for (const row of rows) {
    const date = text(row.date);
    if (!date) continue;
    const item = map.get(date) || { date, leads: 0, target_leads: 0, arrived: 0, sales: 0, spend: 0, revenue: 0 };
    for (const field of ['leads','target_leads','arrived','sales','spend','revenue']) item[field] = num(item[field]) + num(row[field]);
    map.set(date, item);
  }
  return [...map.values()].sort((a, b) => text(a.date).localeCompare(text(b.date)));
}

export async function handleAnalytics(_request: Request, env: Env, url: URL): Promise<Response | null> {
  if (url.pathname !== '/api/analytics/overview') return null;
  const companyId = requireCompanyId(env as ScopedEnv);
  const days = Math.min(Math.max(Number(url.searchParams.get('days') || 7), 1), 365);
  let range: { from: string; to: string };
  try { range = dateRange(days, url); }
  catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }), { status: 400, headers: { 'content-type':'application/json; charset=utf-8' } });
  }
  const { from, to } = range;
  const companyFilter = `company_id=eq.${encodeURIComponent(companyId)}`;
  const leadFilter = `and=(lead_created_at.gte.${from}T00:00:00Z,lead_created_at.lte.${to}T23:59:59Z)`;
  const adFilter = `and=(report_date.gte.${from},report_date.lte.${to})`;

  const settled = await Promise.allSettled([
    queryAll<RecordValue>(env, 'marketing_leads', `marketing_leads?select=external_id,source,platform,campaign,stage,is_target,appointment_at,arrived_at,sold_at,sale_amount,lead_created_at,qualified_at,rejected_at,deal_created_at,deal_rejected_at,utm_source,utm_medium,utm_campaign,utm_content,campaign_id,adset_id,ad_id,internal_client_id,fbclid,gclid,ttclid,yclid,vk_click_id&${companyFilter}&${leadFilter}&order=lead_created_at.asc`),
    queryAll<RecordValue>(env, 'marketing_ads', `marketing_ads?select=report_date,source,platform,account_id,account_name,campaign_id,campaign_name,adset_id,adset_name,ad_id,creative_name,status,impressions,reach,clicks,link_clicks,spend,leads,target_leads,arrived,sales,revenue,utm_source,utm_medium,utm_campaign,utm_content&${companyFilter}&${adFilter}&order=report_date.asc`),
    queryAll<RecordValue>(env, 'marketing_daily_metrics', `marketing_daily_metrics?select=date,leads,target_leads,arrived,sales,spend,revenue&${companyFilter}&date=gte.${from}&date=lte.${to}&order=date.asc`),
    queryOne<RecordValue>(env, 'marketing_scoring_settings', `marketing_scoring_settings?select=*&id=eq.default&${companyFilter}`),
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
  const daily = aggregateDaily(unwrap(settled[2], 'marketing_daily_metrics'));
  const settingsRows = unwrap(settled[3], 'marketing_scoring_settings');
  if (unavailable.includes('marketing_leads') && unavailable.includes('marketing_ads')) {
    return new Response(JSON.stringify({ error:'Аналитика недоступна: не удалось прочитать данные из базы', unavailable }), { status:503, headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'} });
  }

  const leafMap = new Map<string, RecordValue>();
  const datesByLeaf = new Map<string, Set<string>>();
  const ensureLeaf = (raw: RecordValue, attributionLevel = 'ad') => {
    const id = identity(raw), key = hierarchyKey('ad', id);
    const existing = leafMap.get(key);
    if (existing) return existing;
    const row: RecordValue = { key, level:'ad', parent_key:parentKey('ad', id), attribution_level:attributionLevel, ...id, ...emptyMetrics(), active_days:0 };
    leafMap.set(key, row);
    return row;
  };

  const adIndex = new Map<string, Identity[]>(), adsetIndex = new Map<string, Identity[]>(), campaignIndex = new Map<string, Identity[]>();
  for (const ad of ads) {
    const row = ensureLeaf(ad);
    addMetrics(row, { spend:ad.spend, ad_revenue:ad.revenue, impressions:ad.impressions, reach:ad.reach, clicks:ad.clicks, link_clicks:ad.link_clicks, ads_leads:ad.leads });
    const id = identity(ad);
    addIndex(adIndex,id.ad_id,id); addIndex(adsetIndex,id.adset_id,id); addIndex(campaignIndex,id.campaign_id,id);
    const dates = datesByLeaf.get(text(row.key)) || new Set<string>();
    dates.add(text(ad.report_date)); datesByLeaf.set(text(row.key),dates); row.active_days=dates.size;
  }

  let unattributedLeads = 0;
  for (const lead of leads) {
    let merged: RecordValue = { ...lead };
    let attributionLevel = 'unattributed';
    const platform = normalizedPlatform(lead);
    const adMatch = resolveIdentity(adIndex,text(lead.ad_id),platform);
    const adsetMatch = resolveIdentity(adsetIndex,text(lead.adset_id),platform);
    const campaignMatch = resolveIdentity(campaignIndex,text(lead.campaign_id),platform);
    if (adMatch) {
      merged={...adMatch,...lead,account_id:adMatch.account_id,account_name:adMatch.account_name,campaign_name:adMatch.campaign_name,adset_name:adMatch.adset_name,ad_name:adMatch.ad_name}; attributionLevel='ad';
    } else if (adsetMatch) {
      merged={...adsetMatch,...lead,account_id:adsetMatch.account_id,account_name:adsetMatch.account_name,campaign_name:adsetMatch.campaign_name,adset_name:adsetMatch.adset_name,ad_id:'',ad_name:'Без объявления · атрибуция по группе'}; attributionLevel='adset';
    } else if (campaignMatch) {
      merged={...campaignMatch,...lead,account_id:campaignMatch.account_id,account_name:campaignMatch.account_name,campaign_name:campaignMatch.campaign_name,adset_id:'',adset_name:'Без группы · атрибуция по кампании',ad_id:'',ad_name:'Без объявления · атрибуция по кампании'}; attributionLevel='campaign';
    } else unattributedLeads += 1;
    const row=ensureLeaf(merged,attributionLevel);
    row.crm_leads=num(row.crm_leads)+1;
    row.target_leads=num(row.target_leads)+(lead.is_target?1:0);
    row.appointments=num(row.appointments)+(lead.appointment_at?1:0);
    row.arrived=num(row.arrived)+(lead.arrived_at?1:0);
    row.sales=num(row.sales)+(lead.sold_at?1:0);
    row.crm_revenue=num(row.crm_revenue)+num(lead.sale_amount);
    row.rejected=num(row.rejected)+(lead.rejected_at?1:0);
    row.deals_in_work=num(row.deals_in_work)+(lead.deal_created_at&&!lead.sold_at&&!lead.deal_rejected_at?1:0);
    row.deals_rejected=num(row.deals_rejected)+(lead.deal_rejected_at?1:0);
    row.in_work=num(row.in_work)+(!lead.rejected_at&&!lead.appointment_at&&!lead.sold_at?1:0);
  }

  const crmAvailable = !unavailable.includes('marketing_leads');
  for (const leaf of leafMap.values()) leaf.revenue = crmAvailable ? num(leaf.crm_revenue) : num(leaf.ad_revenue);

  const hierarchyMap = new Map<string,RecordValue>();
  const ensureHierarchy=(level:Level,id:Identity)=>{
    const key=hierarchyKey(level,id), existing=hierarchyMap.get(key); if(existing) return existing;
    const labels:Record<Level,string>={platform:id.platform,account:id.account_name,campaign:id.campaign_name,adset:id.adset_name,ad:id.ad_name};
    const row:RecordValue={key,level,parent_key:parentKey(level,id),label:labels[level],...id,...emptyMetrics(),active_days:0}; hierarchyMap.set(key,row); return row;
  };
  for(const leaf of leafMap.values()){
    const id=identity(leaf);
    for(const level of ['platform','account','campaign','adset','ad'] as Level[]){const target=ensureHierarchy(level,id);addMetrics(target,leaf);target.active_days=Math.max(num(target.active_days),num(leaf.active_days));if(level==='ad')target.attribution_level=leaf.attribution_level;}
  }
  const hierarchy: RecordValue[]=[...hierarchyMap.values()].map(finalize);
  const campaigns: RecordValue[]=hierarchy.filter((row)=>row.level==='campaign').sort((a,b)=>num(b.revenue)-num(a.revenue));
  const platforms: RecordValue[]=hierarchy.filter((row)=>row.level==='platform').map((row): RecordValue=>({...row,platform:row.label,campaigns:campaigns.filter((campaign)=>String(campaign.key).startsWith(`${row.key}|`)).length,leads:num(row.crm_leads),sale_rate:num(row.crm_leads)?num(row.sales)*100/num(row.crm_leads):0}));

  const hourly=Array.from({length:24},(_,hour)=>({hour,leads:0,appointments:0,rate:0}));
  const weekdays=Array.from({length:7},(_,day)=>({day,leads:0,appointments:0,rate:0}));
  const delays=Array.from({length:7},(_,index)=>({day:index+1,appointments:0,rate:0}));
  for(const lead of leads){
    const created=new Date(text(lead.lead_created_at));
    if(Number.isNaN(created.getTime()))continue;
    const h=created.getUTCHours(),d=(created.getUTCDay()+6)%7;
    hourly[h].leads+=1;
    weekdays[d].leads+=1;
    if(lead.appointment_at){
      const appointment=new Date(text(lead.appointment_at));
      if(Number.isNaN(appointment.getTime()))continue;
      hourly[h].appointments+=1;
      weekdays[d].appointments+=1;
      const delay=Math.max(1,Math.min(7,Math.floor((appointment.getTime()-created.getTime())/86400000)+1));
      delays[delay-1].appointments+=1;
    }
  }
  hourly.forEach((row)=>{row.rate=row.leads?row.appointments*100/row.leads:0;});weekdays.forEach((row)=>{row.rate=row.leads?row.appointments*100/row.leads:0;});delays.forEach((row)=>{row.rate=leads.length?row.appointments*100/leads.length:0;});
  const totals=platforms.reduce<{leads:number;target_leads:number;arrived:number;sales:number;spend:number;revenue:number}>((acc,row)=>({leads:acc.leads+num(row.crm_leads),target_leads:acc.target_leads+num(row.target_leads),arrived:acc.arrived+num(row.arrived),sales:acc.sales+num(row.sales),spend:acc.spend+num(row.spend),revenue:acc.revenue+num(row.revenue)}),{leads:0,target_leads:0,arrived:0,sales:0,spend:0,revenue:0});
  const attribution={total_leads:leads.length,unattributed_leads:unattributedLeads,unattributed_rate:leads.length?unattributedLeads*100/leads.length:0};
  return new Response(JSON.stringify({period:{from,to,days},totals,daily,platforms,campaigns,hierarchy,hourly,weekdays,delays,attribution,settings:settingsRows[0]||{},unavailable,data_complete:unavailable.length===0}),{headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
}
