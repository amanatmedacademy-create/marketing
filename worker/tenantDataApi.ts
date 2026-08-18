import type { Env } from './integrations';
import { branchEq, branchScope, branchWriteFields, operationalEq, requireCompanyId, type TenantScopedEnv } from './tenantScope';

type Row = Record<string, unknown>;
type ScopedEnv = Env & TenantScopedEnv;

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});
const num = (value: unknown) => Number(value || 0);
const text = (value: unknown, fallback = '') => typeof value === 'string' && value.trim() ? value.trim() : fallback;

function dbHeaders(env: Env, extra: HeadersInit = {}): Headers {
  const headers = new Headers(extra);
  headers.set('apikey', env.SUPABASE_SERVICE_ROLE_KEY);
  headers.set('authorization', `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`);
  headers.set('accept', 'application/json');
  if (!headers.has('content-type')) headers.set('content-type', 'application/json');
  return headers;
}
async function db<T>(env: Env, path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/${path}`, { ...init, headers: dbHeaders(env, init.headers), cache: 'no-store' });
  const body = await response.text();
  if (!response.ok) throw new Error(`Tenant data DB ${response.status}: ${body.slice(0, 1200)}`);
  return (body ? JSON.parse(body) : null) as T;
}
async function refreshCrmMetrics(env: ScopedEnv): Promise<void> {
  const companyId = requireCompanyId(env);
  await db(env, 'rpc/refresh_crm_daily_metrics', { method: 'POST', headers: { prefer: 'return=minimal' }, body: JSON.stringify({ p_company_id: companyId, p_date_from: null, p_date_to: null }) });
}
function companyParam(companyId: string) { return `company_id=eq.${encodeURIComponent(companyId)}`; }
function branchParam(env: ScopedEnv): string { const value = branchEq(env); return value ? `&${value}` : ''; }
function requireWriteScope(env: ScopedEnv) { return branchWriteFields(env); }

async function leads(request: Request, env: ScopedEnv, url: URL): Promise<Response> {
  const companyId = requireCompanyId(env);
  if (request.method === 'GET') {
    const limit = Math.min(Math.max(Number(url.searchParams.get('limit') || 100), 1), 5000);
    const params = new URLSearchParams({ select: '*', company_id: `eq.${companyId}`, order: 'lead_created_at.desc.nullslast,created_at.desc', limit: String(limit) });
    const branch = branchEq(env); if (branch) params.set('branch_id', branch.replace(/^branch_id=/, ''));
    const stage = url.searchParams.get('stage'); const source = url.searchParams.get('source');
    if (stage) params.set('stage', `eq.${stage}`); if (source) params.set('source', `eq.${source}`);
    return json(await db<Row[]>(env, `marketing_leads?${params}`));
  }
  if (request.method === 'POST') {
    const payload = await request.json().catch(() => ({})) as Row;
    const scope = requireWriteScope(env);
    const rows = await db<Row[]>(env, 'marketing_leads?select=*', { method: 'POST', headers: { prefer: 'return=representation' }, body: JSON.stringify({ ...payload, ...scope }) });
    await refreshCrmMetrics(env); return json(rows, 201);
  }
  return json({ error: 'Method not allowed' }, 405);
}

async function leadById(request: Request, env: ScopedEnv, id: string): Promise<Response> {
  const companyId = requireCompanyId(env); if (!id) return json({ error: 'Lead id is required' }, 400);
  const scope = `id=eq.${encodeURIComponent(id)}&${companyParam(companyId)}${branchParam(env)}`;
  if (request.method === 'PATCH') {
    const payload = await request.json().catch(() => ({})) as Row; const write = requireWriteScope(env);
    const rows = await db<Row[]>(env, `marketing_leads?${scope}&select=*`, { method: 'PATCH', headers: { prefer: 'return=representation' }, body: JSON.stringify({ ...payload, ...write, updated_at: new Date().toISOString() }) });
    if (!rows.length) return json({ error: 'Lead not found in current branch' }, 404); await refreshCrmMetrics(env); return json(rows);
  }
  if (request.method === 'DELETE') {
    if (branchScope(env).all) return json({ error: 'Для удаления выберите конкретный филиал' }, 409);
    const rows = await db<Row[]>(env, `marketing_leads?${scope}&select=*`, { method: 'DELETE', headers: { prefer: 'return=representation' } });
    if (!rows.length) return json({ error: 'Lead not found in current branch' }, 404); await refreshCrmMetrics(env); return json(rows);
  }
  return json({ error: 'Method not allowed' }, 405);
}

async function calls(env: ScopedEnv, url: URL): Promise<Response> {
  const companyId = requireCompanyId(env); const limit = Math.min(Math.max(Number(url.searchParams.get('limit') || 100), 1), 5000);
  const params = new URLSearchParams({ select: '*', company_id: `eq.${companyId}`, order: 'started_at.desc', limit: String(limit) });
  const branch = branchEq(env); if (branch) params.set('branch_id', branch.replace(/^branch_id=/, ''));
  const operator = url.searchParams.get('operator'); const from = url.searchParams.get('from'); const to = url.searchParams.get('to');
  if (operator) params.set('operator_name', `eq.${operator}`); if (from) params.set('started_at', `gte.${from}`); if (to) params.append('started_at', `lte.${to}`);
  return json(await db<Row[]>(env, `marketing_calls?${params}`));
}

function operatorName(row: Row) { return text(row.operator_name, 'Не назначен'); }
function metric(rows: Row[], name: string, leads: Map<string, Row>) {
  const completed = rows.filter((row) => text(row.call_status) === 'COMPLETED');
  const leadFirst = new Map<string, string>();
  for (const row of rows) { const id = text(row.lead_id); const at = text(row.started_at); if (id && (!leadFirst.has(id) || at < (leadFirst.get(id) || at))) leadFirst.set(id, at); }
  let linkedLeads=0, funnelAppointments=0, arrived=0, sales=0, revenue=0;
  leadFirst.forEach((firstAt, id) => { const lead=leads.get(id); if(!lead)return; linkedLeads++; if(text(lead.appointment_at) >= firstAt) funnelAppointments++; if(text(lead.arrived_at) >= firstAt) arrived++; if(text(lead.sold_at) >= firstAt){ sales++; revenue += num(lead.sale_amount); } });
  const scored=rows.filter((row)=>Number.isFinite(Number(row.quality_score))); const quality=scored.length?Number((scored.reduce((sum,row)=>sum+num(row.quality_score),0)/scored.length).toFixed(1)):null;
  const avgDuration=completed.length?Number((completed.reduce((sum,row)=>sum+num(row.duration_seconds),0)/completed.length).toFixed(1)):0;
  return { name, calls: rows.length, completed: completed.length, appointments: rows.filter(r=>r.appointment_created===true).length, followUps: rows.filter(r=>text(r.next_action)).length, scored: scored.length, averageQuality: quality, averageDuration: avgDuration, linkedLeads, funnelAppointments, arrived, sales, revenue };
}
async function callAnalytics(env: ScopedEnv, url: URL): Promise<Response> {
  const companyId=requireCompanyId(env); const from=url.searchParams.get('from'); const to=url.searchParams.get('to'); const selectedName=url.searchParams.get('operator');
  const params=new URLSearchParams({select:'*',company_id:`eq.${companyId}`,order:'started_at.desc',limit:'50000'}); const branch=branchEq(env); if(branch)params.set('branch_id',branch.replace(/^branch_id=/,'')); if(from)params.set('started_at',`gte.${from}`); if(to)params.append('started_at',`lte.${to}`);
  const rows=await db<Row[]>(env,`marketing_calls?${params}`); const leadIds=[...new Set(rows.map(r=>text(r.lead_id)).filter(Boolean))];
  const leadRows=leadIds.length?await db<Row[]>(env,`marketing_leads?select=id,appointment_at,arrived_at,sold_at,sale_amount&${operationalEq(env)}&id=in.(${leadIds.map(encodeURIComponent).join(',')})&limit=50000`):[];
  const leadMap=new Map(leadRows.map(row=>[text(row.id),row])); const groups=new Map<string,Row[]>(); for(const row of rows){const name=operatorName(row);const group=groups.get(name)||[];group.push(row);groups.set(name,group);}
  const operators=[...groups.entries()].map(([name,items])=>metric(items,name,leadMap)).sort((a,b)=>b.appointments-a.appointments||b.calls-a.calls||a.name.localeCompare(b.name)); const overall=metric(rows,'Все операторы',leadMap); const selected=selectedName?operators.find(i=>i.name===selectedName)||metric([],selectedName,leadMap):overall;
  const recent=(selectedName?rows.filter(r=>operatorName(r)===selectedName):rows).slice(0,12); return json({overall,selected,operators,recent,range:{from:from||null,to:to||null,operator:selectedName||null}});
}

async function callOperators(env: ScopedEnv): Promise<Response> {
  const companyId=requireCompanyId(env); const rows=await db<Row[]>(env,`marketing_calls?select=operator_name,call_status,appointment_created,quality_score,next_action,loss_reason&${companyParam(companyId)}${branchParam(env)}&limit=50000`);
  const map=new Map<string,{operator_name:string;calls:number;pending_calls:number;appointments:number;qualityTotal:number;qualityCount:number;calls_without_next_action:number;lost_calls:number}>();
  for(const row of rows){const name=text(row.operator_name,'Не назначен');const item=map.get(name)||{operator_name:name,calls:0,pending_calls:0,appointments:0,qualityTotal:0,qualityCount:0,calls_without_next_action:0,lost_calls:0};const status=text(row.call_status);if(status==='PENDING')item.pending_calls++;if(status==='COMPLETED'){item.calls++;if(row.appointment_created===true)item.appointments++;const q=Number(row.quality_score);if(Number.isFinite(q)){item.qualityTotal+=q;item.qualityCount++;}if(!text(row.next_action))item.calls_without_next_action++;if(text(row.loss_reason))item.lost_calls++;}map.set(name,item);}
  return json([...map.values()].map(({qualityTotal,qualityCount,...item})=>({...item,average_quality_score:qualityCount?Number((qualityTotal/qualityCount).toFixed(1)):null})).sort((a,b)=>b.appointments-a.appointments||b.calls-a.calls));
}

async function dailyMetrics(env: ScopedEnv, url: URL): Promise<Response> {
  const companyId=requireCompanyId(env); const params=new URLSearchParams({select:'date,leads,target_leads,arrived,sales,spend,revenue',company_id:`eq.${companyId}`,order:'date.asc',limit:'50000'}); const branch=branchEq(env); if(branch)params.set('branch_id',branch.replace(/^branch_id=/,'')); const from=url.searchParams.get('from');const to=url.searchParams.get('to');if(from)params.set('date',`gte.${from}`);if(to)params.append('date',`lte.${to}`);const rows=await db<Row[]>(env,`marketing_daily_metrics?${params}`);const map=new Map<string,Row>();for(const row of rows){const d=text(row.date);const item=map.get(d)||{date:d,leads:0,target_leads:0,arrived:0,sales:0,spend:0,revenue:0};for(const key of ['leads','target_leads','arrived','sales','spend','revenue'])item[key]=num(item[key])+num(row[key]);map.set(d,item);}return json([...map.values()].sort((a,b)=>text(a.date).localeCompare(text(b.date))));
}
async function sourceSummary(env: ScopedEnv): Promise<Response> {
  const companyId=requireCompanyId(env);const rows=await db<Row[]>(env,`marketing_daily_metrics?select=source,platform,leads,target_leads,arrived,sales,spend,revenue&${companyParam(companyId)}${branchParam(env)}&limit=50000`);const map=new Map<string,Row>();for(const row of rows){const source=text(row.source,'Не определено');const platform=text(row.platform,'Не определено');const key=`${source}\u0000${platform}`;const item=map.get(key)||{source,platform,leads:0,target_leads:0,arrived:0,sales:0,spend:0,revenue:0};for(const metricKey of ['leads','target_leads','arrived','sales','spend','revenue'])item[metricKey]=num(item[metricKey])+num(row[metricKey]);map.set(key,item);}return json([...map.values()].sort((a,b)=>num(b.revenue)-num(a.revenue)||num(b.leads)-num(a.leads)));
}
async function ads(env: ScopedEnv): Promise<Response> {
  const companyId=requireCompanyId(env);const rows=await db<Row[]>(env,`marketing_ads?select=id,external_id,source,platform,account_id,account_name,campaign_id,campaign_name,adset_id,adset_name,ad_id,creative_name,creative_type,status,impressions,clicks,spend,leads,target_leads,arrived,sales,revenue,report_date&${companyParam(companyId)}${branchParam(env)}&order=report_date.asc&limit=50000`);const map=new Map<string,Row>();for(const row of rows){const rowKey=text(row.ad_id)||text(row.external_id)||text(row.id);const key=[rowKey,text(row.platform),text(row.account_id),text(row.campaign_id),text(row.adset_id)].join('|');const item=map.get(key)||{row_key:rowKey,source:row.source??null,platform:text(row.platform,'Не определено'),account_id:row.account_id??null,account_name:row.account_name??null,campaign_id:row.campaign_id??null,campaign_name:text(row.campaign_name,'Без кампании'),adset_id:row.adset_id??null,adset_name:row.adset_name??null,ad_id:row.ad_id??null,creative_name:row.creative_name??null,creative_type:row.creative_type??null,status:row.status??null,impressions:0,clicks:0,spend:0,leads:0,target_leads:0,arrived:0,sales:0,revenue:0,date_from:row.report_date??null,date_to:row.report_date??null};for(const metricKey of ['impressions','clicks','spend','leads','target_leads','arrived','sales','revenue'])item[metricKey]=num(item[metricKey])+num(row[metricKey]);const d=text(row.report_date);if(!text(item.date_from)||d<text(item.date_from))item.date_from=d;if(!text(item.date_to)||d>text(item.date_to))item.date_to=d;map.set(key,item);}return json([...map.values()].sort((a,b)=>num(b.revenue)-num(a.revenue)||num(b.spend)-num(a.spend)));
}
async function currencies(env: ScopedEnv): Promise<Response> {
  const companyId=requireCompanyId(env);const rows=await db<Row[]>(env,`marketing_ads?select=platform,account_id,account_name,currency,report_date&${companyParam(companyId)}${branchParam(env)}&account_id=not.is.null&order=report_date.desc&limit=50000`);const map=new Map<string,Row>();for(const row of rows){const raw=text(row.platform).toLowerCase();const platform=raw.includes('tiktok')?'TikTok':raw.includes('meta')||raw.includes('facebook')||raw.includes('instagram')?'Meta':'';const accountId=text(row.account_id).replace(/^act_/,'');if(!platform||!accountId)continue;const key=`${platform}:${accountId}`;if(!map.has(key))map.set(key,{platform,account_id:accountId,account_name:row.account_name??null,currency:text(row.currency,'USD').toUpperCase()});}return json({accounts:[...map.values()]});
}

export async function handleTenantDataApi(request: Request, env: Env, url: URL): Promise<Response | null> {
  const scoped=env as ScopedEnv;
  if(url.pathname==='/api/leads')return leads(request,scoped,url);
  if(url.pathname.startsWith('/api/leads/'))return leadById(request,scoped,decodeURIComponent(url.pathname.split('/').pop()||''));
  if(url.pathname==='/api/calls'&&request.method==='GET')return calls(scoped,url);
  if(url.pathname==='/api/calls/analytics'&&request.method==='GET')return callAnalytics(scoped,url);
  if(url.pathname==='/api/calls/operators'&&request.method==='GET')return callOperators(scoped);
  if(url.pathname==='/api/dashboard'&&request.method==='GET')return dailyMetrics(scoped,url);
  if(url.pathname==='/api/sources'&&request.method==='GET')return sourceSummary(scoped);
  if(url.pathname==='/api/ads'&&request.method==='GET')return ads(scoped);
  if(url.pathname==='/api/ads/currencies'&&request.method==='GET')return currencies(scoped);
  return null;
}
