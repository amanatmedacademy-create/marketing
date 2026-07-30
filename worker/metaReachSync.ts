import type { Env } from './integrations';

type JsonRecord = Record<string, unknown>;

const record = (value: unknown): JsonRecord => value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {};
const text = (value: unknown): string => typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim();
const number = (value: unknown): number => Number.isFinite(Number(value)) ? Number(value) : 0;
const list = (value?: string): string[] => (value || '').split(',').map((item) => item.trim().replace(/^act_/, '')).filter(Boolean);

async function fetchAll(url: string): Promise<JsonRecord[]> {
  const rows: JsonRecord[] = [];
  let next: string | undefined = url;
  for (let page = 0; next && page < 100; page += 1) {
    const response = await fetch(next);
    const payload = record(await response.json());
    if (!response.ok || payload.error) throw new Error(`Meta reach sync: ${response.status} ${JSON.stringify(payload.error || payload)}`);
    if (Array.isArray(payload.data)) rows.push(...payload.data.map(record));
    next = text(record(payload.paging).next) || undefined;
  }
  return rows;
}

async function upsert(env: Env, rows: JsonRecord[]): Promise<void> {
  if (!rows.length) return;
  const response = await fetch(`${env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/marketing_ads?on_conflict=external_id,report_date`, {
    method: 'POST',
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      'content-type': 'application/json',
      prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify(rows),
  });
  if (!response.ok) throw new Error(`Meta reach upsert: ${response.status} ${await response.text()}`);
}

export async function syncMetaReach(env: Env, days = 90): Promise<{ accounts: number; rows: number }> {
  const accountIds = list(env.META_AD_ACCOUNT_IDS);
  if (!env.META_ACCESS_TOKEN || !env.META_GRAPH_VERSION || !accountIds.length) {
    throw new Error('Meta credentials are missing');
  }

  const until = new Date();
  const since = new Date(until.getTime() - (Math.max(1, days) - 1) * 86400000);
  const range = { since: since.toISOString().slice(0, 10), until: until.toISOString().slice(0, 10) };
  const output: JsonRecord[] = [];

  for (const accountId of accountIds) {
    const accountParams = new URLSearchParams({
      access_token: env.META_ACCESS_TOKEN,
      fields: 'id,name,account_status,currency,timezone_name',
    });
    const account = record(await (await fetch(`https://graph.facebook.com/${env.META_GRAPH_VERSION}/act_${accountId}?${accountParams}`)).json());

    const fields = [
      'account_id','account_name','campaign_id','campaign_name','adset_id','adset_name','ad_id','ad_name',
      'impressions','reach','frequency','clicks','inline_link_clicks','spend','actions','action_values','date_start','date_stop',
    ].join(',');
    const params = new URLSearchParams({
      access_token: env.META_ACCESS_TOKEN,
      level: 'ad',
      fields,
      time_increment: '1',
      time_range: JSON.stringify(range),
      limit: '500',
    });
    const insights = await fetchAll(`https://graph.facebook.com/${env.META_GRAPH_VERSION}/act_${accountId}/insights?${params}`);

    for (const item of insights) {
      const adId = text(item.ad_id);
      if (!adId) continue;
      output.push({
        external_id: `meta:${accountId}:${adId}`,
        report_date: text(item.date_start) || range.until,
        source: 'Meta',
        platform: 'Meta',
        account_id: accountId,
        account_name: text(item.account_name) || text(account.name) || accountId,
        account_status: text(account.account_status),
        currency: text(account.currency) || 'USD',
        account_timezone: text(account.timezone_name) || null,
        campaign_id: text(item.campaign_id),
        campaign_name: text(item.campaign_name) || 'Meta campaign',
        adset_id: text(item.adset_id),
        adset_name: text(item.adset_name),
        ad_id: adId,
        creative_name: text(item.ad_name),
        impressions: number(item.impressions),
        reach: number(item.reach),
        clicks: number(item.clicks),
        link_clicks: number(item.inline_link_clicks),
        spend: number(item.spend),
        metadata: { meta: item, frequency: number(item.frequency), reach_sync: true },
      });
    }
  }

  await upsert(env, output);
  return { accounts: accountIds.length, rows: output.length };
}

export async function handleMetaReachSync(request: Request, env: Env, url: URL): Promise<Response | null> {
  if (url.pathname !== '/api/integrations/meta/reach-sync' || request.method !== 'POST') return null;
  const body = await request.json().catch(() => ({})) as JsonRecord;
  const days = Math.min(Math.max(number(body.days) || 90, 1), 365);
  const result = await syncMetaReach(env, days);
  return new Response(JSON.stringify({ ok: true, ...result }), {
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}
