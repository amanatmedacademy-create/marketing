import { resolveCompanyId } from './companyContext';

type JsonRecord = Record<string, unknown>;

export interface MetaBackfillEnv {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  DEFAULT_COMPANY_ID?: string;
  META_ACCESS_TOKEN?: string;
  META_GRAPH_VERSION?: string;
}

interface CredentialRow {
  config_summary?: JsonRecord;
}

class MetaApiError extends Error {
  code: number;
  subcode: number;
  status: number;

  constructor(message: string, code = 0, subcode = 0, status = 500) {
    super(message);
    this.name = 'MetaApiError';
    this.code = code;
    this.subcode = subcode;
    this.status = status;
  }
}

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});
const record = (value: unknown): JsonRecord => value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {};
const text = (value: unknown): string => typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim();
const number = (value: unknown): number => Number.isFinite(Number(value)) ? Number(value) : 0;
const csv = (value: unknown): string[] => text(value).split(',').map((item) => item.trim()).filter(Boolean);
const graphVersion = (env: MetaBackfillEnv): string => {
  const value = text(env.META_GRAPH_VERSION) || 'v23.0';
  return value.startsWith('v') ? value : `v${value}`;
};
const accountDbId = (value: string): string => value.replace(/^act_/, '');
const dateValue = (value: string): Date => new Date(`${value}T00:00:00.000Z`);
const isoDate = (value: Date): string => value.toISOString().slice(0, 10);
const addDays = (value: string, days: number): string => isoDate(new Date(dateValue(value).getTime() + days * 86400000));
const daysBetween = (from: string, to: string): number => Math.floor((dateValue(to).getTime() - dateValue(from).getTime()) / 86400000) + 1;
const sleep = (milliseconds: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function supabase<T>(env: MetaBackfillEnv, path: string, init: RequestInit = {}): Promise<T> {
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
  if (!response.ok) throw new Error(`Meta backfill Supabase: ${response.status} ${body}`);
  return (body ? JSON.parse(body) : null) as T;
}

async function metaJson<T>(url: string, attempt = 0): Promise<T> {
  const response = await fetch(url, { headers: { accept: 'application/json' } });
  const body = await response.text();
  let payload: unknown = {};
  try { payload = body ? JSON.parse(body) : {}; } catch { payload = { error: { message: body } }; }
  const error = record(record(payload).error);
  if (!response.ok || Object.keys(error).length) {
    const code = number(error.code);
    const subcode = number(error.error_subcode);
    const transient = error.is_transient === true || [1, 2, 4, 17, 32, 613].includes(code) || response.status >= 500;
    if (transient && code !== 1 && attempt < 2) {
      await sleep(750 * (attempt + 1));
      return metaJson<T>(url, attempt + 1);
    }
    throw new MetaApiError(text(error.message) || `Meta API: ${response.status}`, code, subcode, response.status);
  }
  return payload as T;
}

function sumActions(value: unknown, accepted: string[]): number {
  if (!Array.isArray(value)) return 0;
  const types = new Set(accepted);
  return value.reduce((sum, item) => {
    const row = record(item);
    return types.has(text(row.action_type)) ? sum + number(row.value) : sum;
  }, 0);
}

async function insertRun(env: MetaBackfillEnv, companyId: string, from: string, to: string): Promise<string | null> {
  try {
    const rows = await supabase<Array<{ id?: string }>>(env, 'integration_runs', {
      method: 'POST',
      headers: { prefer: 'return=representation' },
      body: JSON.stringify({ company_id: companyId, source: 'meta', status: 'running', date_from: from, date_to: to, started_at: new Date().toISOString(), metadata: { mode: 'selection_backfill', chunk_days: 7 } }),
    });
    return rows[0]?.id || null;
  } catch (error) {
    console.error('Unable to create Meta backfill run', error);
    return null;
  }
}

async function finishRun(env: MetaBackfillEnv, id: string | null, status: 'success' | 'failed', fetched: number, written: number, error?: unknown): Promise<void> {
  if (!id) return;
  try {
    await supabase<unknown>(env, `integration_runs?id=eq.${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { prefer: 'return=minimal' },
      body: JSON.stringify({ status, fetched, written, finished_at: new Date().toISOString(), error: error instanceof Error ? error.message : error ? String(error) : null }),
    });
  } catch (finishError) {
    console.error('Unable to finish Meta backfill run', finishError);
  }
}

async function selectedScope(env: MetaBackfillEnv, companyId: string): Promise<{ accountIds: string[]; adIds: string[] }> {
  const rows = await supabase<CredentialRow[]>(env, `integration_credentials?company_id=eq.${encodeURIComponent(companyId)}&user_id=is.null&provider=eq.meta&select=config_summary&limit=1`);
  const values = record(record(rows[0]?.config_summary).values);
  const accountIds = csv(values.adAccountIds).map(accountDbId).filter((id) => /^\d+$/.test(id));
  const adIds = csv(values.selectedAdIds).filter((id) => /^\d+$/.test(id));
  if (!accountIds.length) throw new Error('Не выбран ни один рекламный кабинет');
  return { accountIds, adIds };
}

function normalizeInsight(item: JsonRecord, accountId: string, fallbackDate: string, selectedAdIds: Set<string>): JsonRecord | null {
  const adId = text(item.ad_id);
  if (!adId || (selectedAdIds.size && !selectedAdIds.has(adId))) return null;
  const leads = sumActions(item.actions, ['lead','onsite_conversion.lead_grouped','offsite_conversion.fb_pixel_lead','onsite_conversion.messaging_conversation_started_7d','onsite_conversion.messaging_conversation_started']);
  return {
    external_id: `meta:${accountId}:${adId}`,
    report_date: text(item.date_start) || fallbackDate,
    source: 'Meta',
    platform: 'Meta',
    account_id: accountId,
    account_name: text(item.account_name) || accountId,
    campaign_id: text(item.campaign_id) || null,
    campaign_name: text(item.campaign_name) || 'Meta campaign',
    adset_id: text(item.adset_id) || null,
    adset_name: text(item.adset_name) || null,
    ad_id: adId,
    creative_name: text(item.ad_name) || `Объявление ${adId}`,
    impressions: number(item.impressions),
    reach: number(item.reach),
    clicks: number(item.clicks),
    link_clicks: number(item.inline_link_clicks),
    spend: number(item.spend),
    leads,
    results: leads,
    target_leads: 0,
    arrived: 0,
    sales: sumActions(item.actions, ['purchase','omni_purchase','offsite_conversion.fb_pixel_purchase']),
    revenue: sumActions(item.action_values, ['purchase','omni_purchase','offsite_conversion.fb_pixel_purchase']),
    utm_source: 'meta',
    utm_medium: 'paid_social',
    utm_campaign: text(item.campaign_id) || null,
    utm_content: adId,
    metadata: { meta: item, selection_mode: selectedAdIds.size ? 'selected' : 'all' },
  };
}

async function fetchInsightsChunk(env: MetaBackfillEnv, accountId: string, from: string, to: string, selectedAdIds: Set<string>): Promise<JsonRecord[]> {
  const accessToken = text(env.META_ACCESS_TOKEN);
  if (!accessToken) throw new Error('Meta access token не найден');
  const rows: JsonRecord[] = [];
  const fields = [
    'account_id','account_name','campaign_id','campaign_name','adset_id','adset_name','ad_id','ad_name',
    'impressions','reach','clicks','inline_link_clicks','spend','actions','action_values','date_start','date_stop',
  ].join(',');
  const params = new URLSearchParams({
    access_token: accessToken,
    level: 'ad',
    fields,
    time_increment: '1',
    time_range: JSON.stringify({ since: from, until: to }),
    limit: '200',
  });
  if (selectedAdIds.size) params.set('filtering', JSON.stringify([{ field: 'ad.id', operator: 'IN', value: [...selectedAdIds] }]));
  let next: string | undefined = `https://graph.facebook.com/${graphVersion(env)}/act_${accountId}/insights?${params}`;
  for (let page = 0; next && page < 250; page += 1) {
    const payload: { data?: JsonRecord[]; paging?: { next?: string } } = await metaJson(next);
    for (const item of payload.data || []) {
      const normalized = normalizeInsight(item, accountId, to, selectedAdIds);
      if (normalized) rows.push(normalized);
    }
    next = payload.paging?.next;
  }
  return rows;
}

async function fetchAdaptive(env: MetaBackfillEnv, accountId: string, from: string, to: string, selectedAdIds: Set<string>): Promise<Array<{ from: string; to: string; rows: JsonRecord[] }>> {
  try {
    return [{ from, to, rows: await fetchInsightsChunk(env, accountId, from, to, selectedAdIds) }];
  } catch (error) {
    const rangeDays = daysBetween(from, to);
    const tooLarge = error instanceof MetaApiError && error.code === 1;
    if (!tooLarge || rangeDays <= 1) throw error;
    const leftDays = Math.ceil(rangeDays / 2);
    const leftTo = addDays(from, leftDays - 1);
    const rightFrom = addDays(leftTo, 1);
    const left = await fetchAdaptive(env, accountId, from, leftTo, selectedAdIds);
    const right = await fetchAdaptive(env, accountId, rightFrom, to, selectedAdIds);
    return [...left, ...right];
  }
}

function buildChunks(from: string, to: string, chunkDays = 7): Array<{ from: string; to: string }> {
  const chunks: Array<{ from: string; to: string }> = [];
  let cursor = from;
  while (cursor <= to) {
    const candidate = addDays(cursor, chunkDays - 1);
    const chunkTo = candidate > to ? to : candidate;
    chunks.push({ from: cursor, to: chunkTo });
    cursor = addDays(chunkTo, 1);
  }
  return chunks;
}

async function writeRows(env: MetaBackfillEnv, companyId: string, rows: JsonRecord[]): Promise<number> {
  if (!rows.length) return 0;
  let written = 0;
  for (let offset = 0; offset < rows.length; offset += 500) {
    const payload = rows.slice(offset, offset + 500).map((row) => ({ ...row, company_id: companyId }));
    await supabase<unknown>(env, 'marketing_ads?on_conflict=company_id,external_id,report_date', {
      method: 'POST',
      headers: { prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(payload),
    });
    written += payload.length;
  }
  return written;
}

async function refreshMetrics(env: MetaBackfillEnv, companyId: string): Promise<void> {
  await supabase<unknown>(env, 'rpc/refresh_meta_daily_metrics', {
    method: 'POST',
    headers: { prefer: 'return=minimal' },
    body: JSON.stringify({ p_company_id: companyId }),
  });
}

export async function handleMetaBackfillRequest(request: Request, env: MetaBackfillEnv, url: URL): Promise<Response | null> {
  if (url.pathname !== '/api/integrations/meta/backfill' || request.method !== 'POST') return null;
  const companyId = await resolveCompanyId(env);
  const body = record(await request.json().catch(() => ({})));
  const days = Math.min(Math.max(number(body.days) || 90, 1), 365);
  const to = text(body.to) || new Date().toISOString().slice(0, 10);
  const from = text(body.from) || new Date(new Date(`${to}T23:59:59.999Z`).getTime() - (days - 1) * 86400000).toISOString().slice(0, 10);
  const runId = await insertRun(env, companyId, from, to);
  let fetched = 0;
  let written = 0;
  let completedChunks = 0;
  try {
    const scope = await selectedScope(env, companyId);
    const selectedAdIds = new Set(scope.adIds);
    const chunks = buildChunks(from, to, 7);
    for (const accountId of scope.accountIds) {
      for (const chunk of chunks) {
        const adaptiveChunks = await fetchAdaptive(env, accountId, chunk.from, chunk.to, selectedAdIds);
        for (const result of adaptiveChunks) {
          fetched += result.rows.length;
          written += await writeRows(env, companyId, result.rows);
          completedChunks += 1;
        }
      }
    }
    await refreshMetrics(env, companyId);
    await finishRun(env, runId, 'success', fetched, written);
    return json({
      ok: true,
      source: 'meta',
      from,
      to,
      days,
      accounts: scope.accountIds.length,
      chunks: completedChunks,
      creativeSelectionMode: selectedAdIds.size ? 'selected' : 'all',
      selectedCreatives: selectedAdIds.size,
      fetched,
      written,
    });
  } catch (error) {
    await finishRun(env, runId, 'failed', fetched, written, error);
    return json({ error: error instanceof Error ? error.message : String(error), fetched, written, completedChunks }, 400);
  }
}
