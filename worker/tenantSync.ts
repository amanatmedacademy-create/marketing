import { resolveCompanyId } from './companyContext';
import { updateCredentialVerification } from './credentials';
import { handleMetaBackfillRequest, type MetaBackfillEnv } from './metaBackfill';
import type { WorkerScheduledController } from './integrations';

type JsonRecord = Record<string, unknown>;
type TenantSyncSource = 'bitrix' | 'meta' | 'tiktok';

export interface TenantSyncEnv extends MetaBackfillEnv {
  BITRIX_WEBHOOK_BASE_URL?: string;
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
  TIKTOK_ACCESS_TOKEN?: string;
  TIKTOK_ADVERTISER_IDS?: string;
  TIKTOK_API_BASE?: string;
}

interface SyncWindow {
  from: string;
  to: string;
}

export interface TenantSyncResult {
  source: TenantSyncSource;
  fetched: number;
  written: number;
  from: string;
  to: string;
  companyId: string;
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

interface TikTokAdStatus {
  status: string;
  operationStatus: string | null;
  secondaryStatus: string | null;
}

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});

const record = (value: unknown): JsonRecord => value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {};
const text = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value.trim() || null;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return null;
};
const number = (value: unknown): number => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value.replace(/\s/g, '').replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
};
const bool = (value: unknown): boolean => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  return ['1', 'y', 'yes', 'true', 'да'].includes(String(value || '').toLowerCase());
};
const csv = (value?: string): string[] => (value || '').split(',').map((item) => item.trim()).filter(Boolean);
const isoDate = (date: Date): string => date.toISOString().slice(0, 10);

function dateTime(value: unknown): string | null {
  const raw = text(value);
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function buildWindow(days: number, from?: string, to?: string): SyncWindow {
  const end = to ? new Date(`${to}T23:59:59.999Z`) : new Date();
  const start = from ? new Date(`${from}T00:00:00.000Z`) : new Date(end.getTime() - (days - 1) * 86400000);
  return { from: isoDate(start), to: isoDate(end) };
}

function getField(item: JsonRecord, fieldName?: string): unknown {
  if (!fieldName) return undefined;
  if (fieldName in item) return item[fieldName];
  const lower = fieldName.toLowerCase();
  const key = Object.keys(item).find((candidate) => candidate.toLowerCase() === lower);
  return key ? item[key] : undefined;
}

function firstValue(item: JsonRecord, names: Array<string | undefined>): unknown {
  for (const name of names) {
    const value = getField(item, name);
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return undefined;
}

function firstText(item: JsonRecord, names: Array<string | undefined>): string | null {
  return text(firstValue(item, names));
}

function firstCommunication(item: JsonRecord, kind: 'PHONE' | 'EMAIL'): string | null {
  const direct = firstValue(item, [kind, kind.toLowerCase(), kind === 'PHONE' ? 'phone' : 'email']);
  if (Array.isArray(direct)) {
    for (const entry of direct) {
      const value = text(record(entry).VALUE ?? record(entry).value ?? entry);
      if (value) return value;
    }
  }
  const directText = text(direct);
  if (directText) return directText;
  const fm = record(item.fm);
  const entries = fm[kind] ?? fm[kind.toLowerCase()];
  if (Array.isArray(entries)) {
    for (const entry of entries) {
      const data = record(entry);
      const value = text(data.VALUE ?? data.value);
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

async function supabase<T>(env: TenantSyncEnv, path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      'content-type': 'application/json',
      ...init.headers,
    },
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`Tenant sync Supabase: ${response.status} ${body}`);
  return (body ? JSON.parse(body) : null) as T;
}

async function upsertRows(
  env: TenantSyncEnv,
  table: string,
  rows: JsonRecord[],
  onConflict: string,
): Promise<number> {
  let written = 0;
  for (let offset = 0; offset < rows.length; offset += 500) {
    const batch = rows.slice(offset, offset + 500);
    await supabase<unknown>(env, `${table}?on_conflict=${encodeURIComponent(onConflict)}`, {
      method: 'POST',
      headers: { prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(batch),
    });
    written += batch.length;
  }
  return written;
}

async function insertRun(
  env: TenantSyncEnv,
  companyId: string,
  source: TenantSyncSource,
  window: SyncWindow,
): Promise<string | null> {
  try {
    const rows = await supabase<Array<{ id?: string }>>(env, 'integration_runs', {
      method: 'POST',
      headers: { prefer: 'return=representation' },
      body: JSON.stringify({
        company_id: companyId,
        source,
        status: 'running',
        started_at: new Date().toISOString(),
        date_from: window.from,
        date_to: window.to,
        metadata: { mode: 'tenant_sync' },
      }),
    });
    return rows[0]?.id || null;
  } catch (error) {
    console.error(`Unable to create ${source} integration run`, error);
    return null;
  }
}

async function finishRun(
  env: TenantSyncEnv,
  runId: string | null,
  status: 'success' | 'failed',
  result?: TenantSyncResult,
  error?: unknown,
): Promise<void> {
  if (!runId) return;
  try {
    await supabase<unknown>(env, `integration_runs?id=eq.${encodeURIComponent(runId)}`, {
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
  } catch (finishError) {
    console.error('Unable to finish tenant integration run', finishError);
  }
}

function normalizeBitrixItem(item: JsonRecord, entityTypeId: number, env: TenantSyncEnv): NormalizedLead {
  const id = firstText(item, ['id', 'ID']) || crypto.randomUUID();
  const stage = firstText(item, ['stageId', 'statusId', 'STAGE_ID', 'STATUS_ID']) || 'Не определено';
  const targetStages = new Set(csv(env.BITRIX_TARGET_STAGE_IDS));
  const arrivedStages = new Set(csv(env.BITRIX_ARRIVED_STAGE_IDS));
  const saleStages = new Set(csv(env.BITRIX_SALE_STAGE_IDS));
  const firstName = firstText(item, ['name', 'NAME']);
  const lastName = firstText(item, ['lastName', 'LAST_NAME']);
  const title = firstText(item, ['title', 'TITLE']);
  const fullName = [firstName, lastName].filter(Boolean).join(' ') || title || `Bitrix ${id}`;
  const utmSource = firstText(item, [env.BITRIX_SOURCE_FIELD, 'utmSource', 'UTM_SOURCE', 'sourceId', 'SOURCE_ID']);
  const utmMedium = firstText(item, ['utmMedium', 'UTM_MEDIUM']);
  const platform = platformFromSource(`${utmSource || ''} ${utmMedium || ''}`);
  const source = utmSource || platform;
  const saleDateValue = firstValue(item, [env.BITRIX_SALE_DATE_FIELD, 'closedTime', 'CLOSEDATE']);
  const leadCreatedAt = dateTime(firstValue(item, ['createdTime', 'dateCreate', 'DATE_CREATE'])) || new Date().toISOString();
  const sold = saleStages.has(stage) || Boolean(dateTime(saleDateValue));
  const arrived = arrivedStages.has(stage) || sold || bool(getField(item, env.BITRIX_ARRIVED_FIELD));
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
    appointment_at: dateTime(firstValue(item, [env.BITRIX_APPOINTMENT_FIELD])),
    arrived_at: arrived ? dateTime(firstValue(item, [env.BITRIX_ARRIVED_FIELD, 'movedTime', 'MOVED_TIME'])) || leadCreatedAt : null,
    sold_at: sold ? dateTime(saleDateValue) || leadCreatedAt : null,
    is_target: targetStages.has(stage) || bool(getField(item, env.BITRIX_TARGET_FIELD)) || arrived || sold,
    sale_amount: sold ? number(firstValue(item, [env.BITRIX_SALE_AMOUNT_FIELD, 'opportunity', 'OPPORTUNITY'])) : 0,
    metadata: { bitrix: item, entity_type_id: entityTypeId },
  };
}

async function bitrixCall<T>(env: TenantSyncEnv, method: string, params: JsonRecord): Promise<T> {
  if (!env.BITRIX_WEBHOOK_BASE_URL) throw new Error('BITRIX_WEBHOOK_BASE_URL is missing');
  const response = await fetch(`${env.BITRIX_WEBHOOK_BASE_URL.replace(/\/$/, '')}/${method}.json`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(params),
  });
  const payload = await response.json() as JsonRecord;
  if (!response.ok || payload.error) throw new Error(`Bitrix ${method}: ${response.status} ${JSON.stringify(payload)}`);
  return payload as T;
}

async function updateCrmDailyMetrics(
  env: TenantSyncEnv,
  companyId: string,
  leads: NormalizedLead[],
  window: SyncWindow,
): Promise<void> {
  const map = new Map<string, DailyMetricAccumulator>();
  for (const lead of leads) {
    const date = lead.lead_created_at.slice(0, 10);
    if (date < window.from || date > window.to) continue;
    const key = `${date}\u0000${lead.source}\u0000${lead.platform}`;
    const row = map.get(key) || {
      date,
      source: lead.source,
      platform: lead.platform,
      leads: 0,
      target_leads: 0,
      arrived: 0,
      sales: 0,
      revenue: 0,
    };
    row.leads += 1;
    row.target_leads += lead.is_target ? 1 : 0;
    row.arrived += lead.arrived_at ? 1 : 0;
    row.sales += lead.sold_at ? 1 : 0;
    row.revenue += lead.sale_amount;
    map.set(key, row);
  }
  const rows = Array.from(map.values()).map((row) => ({
    ...row,
    company_id: companyId,
    crm_synced_at: new Date().toISOString(),
  }));
  await upsertRows(env, 'marketing_daily_metrics', rows, 'company_id,date,source,platform');
}

async function syncBitrix(
  env: TenantSyncEnv,
  companyId: string,
  window: SyncWindow,
): Promise<TenantSyncResult> {
  if (!env.BITRIX_WEBHOOK_BASE_URL) {
    return { source: 'bitrix', fetched: 0, written: 0, ...window, companyId, skipped: true, reason: 'credentials_missing' };
  }
  const entityTypeId = Number(env.BITRIX_ENTITY_TYPE_ID || 1);
  const allItems: JsonRecord[] = [];
  let start = 0;
  for (let page = 0; page < 200; page += 1) {
    const payload = await bitrixCall<{ result?: { items?: JsonRecord[] }; next?: number }>(env, 'crm.item.list', {
      entityTypeId,
      select: ['*'],
      filter: {
        '>=updatedTime': `${window.from}T00:00:00+05:00`,
        '<=updatedTime': `${window.to}T23:59:59+05:00`,
      },
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
  const rows = leads.map((lead) => ({ ...lead, company_id: companyId }));
  const written = await upsertRows(env, 'marketing_leads', rows, 'company_id,external_id');
  await updateCrmDailyMetrics(env, companyId, leads, window);
  return { source: 'bitrix', fetched: allItems.length, written, ...window, companyId };
}

async function updateAdSpendDailyMetrics(
  env: TenantSyncEnv,
  companyId: string,
  adRows: JsonRecord[],
  platform: string,
): Promise<void> {
  const byDate = new Map<string, number>();
  for (const row of adRows) {
    const date = text(row.report_date);
    if (!date) continue;
    byDate.set(date, (byDate.get(date) || 0) + number(row.spend));
  }
  const rows = Array.from(byDate, ([date, spend]) => ({
    company_id: companyId,
    date,
    source: platform,
    platform,
    spend,
    ads_synced_at: new Date().toISOString(),
  }));
  await upsertRows(env, 'marketing_daily_metrics', rows, 'company_id,date,source,platform');
}

async function fetchTikTokAdStatuses(
  env: TenantSyncEnv,
  apiBase: string,
  advertiserId: string,
  adIds: string[],
): Promise<Map<string, TikTokAdStatus>> {
  const result = new Map<string, TikTokAdStatus>();
  const uniqueAdIds = Array.from(new Set(adIds.filter(Boolean)));
  if (!uniqueAdIds.length) return result;
  if (!env.TIKTOK_ACCESS_TOKEN) throw new Error('TIKTOK_ACCESS_TOKEN is missing');

  for (let offset = 0; offset < uniqueAdIds.length; offset += 100) {
    const chunk = uniqueAdIds.slice(offset, offset + 100);
    let page = 1;
    let totalPages = 1;
    do {
      const params = new URLSearchParams({
        advertiser_id: advertiserId,
        filtering: JSON.stringify({ ad_ids: chunk }),
        fields: JSON.stringify(['ad_id', 'ad_name', 'operation_status', 'secondary_status']),
        page: String(page),
        page_size: '100',
      });
      const response = await fetch(`${apiBase}/ad/get/?${params}`, {
        headers: { 'Access-Token': env.TIKTOK_ACCESS_TOKEN },
      });
      const payload = await response.json() as JsonRecord;
      if (!response.ok || number(payload.code) !== 0) {
        throw new Error(`TikTok ad status: ${response.status} ${JSON.stringify(payload)}`);
      }
      const data = record(payload.data);
      const list = Array.isArray(data.list) ? data.list.map(record) : [];
      for (const ad of list) {
        const adId = text(ad.ad_id);
        if (!adId) continue;
        const operationStatus = text(ad.operation_status);
        const secondaryStatus = text(ad.secondary_status);
        const status = secondaryStatus || operationStatus;
        if (!status) continue;
        result.set(adId, { status, operationStatus, secondaryStatus });
      }
      totalPages = Math.max(1, number(record(data.page_info).total_page) || 1);
      page += 1;
    } while (page <= totalPages && page <= 100);
  }

  const missing = uniqueAdIds.filter((adId) => !result.has(adId));
  if (missing.length) {
    throw new Error(`TikTok ad status missing for ${missing.length} ads`);
  }
  return result;
}

async function syncTikTok(
  env: TenantSyncEnv,
  companyId: string,
  window: SyncWindow,
): Promise<TenantSyncResult> {
  const advertiserIds = csv(env.TIKTOK_ADVERTISER_IDS);
  if (!env.TIKTOK_ACCESS_TOKEN || !advertiserIds.length) {
    return { source: 'tiktok', fetched: 0, written: 0, ...window, companyId, skipped: true, reason: 'credentials_missing' };
  }
  const apiBase = (env.TIKTOK_API_BASE || 'https://business-api.tiktok.com/open_api/v1.3').replace(/\/$/, '');
  const rows: JsonRecord[] = [];
  for (const advertiserId of advertiserIds) {
    const advertiserRows: JsonRecord[] = [];
    let page = 1;
    let totalPages = 1;
    do {
      const params = new URLSearchParams({
        advertiser_id: advertiserId,
        report_type: 'BASIC',
        data_level: 'AUCTION_AD',
        dimensions: JSON.stringify(['ad_id', 'stat_time_day']),
        metrics: JSON.stringify([
          'campaign_id','campaign_name','adgroup_id','adgroup_name','ad_name',
          'spend','impressions','clicks','conversion','total_purchase_value',
        ]),
        start_date: window.from,
        end_date: window.to,
        page: String(page),
        page_size: '1000',
      });
      const response = await fetch(`${apiBase}/report/integrated/get/?${params}`, {
        headers: { 'Access-Token': env.TIKTOK_ACCESS_TOKEN },
      });
      const payload = await response.json() as JsonRecord;
      if (!response.ok || number(payload.code) !== 0) {
        throw new Error(`TikTok report: ${response.status} ${JSON.stringify(payload)}`);
      }
      const data = record(payload.data);
      const list = Array.isArray(data.list) ? data.list.map(record) : [];
      for (const item of list) {
        const dimensions = record(item.dimensions);
        const metrics = record(item.metrics);
        const adId = text(dimensions.ad_id) || crypto.randomUUID();
        const date = (text(dimensions.stat_time_day) || window.to).slice(0, 10);
        advertiserRows.push({
          company_id: companyId,
          external_id: `tiktok:${advertiserId}:${adId}`,
          report_date: date,
          source: 'TikTok',
          platform: 'TikTok',
          account_id: advertiserId,
          account_name: null,
          campaign_id: text(metrics.campaign_id),
          campaign_name: text(metrics.campaign_name) || 'TikTok campaign',
          adset_id: text(metrics.adgroup_id),
          adset_name: text(metrics.adgroup_name),
          ad_id: adId,
          creative_name: text(metrics.ad_name),
          creative_type: null,
          status: null,
          impressions: number(metrics.impressions),
          clicks: number(metrics.clicks),
          spend: number(metrics.spend),
          leads: number(metrics.conversion),
          results: number(metrics.conversion),
          target_leads: 0,
          arrived: 0,
          sales: 0,
          revenue: number(metrics.total_purchase_value),
          utm_source: 'tiktok',
          utm_medium: 'paid_social',
          utm_campaign: text(metrics.campaign_id),
          utm_content: adId,
          metadata: { tiktok: item },
        });
      }
      totalPages = Math.max(1, number(record(data.page_info).total_page) || 1);
      page += 1;
    } while (page <= totalPages && page <= 100);

    const adIds = advertiserRows.map((row) => text(row.ad_id)).filter((value): value is string => Boolean(value));
    const statuses = await fetchTikTokAdStatuses(env, apiBase, advertiserId, adIds);
    for (const row of advertiserRows) {
      const adId = text(row.ad_id);
      if (!adId) throw new Error('TikTok report row is missing ad_id');
      const adStatus = statuses.get(adId);
      if (!adStatus) throw new Error(`TikTok ad status missing for ad ${adId}`);
      row.status = adStatus.status;
      row.metadata = {
        ...record(row.metadata),
        tiktok_status: {
          operation_status: adStatus.operationStatus,
          secondary_status: adStatus.secondaryStatus,
        },
      };
    }
    rows.push(...advertiserRows);
  }
  const written = await upsertRows(env, 'marketing_ads', rows, 'company_id,external_id,report_date');
  await updateAdSpendDailyMetrics(env, companyId, rows, 'TikTok');
  return { source: 'tiktok', fetched: rows.length, written, ...window, companyId };
}

async function syncMeta(
  env: TenantSyncEnv,
  companyId: string,
  window: SyncWindow,
): Promise<TenantSyncResult> {
  const url = new URL('https://internal.invalid/api/integrations/meta/backfill');
  const request = new Request(url.toString(), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ from: window.from, to: window.to }),
  });
  const response = await handleMetaBackfillRequest(request, env, url);
  if (!response) throw new Error('Meta backfill route is unavailable');
  const raw = await response.text();
  let payload: JsonRecord = {};
  try {
    payload = raw ? JSON.parse(raw) as JsonRecord : {};
  } catch {
    throw new Error(raw || `Meta backfill failed: ${response.status}`);
  }
  if (!response.ok) throw new Error(text(payload.error) || `Meta backfill failed: ${response.status}`);
  return {
    source: 'meta',
    fetched: number(payload.fetched),
    written: number(payload.written),
    from: text(payload.from) || window.from,
    to: text(payload.to) || window.to,
    companyId,
  };
}

async function runOne(
  env: TenantSyncEnv,
  companyId: string,
  source: TenantSyncSource,
  window: SyncWindow,
): Promise<TenantSyncResult> {
  if (source === 'meta') return syncMeta(env, companyId, window);
  const runId = await insertRun(env, companyId, source, window);
  try {
    const result = source === 'bitrix'
      ? await syncBitrix(env, companyId, window)
      : await syncTikTok(env, companyId, window);
    await finishRun(env, runId, 'success', result);
    return result;
  } catch (error) {
    await finishRun(env, runId, 'failed', undefined, error);
    throw error;
  }
}

export async function runTenantSyncs(
  env: TenantSyncEnv,
  options: { source?: string; days?: number; from?: string; to?: string } = {},
): Promise<TenantSyncResult[]> {
  const companyId = await resolveCompanyId(env);
  const days = Math.min(Math.max(options.days || Number(env.BITRIX_SYNC_DAYS || 7), 1), 365);
  const window = buildWindow(days, options.from, options.to);
  const sources: TenantSyncSource[] = options.source && options.source !== 'all'
    ? ([options.source] as TenantSyncSource[]).filter((source) => ['bitrix', 'meta', 'tiktok'].includes(source))
    : ['bitrix', 'meta', 'tiktok'];
  if (!sources.length) throw new Error('Unknown sync source');

  const settled = await Promise.allSettled(sources.map((source) => runOne(env, companyId, source, window)));
  return settled.map((result, index) => result.status === 'fulfilled'
    ? result.value
    : {
        source: sources[index],
        fetched: 0,
        written: 0,
        ...window,
        companyId,
        skipped: true,
        reason: result.reason instanceof Error ? result.reason.message : String(result.reason),
      });
}

export async function handleTenantSyncRequest(
  request: Request,
  env: TenantSyncEnv,
  url: URL,
): Promise<Response | null> {
  if (url.pathname === '/api/integrations/sync' && request.method === 'POST') {
    const body = record(await request.json().catch(() => ({})));
    const source = text(body.source) || 'all';
    const days = Math.min(Math.max(number(body.days) || 90, 1), 365);
    const results = await runTenantSyncs(env, {
      source,
      days,
      from: text(body.from) || undefined,
      to: text(body.to) || undefined,
    });
    const failures = results.filter((result) => result.reason && result.reason !== 'credentials_missing');
    return json({ ok: failures.length === 0, results, failures: failures.length });
  }

  if (url.pathname.startsWith('/api/integrations/test/') && request.method === 'POST') {
    const provider = url.pathname.split('/').pop();
    if (!provider || !['bitrix', 'meta', 'tiktok'].includes(provider)) return null;
    try {
      const results = await runTenantSyncs(env, { source: provider, days: 1 });
      const failed = results.find((result) => result.skipped || result.reason);
      if (failed) throw new Error(failed.reason || 'Проверка не выполнена');
      await updateCredentialVerification(env, provider as 'bitrix' | 'meta' | 'tiktok', true);
      return json({ ok: true, results });
    } catch (error) {
      await updateCredentialVerification(env, provider as 'bitrix' | 'meta' | 'tiktok', false, error);
      return json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  }

  return null;
}

export async function runTenantScheduledSync(
  controller: WorkerScheduledController,
  env: TenantSyncEnv,
): Promise<TenantSyncResult[]> {
  const days = controller.cron === '30 2 * * *' ? 30 : 3;
  return runTenantSyncs(env, { source: 'all', days });
}
