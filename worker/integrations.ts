export interface AssetFetcher {
  fetch(request: Request): Promise<Response>;
}

export interface WorkerExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
}

export interface WorkerScheduledController {
  cron: string;
  scheduledTime: number;
}

export interface Env {
  ASSETS: AssetFetcher;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  APP_ORIGIN?: string;
  SYNC_API_KEY?: string;
  N8N_WEBHOOK_SECRET?: string;
  BITRIX_WEBHOOK_BASE_URL?: string;
  BITRIX_OUTBOUND_TOKEN?: string;
  BITRIX_ENTITY_TYPE_ID?: string;
  BITRIX_SYNC_DAYS?: string;
  BITRIX_TARGET_STAGE_IDS?: string;
  BITRIX_ARRIVED_STAGE_IDS?: string;
  BITRIX_SALE_STAGE_IDS?: string;
  BITRIX_APPOINTMENT_FIELD?: string;
  BITRIX_TARGET_FIELD?: string;
  BITRIX_ARRIVED_FIELD?: string;
  BITRIX_SALE_DATE_FIELD?: string;
  BITRIX_SALE_AMOUNT_FIELD?: string;
  BITRIX_NEXT_ACTION_FIELD?: string;
  BITRIX_SOURCE_FIELD?: string;
  BITRIX_CAMPAIGN_FIELD?: string;
  META_ACCESS_TOKEN?: string;
  META_AD_ACCOUNT_IDS?: string;
  META_GRAPH_VERSION?: string;
  META_WEBHOOK_VERIFY_TOKEN?: string;
  META_APP_SECRET?: string;
  TIKTOK_ACCESS_TOKEN?: string;
  TIKTOK_ADVERTISER_IDS?: string;
  TIKTOK_API_BASE?: string;
  TIKTOK_WEBHOOK_SECRET?: string;
}

type JsonRecord = Record<string, unknown>;
type SyncSource = 'bitrix' | 'meta' | 'tiktok';

interface SyncWindow {
  from: string;
  to: string;
}

interface SyncResult {
  source: SyncSource;
  fetched: number;
  written: number;
  from: string;
  to: string;
  skipped?: boolean;
  reason?: string;
}

interface NormalizedLead {
  external_id: string;
  name: string;
  phone: string;
  email: string | null;
  source: string;
  platform: string;
  campaign: string | null;
  manager: string | null;
  stage: string;
  next_action: string | null;
  first_message: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  utm_term: string | null;
  campaign_id: string | null;
  adset_id: string | null;
  ad_id: string | null;
  lead_created_at: string;
  appointment_at: string | null;
  arrived_at: string | null;
  sold_at: string | null;
  is_target: boolean;
  sale_amount: number;
  metadata: JsonRecord;
}

const jsonResponse = (data: unknown, status = 200, headers: HeadersInit = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...headers,
    },
  });

const corsHeaders = (request: Request, env: Env): HeadersInit => {
  const origin = request.headers.get('origin');
  if (!origin) return {};
  const allowedOrigin = env.APP_ORIGIN || new URL(request.url).origin;
  return origin === allowedOrigin
    ? {
        'access-control-allow-origin': origin,
        'access-control-allow-credentials': 'true',
        vary: 'origin',
      }
    : {};
};

const supabaseHeaders = (env: Env, extra: HeadersInit = {}): HeadersInit => ({
  apikey: env.SUPABASE_SERVICE_ROLE_KEY,
  authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
  'content-type': 'application/json',
  ...extra,
});

async function supabaseRequest(env: Env, path: string, init: RequestInit = {}): Promise<Response> {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('Supabase is not configured');
  return fetch(`${env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/${path}`, {
    ...init,
    headers: supabaseHeaders(env, init.headers),
  });
}

async function readSupabaseJson<T>(response: Response, label: string): Promise<T> {
  const body = await response.text();
  if (!response.ok) throw new Error(`${label}: ${response.status} ${body}`);
  return (body ? JSON.parse(body) : null) as T;
}

async function upsertRows(env: Env, table: string, rows: JsonRecord[], onConflict: string): Promise<number> {
  if (!rows.length) return 0;
  const response = await supabaseRequest(env, `${table}?on_conflict=${encodeURIComponent(onConflict)}`, {
    method: 'POST',
    headers: { prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(rows),
  });
  await readSupabaseJson<unknown>(response, `Upsert ${table}`);
  return rows.length;
}

async function insertRun(env: Env, source: string, window: SyncWindow): Promise<string | null> {
  try {
    const response = await supabaseRequest(env, 'integration_runs', {
      method: 'POST',
      headers: { prefer: 'return=representation' },
      body: JSON.stringify({ source, status: 'running', started_at: new Date().toISOString(), date_from: window.from, date_to: window.to }),
    });
    const rows = await readSupabaseJson<Array<{ id: string }>>(response, 'Create integration run');
    return rows[0]?.id || null;
  } catch (error) {
    console.error('Unable to create integration run', error);
    return null;
  }
}

async function finishRun(env: Env, id: string | null, status: 'success' | 'failed', result?: SyncResult, error?: unknown): Promise<void> {
  if (!id) return;
  try {
    const response = await supabaseRequest(env, `integration_runs?id=eq.${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { prefer: 'return=minimal' },
      body: JSON.stringify({
        status,
        finished_at: new Date().toISOString(),
        fetched: result?.fetched || 0,
        written: result?.written || 0,
        error: error instanceof Error ? error.message : error ? String(error) : null,
        metadata: result || {},
      }),
    });
    await readSupabaseJson<unknown>(response, 'Finish integration run');
  } catch (finishError) {
    console.error('Unable to finish integration run', finishError);
  }
}

const parseCsv = (value?: string): string[] => (value || '').split(',').map((item) => item.trim()).filter(Boolean);
const isoDate = (date: Date): string => date.toISOString().slice(0, 10);

function buildWindow(days: number, from?: string, to?: string): SyncWindow {
  const end = to ? new Date(`${to}T23:59:59.999Z`) : new Date();
  const start = from ? new Date(`${from}T00:00:00.000Z`) : new Date(end.getTime() - (days - 1) * 86400000);
  return { from: isoDate(start), to: isoDate(end) };
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function asString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value.trim() || null;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return null;
}

function asNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value.replace(/\s/g, '').replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function asBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  return ['1', 'y', 'yes', 'true', 'да'].includes(String(value || '').toLowerCase());
}

function asIsoDateTime(value: unknown): string | null {
  const text = asString(value);
  if (!text) return null;
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function getField(record: JsonRecord, fieldName?: string): unknown {
  if (!fieldName) return undefined;
  if (fieldName in record) return record[fieldName];
  const lower = fieldName.toLowerCase();
  const key = Object.keys(record).find((candidate) => candidate.toLowerCase() === lower);
  return key ? record[key] : undefined;
}

function firstValue(record: JsonRecord, names: Array<string | undefined>): unknown {
  for (const name of names) {
    const value = getField(record, name);
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return undefined;
}

function firstText(record: JsonRecord, names: Array<string | undefined>): string | null {
  return asString(firstValue(record, names));
}

function firstCommunication(item: JsonRecord, kind: 'PHONE' | 'EMAIL'): string | null {
  const direct = firstValue(item, [kind, kind.toLowerCase(), kind === 'PHONE' ? 'phone' : 'email']);
  if (Array.isArray(direct)) {
    for (const entry of direct) {
      const value = asString(asRecord(entry).VALUE ?? asRecord(entry).value ?? entry);
      if (value) return value;
    }
  }
  const directText = asString(direct);
  if (directText) return directText;
  const fm = asRecord(item.fm);
  const entries = fm[kind] ?? fm[kind.toLowerCase()];
  if (Array.isArray(entries)) {
    for (const entry of entries) {
      const data = asRecord(entry);
      const value = asString(data.VALUE ?? data.value);
      if (value) return value;
    }
  }
  return null;
}

function platformFromSource(source: string | null): string {
  const value = (source || '').toLowerCase();
  if (/meta|facebook|instagram|fb|инстаграм/.test(value)) return 'Meta';
  if (/tiktok|tik tok|тикток/.test(value)) return 'TikTok';
  if (/google/.test(value)) return 'Google';
  if (/yandex|яндекс/.test(value)) return 'Яндекс';
  if (/organic|органик|сарафан|recommend/.test(value)) return 'Органика';
  return source || 'Не определено';
}

function normalizeBitrixItem(item: JsonRecord, entityTypeId: number, env: Env): NormalizedLead {
  const id = firstText(item, ['id', 'ID']) || crypto.randomUUID();
  const stage = firstText(item, ['stageId', 'statusId', 'STAGE_ID', 'STATUS_ID']) || 'Не определено';
  const targetStages = new Set(parseCsv(env.BITRIX_TARGET_STAGE_IDS));
  const arrivedStages = new Set(parseCsv(env.BITRIX_ARRIVED_STAGE_IDS));
  const saleStages = new Set(parseCsv(env.BITRIX_SALE_STAGE_IDS));
  const firstName = firstText(item, ['name', 'NAME']);
  const lastName = firstText(item, ['lastName', 'LAST_NAME']);
  const title = firstText(item, ['title', 'TITLE']);
  const fullName = [firstName, lastName].filter(Boolean).join(' ') || title || `Bitrix ${id}`;
  const utmSource = firstText(item, [env.BITRIX_SOURCE_FIELD, 'utmSource', 'UTM_SOURCE', 'sourceId', 'SOURCE_ID']);
  const utmMedium = firstText(item, ['utmMedium', 'UTM_MEDIUM']);
  const platform = platformFromSource(`${utmSource || ''} ${utmMedium || ''}`);
  const source = utmSource || platform;
  const targetValue = getField(item, env.BITRIX_TARGET_FIELD);
  const arrivedValue = getField(item, env.BITRIX_ARRIVED_FIELD);
  const saleDateValue = firstValue(item, [env.BITRIX_SALE_DATE_FIELD, 'closedTime', 'CLOSEDATE']);
  const appointmentValue = firstValue(item, [env.BITRIX_APPOINTMENT_FIELD]);
  const leadCreatedAt = asIsoDateTime(firstValue(item, ['createdTime', 'dateCreate', 'DATE_CREATE'])) || new Date().toISOString();
  const sold = saleStages.has(stage) || Boolean(asIsoDateTime(saleDateValue));
  const arrived = arrivedStages.has(stage) || sold || asBoolean(arrivedValue);
  return {
    external_id: `bitrix:${entityTypeId}:${id}`,
    name: fullName,
    phone: firstCommunication(item, 'PHONE') || '',
    email: firstCommunication(item, 'EMAIL'),
    source,
    platform,
    campaign: firstText(item, [env.BITRIX_CAMPAIGN_FIELD, 'utmCampaign', 'UTM_CAMPAIGN']),
    manager: firstText(item, ['assignedById', 'ASSIGNED_BY_ID']),
    stage,
    next_action: firstText(item, [env.BITRIX_NEXT_ACTION_FIELD, 'comments', 'COMMENTS']),
    first_message: firstText(item, ['comments', 'COMMENTS']),
    utm_source: utmSource,
    utm_medium: utmMedium,
    utm_campaign: firstText(item, ['utmCampaign', 'UTM_CAMPAIGN']),
    utm_content: firstText(item, ['utmContent', 'UTM_CONTENT']),
    utm_term: firstText(item, ['utmTerm', 'UTM_TERM']),
    campaign_id: firstText(item, ['campaignId', 'CAMPAIGN_ID']),
    adset_id: firstText(item, ['adsetId', 'ADSET_ID']),
    ad_id: firstText(item, ['adId', 'AD_ID']),
    lead_created_at: leadCreatedAt,
    appointment_at: asIsoDateTime(appointmentValue),
    arrived_at: arrived ? asIsoDateTime(firstValue(item, [env.BITRIX_ARRIVED_FIELD, 'movedTime', 'MOVED_TIME'])) || leadCreatedAt : null,
    sold_at: sold ? asIsoDateTime(saleDateValue) || leadCreatedAt : null,
    is_target: targetStages.has(stage) || asBoolean(targetValue) || arrived || sold,
    sale_amount: sold ? asNumber(firstValue(item, [env.BITRIX_SALE_AMOUNT_FIELD, 'opportunity', 'OPPORTUNITY'])) : 0,
    metadata: { bitrix: item, entity_type_id: entityTypeId },
  };
}

async function bitrixCall<T>(env: Env, method: string, params: JsonRecord): Promise<T> {
  if (!env.BITRIX_WEBHOOK_BASE_URL) throw new Error('BITRIX_WEBHOOK_BASE_URL is missing');
  const response = await fetch(`${env.BITRIX_WEBHOOK_BASE_URL.replace(/\/$/, '')}/${method}.json`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(params),
  });
  const payload = (await response.json()) as JsonRecord;
  if (!response.ok || payload.error) throw new Error(`Bitrix ${method}: ${response.status} ${JSON.stringify(payload)}`);
  return payload as T;
}

async function syncBitrix(env: Env, window: SyncWindow): Promise<SyncResult> {
  if (!env.BITRIX_WEBHOOK_BASE_URL) return { source: 'bitrix', fetched: 0, written: 0, ...window, skipped: true, reason: 'credentials_missing' };
  const entityTypeId = Number(env.BITRIX_ENTITY_TYPE_ID || 1);
  const allItems: JsonRecord[] = [];
  let start = 0;
  for (let page = 0; page < 200; page += 1) {
    const payload = await bitrixCall<{ result?: { items?: JsonRecord[] }; next?: number }>(env, 'crm.item.list', {
      entityTypeId,
      select: ['*'],
      filter: { '>=updatedTime': `${window.from}T00:00:00+05:00` },
      order: { id: 'ASC' },
      start,
      useOriginalUfNames: 'Y',
    });
    const items = payload.result?.items || [];
    allItems.push(...items);
    if (typeof payload.next !== 'number' || !items.length) break;
    start = payload.next;
  }
  const leads = allItems.map((item) => normalizeBitrixItem(item, entityTypeId, env));
  const written = await upsertRows(env, 'marketing_leads', leads as unknown as JsonRecord[], 'external_id');
  await updateCrmDailyMetrics(env, leads, window);
  return { source: 'bitrix', fetched: allItems.length, written, ...window };
}

async function fetchBitrixItem(env: Env, entityTypeId: number, id: string): Promise<JsonRecord> {
  const payload = await bitrixCall<{ result?: { item?: JsonRecord } }>(env, 'crm.item.get', { entityTypeId, id: Number(id), useOriginalUfNames: 'Y' });
  if (!payload.result?.item) throw new Error(`Bitrix item ${entityTypeId}:${id} was not returned`);
  return payload.result.item;
}

interface DailyMetricAccumulator {
  date: string;
  source: string;
  platform: string;
  leads: number;
  target_leads: number;
  arrived: number;
  sales: number;
  revenue: number;
}

async function updateCrmDailyMetrics(env: Env, leads: NormalizedLead[], window: SyncWindow): Promise<void> {
  const map = new Map<string, DailyMetricAccumulator>();
  for (const lead of leads) {
    const date = lead.lead_created_at.slice(0, 10);
    if (date < window.from || date > window.to) continue;
    const key = `${date}\u0000${lead.source}\u0000${lead.platform}`;
    const row = map.get(key) || { date, source: lead.source, platform: lead.platform, leads: 0, target_leads: 0, arrived: 0, sales: 0, revenue: 0 };
    row.leads += 1;
    row.target_leads += lead.is_target ? 1 : 0;
    row.arrived += lead.arrived_at ? 1 : 0;
    row.sales += lead.sold_at ? 1 : 0;
    row.revenue += lead.sale_amount;
    map.set(key, row);
  }
  const rows = Array.from(map.values()).map((row) => ({ ...row, crm_synced_at: new Date().toISOString() }));
  await upsertRows(env, 'marketing_daily_metrics', rows as unknown as JsonRecord[], 'date,source,platform');
}

function sumAction(actions: unknown, accepted: string[]): number {
  if (!Array.isArray(actions)) return 0;
  const types = new Set(accepted);
  return actions.reduce((sum, item) => {
    const record = asRecord(item);
    const type = asString(record.action_type);
    return type && types.has(type) ? sum + asNumber(record.value) : sum;
  }, 0);
}

async function syncMeta(env: Env, window: SyncWindow): Promise<SyncResult> {
  const accountIds = parseCsv(env.META_AD_ACCOUNT_IDS).map((id) => id.replace(/^act_/, ''));
  if (!env.META_ACCESS_TOKEN || !env.META_GRAPH_VERSION || !accountIds.length) return { source: 'meta', fetched: 0, written: 0, ...window, skipped: true, reason: 'credentials_missing' };
  const rows: JsonRecord[] = [];
  for (const accountId of accountIds) {
    const fields = ['account_id','account_name','campaign_id','campaign_name','adset_id','adset_name','ad_id','ad_name','impressions','clicks','spend','actions','action_values','date_start','date_stop'].join(',');
    const params = new URLSearchParams({ access_token: env.META_ACCESS_TOKEN, level: 'ad', fields, time_increment: '1', time_range: JSON.stringify({ since: window.from, until: window.to }), limit: '500' });
    let next: string | null = `https://graph.facebook.com/${env.META_GRAPH_VERSION}/act_${accountId}/insights?${params}`;
    for (let page = 0; next && page < 100; page += 1) {
      const response = await fetch(next);
      const payload = (await response.json()) as JsonRecord;
      if (!response.ok || payload.error) throw new Error(`Meta insights: ${response.status} ${JSON.stringify(payload)}`);
      const data = Array.isArray(payload.data) ? payload.data.map(asRecord) : [];
      for (const item of data) {
        const date = asString(item.date_start) || window.to;
        const adId = asString(item.ad_id) || crypto.randomUUID();
        rows.push({
          external_id: `meta:${accountId}:${adId}`,
          report_date: date,
          source: 'Meta',
          platform: 'Meta',
          account_id: accountId,
          account_name: asString(item.account_name),
          campaign_id: asString(item.campaign_id),
          campaign_name: asString(item.campaign_name) || 'Meta campaign',
          adset_id: asString(item.adset_id),
          adset_name: asString(item.adset_name),
          ad_id: adId,
          creative_name: asString(item.ad_name),
          creative_type: null,
          status: null,
          impressions: asNumber(item.impressions),
          clicks: asNumber(item.clicks),
          spend: asNumber(item.spend),
          leads: sumAction(item.actions, ['lead','onsite_conversion.lead_grouped','offsite_conversion.fb_pixel_lead']),
          target_leads: 0,
          arrived: 0,
          sales: sumAction(item.actions, ['purchase','omni_purchase','offsite_conversion.fb_pixel_purchase']),
          revenue: sumAction(item.action_values, ['purchase','omni_purchase','offsite_conversion.fb_pixel_purchase']),
          utm_source: 'meta',
          metadata: { meta: item },
        });
      }
      next = asString(asRecord(payload.paging).next);
    }
  }
  const written = await upsertRows(env, 'marketing_ads', rows, 'external_id,report_date');
  await updateAdSpendDailyMetrics(env, rows, 'Meta');
  return { source: 'meta', fetched: rows.length, written, ...window };
}

async function syncTikTok(env: Env, window: SyncWindow): Promise<SyncResult> {
  const advertiserIds = parseCsv(env.TIKTOK_ADVERTISER_IDS);
  if (!env.TIKTOK_ACCESS_TOKEN || !advertiserIds.length) return { source: 'tiktok', fetched: 0, written: 0, ...window, skipped: true, reason: 'credentials_missing' };
  const apiBase = (env.TIKTOK_API_BASE || 'https://business-api.tiktok.com/open_api/v1.3').replace(/\/$/, '');
  const rows: JsonRecord[] = [];
  for (const advertiserId of advertiserIds) {
    let page = 1;
    let totalPages = 1;
    do {
      const params = new URLSearchParams({
        advertiser_id: advertiserId,
        report_type: 'BASIC',
        data_level: 'AUCTION_AD',
        dimensions: JSON.stringify(['ad_id', 'stat_time_day']),
        metrics: JSON.stringify(['campaign_id','campaign_name','adgroup_id','adgroup_name','ad_name','spend','impressions','clicks','conversion','total_purchase_value']),
        start_date: window.from,
        end_date: window.to,
        page: String(page),
        page_size: '1000',
      });
      const response = await fetch(`${apiBase}/report/integrated/get/?${params}`, { headers: { 'Access-Token': env.TIKTOK_ACCESS_TOKEN } });
      const payload = (await response.json()) as JsonRecord;
      if (!response.ok || asNumber(payload.code) !== 0) throw new Error(`TikTok report: ${response.status} ${JSON.stringify(payload)}`);
      const data = asRecord(payload.data);
      const list = Array.isArray(data.list) ? data.list.map(asRecord) : [];
      for (const item of list) {
        const dimensions = asRecord(item.dimensions);
        const metrics = asRecord(item.metrics);
        const adId = asString(dimensions.ad_id) || crypto.randomUUID();
        const date = (asString(dimensions.stat_time_day) || window.to).slice(0, 10);
        rows.push({
          external_id: `tiktok:${advertiserId}:${adId}`,
          report_date: date,
          source: 'TikTok',
          platform: 'TikTok',
          account_id: advertiserId,
          account_name: null,
          campaign_id: asString(metrics.campaign_id),
          campaign_name: asString(metrics.campaign_name) || 'TikTok campaign',
          adset_id: asString(metrics.adgroup_id),
          adset_name: asString(metrics.adgroup_name),
          ad_id: adId,
          creative_name: asString(metrics.ad_name),
          creative_type: null,
          status: null,
          impressions: asNumber(metrics.impressions),
          clicks: asNumber(metrics.clicks),
          spend: asNumber(metrics.spend),
          leads: asNumber(metrics.conversion),
          target_leads: 0,
          arrived: 0,
          sales: 0,
          revenue: asNumber(metrics.total_purchase_value),
          utm_source: 'tiktok',
          metadata: { tiktok: item },
        });
      }
      totalPages = Math.max(1, asNumber(asRecord(data.page_info).total_page) || 1);
      page += 1;
    } while (page <= totalPages && page <= 100);
  }
  const written = await upsertRows(env, 'marketing_ads', rows, 'external_id,report_date');
  await updateAdSpendDailyMetrics(env, rows, 'TikTok');
  return { source: 'tiktok', fetched: rows.length, written, ...window };
}

async function updateAdSpendDailyMetrics(env: Env, adRows: JsonRecord[], platform: string): Promise<void> {
  const byDate = new Map<string, number>();
  for (const row of adRows) {
    const date = asString(row.report_date);
    if (!date) continue;
    byDate.set(date, (byDate.get(date) || 0) + asNumber(row.spend));
  }
  const rows = Array.from(byDate, ([date, spend]) => ({ date, source: platform, platform, spend, ads_synced_at: new Date().toISOString() }));
  await upsertRows(env, 'marketing_daily_metrics', rows as unknown as JsonRecord[], 'date,source,platform');
}

async function runOneSync(env: Env, source: SyncSource, window: SyncWindow): Promise<SyncResult> {
  const runId = await insertRun(env, source, window);
  try {
    const result = source === 'bitrix' ? await syncBitrix(env, window) : source === 'meta' ? await syncMeta(env, window) : await syncTikTok(env, window);
    await finishRun(env, runId, 'success', result);
    return result;
  } catch (error) {
    await finishRun(env, runId, 'failed', undefined, error);
    throw error;
  }
}

export async function runAllSyncs(env: Env, options: { source?: string; days?: number; from?: string; to?: string } = {}): Promise<SyncResult[]> {
  const days = Math.min(Math.max(options.days || Number(env.BITRIX_SYNC_DAYS || 7), 1), 365);
  const window = buildWindow(days, options.from, options.to);
  const sources: SyncSource[] = options.source && options.source !== 'all' ? ([options.source] as SyncSource[]).filter((source) => ['bitrix','meta','tiktok'].includes(source)) : ['bitrix','meta','tiktok'];
  if (!sources.length) throw new Error('Unknown sync source');
  const settled = await Promise.allSettled(sources.map((source) => runOneSync(env, source, window)));
  const results: SyncResult[] = [];
  const failures: string[] = [];
  settled.forEach((item, index) => {
    if (item.status === 'fulfilled') results.push(item.value);
    else failures.push(`${sources[index]}: ${item.reason instanceof Error ? item.reason.message : String(item.reason)}`);
  });
  if (failures.length && !results.length) throw new Error(failures.join('; '));
  if (failures.length) results.push({ source: sources[0], fetched: 0, written: 0, ...window, skipped: true, reason: failures.join('; ') });
  return results;
}

async function hmacSha256(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function secureEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let result = 0;
  for (let index = 0; index < left.length; index += 1) result |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return result === 0;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function recordWebhookEvent(env: Env, source: string, eventKey: string, eventType: string, payload: unknown): Promise<boolean> {
  const response = await supabaseRequest(env, `integration_events?on_conflict=${encodeURIComponent('source,event_key')}`, {
    method: 'POST',
    headers: { prefer: 'resolution=ignore-duplicates,return=representation' },
    body: JSON.stringify({ source, event_key: eventKey, event_type: eventType, status: 'received', payload, received_at: new Date().toISOString() }),
  });
  const rows = await readSupabaseJson<JsonRecord[]>(response, 'Record webhook event');
  return rows.length > 0;
}

async function markWebhookEvent(env: Env, source: string, eventKey: string, status: 'processed' | 'failed', error?: unknown): Promise<void> {
  const params = new URLSearchParams({ source: `eq.${source}`, event_key: `eq.${eventKey}` });
  const response = await supabaseRequest(env, `integration_events?${params}`, {
    method: 'PATCH',
    headers: { prefer: 'return=minimal' },
    body: JSON.stringify({ status, processed_at: new Date().toISOString(), error: error instanceof Error ? error.message : error ? String(error) : null }),
  });
  await readSupabaseJson<unknown>(response, 'Mark webhook event');
}

function parseJsonOrForm(body: string, contentType: string): JsonRecord {
  if (contentType.includes('application/json')) {
    try { return asRecord(JSON.parse(body)); } catch { return {}; }
  }
  const params = new URLSearchParams(body);
  const result: JsonRecord = {};
  params.forEach((value, key) => { result[key] = value; });
  return result;
}

function bearerToken(request: Request): string | null {
  const auth = request.headers.get('authorization') || '';
  return auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : null;
}

function requireSecret(request: Request, expected?: string): boolean {
  if (!expected) return false;
  const supplied = bearerToken(request) || request.headers.get('x-webhook-secret') || new URL(request.url).searchParams.get('secret');
  return Boolean(supplied && secureEqual(supplied, expected));
}

async function handleBitrixWebhook(request: Request, env: Env): Promise<Response> {
  const body = await request.text();
  const payload = parseJsonOrForm(body, request.headers.get('content-type') || '');
  const auth = asRecord(payload.auth);
  const suppliedToken = asString(auth.application_token) || asString(payload['auth[application_token]']) || request.headers.get('x-webhook-secret');
  if (!env.BITRIX_OUTBOUND_TOKEN || !suppliedToken || !secureEqual(suppliedToken, env.BITRIX_OUTBOUND_TOKEN)) return jsonResponse({ error: 'Invalid Bitrix webhook token' }, 401);
  const event = (asString(payload.event) || 'UNKNOWN').toUpperCase();
  const data = asRecord(payload.data);
  const fields = asRecord(data.FIELDS ?? data.fields);
  const id = asString(fields.ID ?? fields.id ?? payload['data[FIELDS][ID]']);
  if (!id) return jsonResponse({ error: 'Bitrix entity ID is missing' }, 400);
  const entityTypeId = event.includes('DEAL') ? 2 : Number(env.BITRIX_ENTITY_TYPE_ID || 1);
  const eventKey = `${event}:${entityTypeId}:${id}:${asString(payload.ts) || '0'}`;
  const created = await recordWebhookEvent(env, 'bitrix', eventKey, event, payload);
  if (!created) return jsonResponse({ ok: true, duplicate: true });
  try {
    const item = await fetchBitrixItem(env, entityTypeId, id);
    const lead = normalizeBitrixItem(item, entityTypeId, env);
    await upsertRows(env, 'marketing_leads', [lead as unknown as JsonRecord], 'external_id');
    await updateCrmDailyMetrics(env, [lead], buildWindow(1, lead.lead_created_at.slice(0, 10), lead.lead_created_at.slice(0, 10)));
    await markWebhookEvent(env, 'bitrix', eventKey, 'processed');
    return jsonResponse({ ok: true, external_id: lead.external_id });
  } catch (error) {
    await markWebhookEvent(env, 'bitrix', eventKey, 'failed', error);
    throw error;
  }
}

function metaLeadField(fields: unknown, names: string[]): string | null {
  if (!Array.isArray(fields)) return null;
  const accepted = new Set(names.map((name) => name.toLowerCase()));
  for (const item of fields) {
    const record = asRecord(item);
    const name = (asString(record.name) || '').toLowerCase();
    if (!accepted.has(name)) continue;
    const values = Array.isArray(record.values) ? record.values : [];
    const value = asString(values[0]);
    if (value) return value;
  }
  return null;
}

async function fetchMetaLead(env: Env, leadgenId: string): Promise<JsonRecord> {
  if (!env.META_ACCESS_TOKEN || !env.META_GRAPH_VERSION) throw new Error('Meta credentials are missing');
  const params = new URLSearchParams({ access_token: env.META_ACCESS_TOKEN, fields: 'id,created_time,ad_id,form_id,field_data' });
  const response = await fetch(`https://graph.facebook.com/${env.META_GRAPH_VERSION}/${encodeURIComponent(leadgenId)}?${params}`);
  const payload = (await response.json()) as JsonRecord;
  if (!response.ok || payload.error) throw new Error(`Meta lead: ${response.status} ${JSON.stringify(payload)}`);
  return payload;
}

async function handleMetaWebhook(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  if (request.method === 'GET') {
    const mode = url.searchParams.get('hub.mode');
    const token = url.searchParams.get('hub.verify_token');
    const challenge = url.searchParams.get('hub.challenge');
    if (mode === 'subscribe' && token && env.META_WEBHOOK_VERIFY_TOKEN && secureEqual(token, env.META_WEBHOOK_VERIFY_TOKEN)) return new Response(challenge || '', { status: 200 });
    return new Response('Forbidden', { status: 403 });
  }
  const body = await request.text();
  if (env.META_APP_SECRET) {
    const supplied = request.headers.get('x-hub-signature-256') || '';
    const expected = `sha256=${await hmacSha256(env.META_APP_SECRET, body)}`;
    if (!secureEqual(supplied, expected)) return jsonResponse({ error: 'Invalid Meta signature' }, 401);
  }
  const payload = asRecord(JSON.parse(body || '{}'));
  const entries = Array.isArray(payload.entry) ? payload.entry.map(asRecord) : [];
  const changes = entries.flatMap((entry) => Array.isArray(entry.changes) ? entry.changes.map(asRecord) : []);
  const results: string[] = [];
  for (const change of changes) {
    const value = asRecord(change.value);
    const leadgenId = asString(value.leadgen_id);
    if (!leadgenId) continue;
    const eventKey = `leadgen:${leadgenId}`;
    const created = await recordWebhookEvent(env, 'meta', eventKey, asString(change.field) || 'leadgen', change);
    if (!created) continue;
    try {
      const leadData = await fetchMetaLead(env, leadgenId);
      const fieldData = leadData.field_data;
      const lead: NormalizedLead = {
        external_id: `meta-lead:${leadgenId}`,
        name: metaLeadField(fieldData, ['full_name','name']) || `Meta lead ${leadgenId}`,
        phone: metaLeadField(fieldData, ['phone_number','phone']) || '',
        email: metaLeadField(fieldData, ['email']),
        source: 'Meta', platform: 'Meta', campaign: null, manager: null, stage: 'Новый', next_action: null, first_message: null,
        utm_source: 'meta', utm_medium: 'lead_form', utm_campaign: null, utm_content: null, utm_term: null,
        campaign_id: null, adset_id: null, ad_id: asString(leadData.ad_id),
        lead_created_at: asIsoDateTime(leadData.created_time) || new Date().toISOString(),
        appointment_at: null, arrived_at: null, sold_at: null, is_target: false, sale_amount: 0,
        metadata: { meta: leadData },
      };
      await upsertRows(env, 'marketing_leads', [lead as unknown as JsonRecord], 'external_id');
      await updateCrmDailyMetrics(env, [lead], buildWindow(1, lead.lead_created_at.slice(0, 10), lead.lead_created_at.slice(0, 10)));
      await markWebhookEvent(env, 'meta', eventKey, 'processed');
      results.push(lead.external_id);
    } catch (error) {
      await markWebhookEvent(env, 'meta', eventKey, 'failed', error);
      console.error(error);
    }
  }
  return jsonResponse({ ok: true, processed: results.length, leads: results });
}

async function handleTikTokWebhook(request: Request, env: Env): Promise<Response> {
  if (!requireSecret(request, env.TIKTOK_WEBHOOK_SECRET)) return jsonResponse({ error: 'Invalid TikTok webhook secret' }, 401);
  const payload = asRecord(await request.json());
  const eventType = asString(payload.event) || asString(payload.event_type) || 'tiktok_event';
  const data = asRecord(payload.data);
  const leadId = firstText(data, ['lead_id','leadId','id']) || (await sha256Hex(JSON.stringify(payload))).slice(0, 32);
  const eventKey = `${eventType}:${leadId}`;
  const created = await recordWebhookEvent(env, 'tiktok', eventKey, eventType, payload);
  if (!created) return jsonResponse({ ok: true, duplicate: true });
  try {
    const lead: NormalizedLead = {
      external_id: `tiktok-lead:${leadId}`,
      name: firstText(data, ['full_name','name']) || `TikTok lead ${leadId}`,
      phone: firstText(data, ['phone_number','phone']) || '',
      email: firstText(data, ['email']),
      source: 'TikTok', platform: 'TikTok', campaign: firstText(data, ['campaign_name','campaign']), manager: null,
      stage: 'Новый', next_action: null, first_message: firstText(data, ['message','comments']),
      utm_source: 'tiktok', utm_medium: 'lead_form', utm_campaign: firstText(data, ['campaign_name','campaign']),
      utm_content: firstText(data, ['ad_name']), utm_term: null,
      campaign_id: firstText(data, ['campaign_id']), adset_id: firstText(data, ['adgroup_id','adset_id']), ad_id: firstText(data, ['ad_id']),
      lead_created_at: asIsoDateTime(firstValue(data, ['create_time','created_at','timestamp'])) || new Date().toISOString(),
      appointment_at: null, arrived_at: null, sold_at: null, is_target: false, sale_amount: 0,
      metadata: { tiktok: payload },
    };
    await upsertRows(env, 'marketing_leads', [lead as unknown as JsonRecord], 'external_id');
    await updateCrmDailyMetrics(env, [lead], buildWindow(1, lead.lead_created_at.slice(0, 10), lead.lead_created_at.slice(0, 10)));
    await markWebhookEvent(env, 'tiktok', eventKey, 'processed');
    return jsonResponse({ ok: true, external_id: lead.external_id });
  } catch (error) {
    await markWebhookEvent(env, 'tiktok', eventKey, 'failed', error);
    throw error;
  }
}

async function handleN8nWebhook(request: Request, env: Env): Promise<Response> {
  if (!requireSecret(request, env.N8N_WEBHOOK_SECRET)) return jsonResponse({ error: 'Invalid n8n webhook secret' }, 401);
  const payload = asRecord(await request.json());
  const kind = asString(payload.kind);
  const records = Array.isArray(payload.records) ? payload.records.map(asRecord) : [asRecord(payload.record ?? payload.data)];
  if (!kind || !records.length) return jsonResponse({ error: 'kind and records are required' }, 400);
  if (kind === 'lead') {
    const normalized = records.map((record) => ({ ...record, external_id: asString(record.external_id) || `n8n:${crypto.randomUUID()}`, name: asString(record.name) || 'Без имени', phone: asString(record.phone) || '', stage: asString(record.stage) || 'Новый', source: asString(record.source) || 'n8n', platform: asString(record.platform) || platformFromSource(asString(record.source)), lead_created_at: asIsoDateTime(record.lead_created_at) || new Date().toISOString(), metadata: asRecord(record.metadata) }));
    return jsonResponse({ ok: true, kind, written: await upsertRows(env, 'marketing_leads', normalized, 'external_id') });
  }
  if (kind === 'ad') {
    const normalized = records.map((record) => ({ ...record, external_id: asString(record.external_id) || `n8n-ad:${crypto.randomUUID()}`, report_date: asString(record.report_date) || isoDate(new Date()), source: asString(record.source) || asString(record.platform) || 'n8n', platform: asString(record.platform) || 'n8n', campaign_name: asString(record.campaign_name) || 'Без кампании' }));
    return jsonResponse({ ok: true, kind, written: await upsertRows(env, 'marketing_ads', normalized, 'external_id,report_date') });
  }
  if (kind === 'daily_metric') return jsonResponse({ ok: true, kind, written: await upsertRows(env, 'marketing_daily_metrics', records, 'date,source,platform') });
  return jsonResponse({ error: `Unsupported kind: ${kind}` }, 400);
}

async function handleStatus(request: Request, env: Env): Promise<Response> {
  const response = await supabaseRequest(env, 'integration_runs?select=*&order=started_at.desc&limit=20');
  const runs = response.ok ? await response.json() : [];
  return jsonResponse({
    configured: {
      supabase: Boolean(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY),
      bitrix: Boolean(env.BITRIX_WEBHOOK_BASE_URL),
      bitrixWebhook: Boolean(env.BITRIX_OUTBOUND_TOKEN),
      meta: Boolean(env.META_ACCESS_TOKEN && env.META_AD_ACCOUNT_IDS && env.META_GRAPH_VERSION),
      metaWebhook: Boolean(env.META_WEBHOOK_VERIFY_TOKEN),
      tiktok: Boolean(env.TIKTOK_ACCESS_TOKEN && env.TIKTOK_ADVERTISER_IDS),
      tiktokWebhook: Boolean(env.TIKTOK_WEBHOOK_SECRET),
      n8n: Boolean(env.N8N_WEBHOOK_SECRET),
      manualSync: Boolean(env.SYNC_API_KEY),
    },
    runs,
  }, 200, corsHeaders(request, env));
}

async function handleManualSync(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405, corsHeaders(request, env));
  if (!requireSecret(request, env.SYNC_API_KEY)) return jsonResponse({ error: 'Invalid sync API key' }, 401, corsHeaders(request, env));
  const payload = asRecord(await request.json().catch(() => ({})));
  const results = await runAllSyncs(env, { source: asString(payload.source) || 'all', days: asNumber(payload.days) || undefined, from: asString(payload.from) || undefined, to: asString(payload.to) || undefined });
  return jsonResponse({ ok: true, results }, 200, corsHeaders(request, env));
}

export async function handleIntegrationRequest(request: Request, env: Env, url: URL): Promise<Response | null> {
  if (url.pathname === '/api/integrations/status') return handleStatus(request, env);
  if (url.pathname === '/api/integrations/sync') return handleManualSync(request, env);
  if (url.pathname === '/api/webhooks/bitrix' && request.method === 'POST') return handleBitrixWebhook(request, env);
  if (url.pathname === '/api/webhooks/meta' && ['GET','POST'].includes(request.method)) return handleMetaWebhook(request, env);
  if (url.pathname === '/api/webhooks/tiktok' && request.method === 'POST') return handleTikTokWebhook(request, env);
  if (url.pathname === '/api/webhooks/n8n' && request.method === 'POST') return handleN8nWebhook(request, env);
  return null;
}

export async function runScheduledSync(controller: WorkerScheduledController, env: Env, ctx: WorkerExecutionContext): Promise<void> {
  const days = controller.cron === '30 2 * * *' ? 30 : 3;
  ctx.waitUntil(runAllSyncs(env, { source: 'all', days }).then(
    (results) => console.log('Scheduled marketing sync completed', results),
    (error) => console.error('Scheduled marketing sync failed', error),
  ));
}
