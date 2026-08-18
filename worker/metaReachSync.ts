import type { Env } from './integrations';
import { requireCompanyId, type TenantScopedEnv } from './tenantScope';

type JsonRecord = Record<string, unknown>;
type DateRange = { since: string; until: string };
type ScopedEnv = Env & TenantScopedEnv;

const record = (value: unknown): JsonRecord => value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {};
const text = (value: unknown): string => typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim();
const number = (value: unknown): number => Number.isFinite(Number(value)) ? Number(value) : 0;
const list = (value?: string): string[] => (value || '').split(',').map((item) => item.trim().replace(/^act_/, '')).filter(Boolean);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
let lastSuccessfulSync = 0;

async function fetchJson(url: string): Promise<JsonRecord> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(url);
      const payload = record(await response.json());
      if (response.ok && !payload.error) return payload;
      const error = record(payload.error);
      const code = number(error.code);
      const transient = response.status >= 500 || code === 1 || code === 2 || Boolean(error.is_transient);
      lastError = new Error(`Meta sync: ${response.status} ${JSON.stringify(payload.error || payload)}`);
      if (!transient || attempt === 2) throw lastError;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt === 2) throw lastError;
    }
    await sleep(1000 * (attempt + 1));
  }
  throw lastError || new Error('Meta sync failed');
}

async function fetchAll(url: string): Promise<JsonRecord[]> {
  const rows: JsonRecord[] = [];
  let next: string | undefined = url;
  for (let page = 0; next && page < 100; page += 1) {
    const payload = await fetchJson(next);
    if (Array.isArray(payload.data)) rows.push(...payload.data.map(record));
    next = text(record(payload.paging).next) || undefined;
  }
  return rows;
}

function dateChunks(days: number, size = 7): DateRange[] {
  const end = new Date();
  const start = new Date(end.getTime() - (Math.max(1, days) - 1) * 86400000);
  const chunks: DateRange[] = [];
  let cursor = new Date(start);
  while (cursor <= end) {
    const chunkEnd = new Date(Math.min(end.getTime(), cursor.getTime() + (size - 1) * 86400000));
    chunks.push({ since: cursor.toISOString().slice(0, 10), until: chunkEnd.toISOString().slice(0, 10) });
    cursor = new Date(chunkEnd.getTime() + 86400000);
  }
  return chunks;
}

async function upsert(env: Env, rows: JsonRecord[]): Promise<void> {
  for (let start = 0; start < rows.length; start += 300) {
    const chunk = rows.slice(start, start + 300);
    const response = await fetch(`${env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/marketing_ads?on_conflict=company_id,external_id,report_date`, {
      method: 'POST',
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        'content-type': 'application/json',
        prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify(chunk),
    });
    if (!response.ok) throw new Error(`Meta sync upsert: ${response.status} ${await response.text()}`);
  }
}

export async function syncMetaReach(env: Env, days = 30, force = false): Promise<{ accounts: number; rows: number; cached?: boolean }> {
  if (!force && Date.now() - lastSuccessfulSync < 5 * 60 * 1000) return { accounts: 0, rows: 0, cached: true };
  const companyId = requireCompanyId(env as ScopedEnv);
  const accountIds = list(env.META_AD_ACCOUNT_IDS);
  if (!env.META_ACCESS_TOKEN || !env.META_GRAPH_VERSION || !accountIds.length) throw new Error('Meta credentials are missing');

  const fields = [
    'account_id','account_name','campaign_id','campaign_name','adset_id','adset_name','ad_id','ad_name',
    'impressions','reach','frequency','clicks','inline_link_clicks','spend','actions','action_values','date_start','date_stop',
  ].join(',');
  let written = 0;

  for (const accountId of accountIds) {
    const accountParams = new URLSearchParams({ access_token: env.META_ACCESS_TOKEN, fields: 'id,name,account_status,currency,timezone_name' });
    const account = await fetchJson(`https://graph.facebook.com/${env.META_GRAPH_VERSION}/act_${accountId}?${accountParams}`);

    const adsParams = new URLSearchParams({
      access_token: env.META_ACCESS_TOKEN,
      fields: 'id,name,status,effective_status,configured_status,adset{id,name,status,effective_status,campaign{id,name,status,effective_status}}',
      limit: '500',
    });
    const ads = await fetchAll(`https://graph.facebook.com/${env.META_GRAPH_VERSION}/act_${accountId}/ads?${adsParams}`);
    const adsById = new Map(ads.map((ad) => [text(ad.id), ad]));

    for (const range of dateChunks(days, 7)) {
      const params = new URLSearchParams({
        access_token: env.META_ACCESS_TOKEN,
        level: 'ad',
        fields,
        time_increment: '1',
        time_range: JSON.stringify(range),
        limit: '250',
      });
      const insights = await fetchAll(`https://graph.facebook.com/${env.META_GRAPH_VERSION}/act_${accountId}/insights?${params}`);
      const output: JsonRecord[] = [];

      for (const item of insights) {
        const adId = text(item.ad_id);
        if (!adId) continue;
        const ad = adsById.get(adId) || {};
        const adset = record(ad.adset);
        const campaign = record(adset.campaign);
        const effectiveStatus = text(ad.effective_status || ad.status) || 'UNKNOWN';
        output.push({
          company_id: companyId,
          external_id: `meta:${accountId}:${adId}`,
          report_date: text(item.date_start) || range.until,
          source: 'Meta', platform: 'Meta', account_id: accountId,
          account_name: text(item.account_name) || text(account.name) || accountId,
          account_status: text(account.account_status), currency: text(account.currency) || 'USD',
          account_timezone: text(account.timezone_name) || null,
          campaign_id: text(item.campaign_id || campaign.id), campaign_name: text(item.campaign_name || campaign.name) || 'Meta campaign',
          adset_id: text(item.adset_id || adset.id), adset_name: text(item.adset_name || adset.name),
          ad_id: adId, creative_name: text(item.ad_name || ad.name), status: effectiveStatus, effective_status: effectiveStatus,
          impressions: number(item.impressions), reach: number(item.reach), clicks: number(item.clicks),
          link_clicks: number(item.inline_link_clicks), spend: number(item.spend),
          metadata: { meta: item, ad, frequency: number(item.frequency), campaign_status: text(campaign.effective_status || campaign.status), adset_status: text(adset.effective_status || adset.status), reach_sync: true },
        });
      }
      await upsert(env, output);
      written += output.length;
    }
  }

  lastSuccessfulSync = Date.now();
  return { accounts: accountIds.length, rows: written };
}

export async function handleMetaReachSync(request: Request, env: Env, url: URL): Promise<Response | null> {
  if (url.pathname !== '/api/integrations/meta/reach-sync' || request.method !== 'POST') return null;
  const body = await request.json().catch(() => ({})) as JsonRecord;
  const days = Math.min(Math.max(number(body.days) || 30, 1), 365);
  const result = await syncMetaReach(env, days, true);
  return new Response(JSON.stringify({ ok: true, ...result }), { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
}
