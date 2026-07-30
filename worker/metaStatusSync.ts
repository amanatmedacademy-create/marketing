import type { Env } from './integrations';

type JsonRecord = Record<string, unknown>;

const record = (value: unknown): JsonRecord => value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {};
const text = (value: unknown): string => typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim();
const number = (value: unknown): number => Number.isFinite(Number(value)) ? Number(value) : 0;
const list = (value?: string): string[] => (value || '').split(',').map((item) => item.trim().replace(/^act_/, '')).filter(Boolean);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchJson(url: string): Promise<JsonRecord> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(url);
      const payload = record(await response.json());
      if (response.ok && !payload.error) return payload;
      const error = record(payload.error);
      const transient = response.status >= 500 || [1, 2, 4, 17, 32, 341].includes(number(error.code)) || Boolean(error.is_transient);
      lastError = new Error(`Meta status sync: ${response.status} ${JSON.stringify(payload.error || payload)}`);
      if (!transient || attempt === 2) throw lastError;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt === 2) throw lastError;
    }
    await sleep(750 * (attempt + 1));
  }
  throw lastError || new Error('Meta status sync failed');
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

async function updateStatuses(env: Env, payload: JsonRecord[]): Promise<number> {
  if (!payload.length) return 0;
  const response = await fetch(`${env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/rpc/bulk_update_meta_ad_statuses`, {
    method: 'POST',
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ payload }),
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`Meta status RPC: ${response.status} ${body}`);
  return Number(body || 0);
}

export async function syncMetaStatuses(env: Env): Promise<{ accounts: number; ads: number; rowsUpdated: number; errors: Array<{ accountId: string; error: string }> }> {
  const accountIds = list(env.META_AD_ACCOUNT_IDS);
  if (!env.META_ACCESS_TOKEN || !env.META_GRAPH_VERSION || !accountIds.length) throw new Error('Meta credentials are missing');

  let adsCount = 0;
  let rowsUpdated = 0;
  const errors: Array<{ accountId: string; error: string }> = [];

  for (const accountId of accountIds) {
    try {
      const accountParams = new URLSearchParams({ access_token: env.META_ACCESS_TOKEN, fields: 'id,account_status' });
      const account = await fetchJson(`https://graph.facebook.com/${env.META_GRAPH_VERSION}/act_${accountId}?${accountParams}`);
      const params = new URLSearchParams({
        access_token: env.META_ACCESS_TOKEN,
        fields: 'id,status,effective_status,configured_status',
        limit: '500',
      });
      const ads = await fetchAll(`https://graph.facebook.com/${env.META_GRAPH_VERSION}/act_${accountId}/ads?${params}`);
      const payload = ads.map((ad) => ({
        ad_id: text(ad.id),
        status: text(ad.status || ad.configured_status) || null,
        effective_status: text(ad.effective_status || ad.status || ad.configured_status) || null,
        account_status: text(account.account_status) || null,
      })).filter((item) => item.ad_id);
      adsCount += payload.length;
      rowsUpdated += await updateStatuses(env, payload);
    } catch (error) {
      errors.push({ accountId, error: error instanceof Error ? error.message : String(error) });
    }
  }

  if (!adsCount && errors.length === accountIds.length) throw new Error(errors.map((item) => `${item.accountId}: ${item.error}`).join('; '));
  return { accounts: accountIds.length, ads: adsCount, rowsUpdated, errors };
}

export async function handleMetaStatusSync(request: Request, env: Env, url: URL): Promise<Response | null> {
  if (url.pathname !== '/api/integrations/meta/status-sync' || request.method !== 'POST') return null;
  const result = await syncMetaStatuses(env);
  return new Response(JSON.stringify({ ok: true, ...result }), {
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}
