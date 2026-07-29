type JsonRecord = Record<string, unknown>;

export interface MetaSdkEnv {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  INTEGRATION_ENCRYPTION_KEY?: string;
  META_APP_ID?: string;
  META_APP_SECRET?: string;
  META_GRAPH_VERSION?: string;
}

interface MetaAccount {
  id: string;
  account_id?: string;
  name?: string;
}

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});

const text = (value: unknown): string => typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim();
const record = (value: unknown): JsonRecord => value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {};
const number = (value: unknown): number => Number.isFinite(Number(value)) ? Number(value) : 0;

function graphVersion(env: MetaSdkEnv): string {
  const value = text(env.META_GRAPH_VERSION) || 'v23.0';
  return value.startsWith('v') ? value : `v${value}`;
}

function encryptionSecret(env: MetaSdkEnv): string {
  return text(env.INTEGRATION_ENCRYPTION_KEY) || `amanat-integrations:v1:${env.SUPABASE_SERVICE_ROLE_KEY}`;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function encrypt(payload: JsonRecord, secret: string): Promise<{ encryptedPayload: string; iv: string }> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret));
  const key = await crypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(payload)));
  return { encryptedPayload: bytesToBase64(new Uint8Array(encrypted)), iv: bytesToBase64(iv) };
}

async function fetchMeta<T>(url: string): Promise<T> {
  const response = await fetch(url, { headers: { accept: 'application/json' } });
  const body = await response.text();
  let parsed: unknown = {};
  try { parsed = body ? JSON.parse(body) : {}; } catch { parsed = { error: { message: body } }; }
  if (!response.ok) {
    const error = record(record(parsed).error);
    throw new Error(text(error.message) || `Meta API: ${response.status}`);
  }
  return parsed as T;
}

async function exchangeForLongToken(env: MetaSdkEnv, shortToken: string): Promise<string> {
  if (!env.META_APP_ID || !env.META_APP_SECRET) throw new Error('META_APP_ID или META_APP_SECRET не настроены');
  const params = new URLSearchParams({
    grant_type: 'fb_exchange_token',
    client_id: env.META_APP_ID,
    client_secret: env.META_APP_SECRET,
    fb_exchange_token: shortToken,
  });
  const result = await fetchMeta<{ access_token?: string }>(`https://graph.facebook.com/${graphVersion(env)}/oauth/access_token?${params}`);
  return result.access_token || shortToken;
}

async function accounts(env: MetaSdkEnv, accessToken: string): Promise<MetaAccount[]> {
  const result: MetaAccount[] = [];
  const params = new URLSearchParams({
    fields: 'id,account_id,name,account_status,currency,timezone_name',
    limit: '200',
    access_token: accessToken,
  });
  let next: string | undefined = `https://graph.facebook.com/${graphVersion(env)}/me/adaccounts?${params}`;
  while (next) {
    const page: { data?: MetaAccount[]; paging?: { next?: string } } = await fetchMeta(next);
    result.push(...(page.data || []));
    next = page.paging?.next;
    if (result.length >= 1000) break;
  }
  return result;
}

async function supabaseWrite(env: MetaSdkEnv, path: string, rows: unknown, prefer: string): Promise<void> {
  const response = await fetch(`${env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/${path}`, {
    method: 'POST',
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      'content-type': 'application/json',
      prefer,
    },
    body: JSON.stringify(rows),
  });
  if (!response.ok) throw new Error(`Supabase: ${response.status} ${await response.text()}`);
}

async function save(env: MetaSdkEnv, accessToken: string, items: MetaAccount[]): Promise<void> {
  const ids = items.map((item) => item.id || (item.account_id ? `act_${item.account_id}` : '')).filter(Boolean);
  if (!ids.length) throw new Error('В профиле Facebook не найдено доступных рекламных кабинетов');
  const encrypted = await encrypt({ accessToken, adAccountIds: ids.join(','), graphVersion: graphVersion(env), appSecret: env.META_APP_SECRET }, encryptionSecret(env));
  await supabaseWrite(env, 'integration_credentials?on_conflict=provider', {
    provider: 'meta',
    encrypted_payload: encrypted.encryptedPayload,
    iv: encrypted.iv,
    config_summary: {
      values: { adAccountIds: ids.join(','), graphVersion: graphVersion(env), accountNames: items.map((item) => item.name || item.id).join(', ') },
      secretFields: { accessToken: true, webhookVerifyToken: false, appSecret: Boolean(env.META_APP_SECRET) },
    },
    status: 'connected',
    last_error: null,
    last_verified_at: new Date().toISOString(),
  }, 'resolution=merge-duplicates,return=minimal');
}

function actionValue(items: unknown, accepted: string[]): number {
  if (!Array.isArray(items)) return 0;
  const types = new Set(accepted);
  return items.reduce((sum, item) => {
    const row = record(item);
    return types.has(text(row.action_type)) ? sum + number(row.value) : sum;
  }, 0);
}

async function syncInsights(env: MetaSdkEnv, accessToken: string, items: MetaAccount[], days = 90): Promise<number> {
  const until = new Date();
  const since = new Date(until.getTime() - (days - 1) * 86400000);
  const range = { since: since.toISOString().slice(0, 10), until: until.toISOString().slice(0, 10) };
  const rows: JsonRecord[] = [];

  for (const account of items) {
    const accountId = text(account.id || account.account_id).replace(/^act_/, '');
    const fields = ['account_id','account_name','campaign_id','campaign_name','adset_id','adset_name','ad_id','ad_name','impressions','reach','clicks','inline_link_clicks','spend','actions','action_values','date_start','date_stop'].join(',');
    const params = new URLSearchParams({
      access_token: accessToken,
      level: 'ad',
      fields,
      time_increment: '1',
      time_range: JSON.stringify(range),
      limit: '500',
    });
    let next: string | undefined = `https://graph.facebook.com/${graphVersion(env)}/act_${accountId}/insights?${params}`;
    while (next) {
      const page: { data?: JsonRecord[]; paging?: { next?: string } } = await fetchMeta(next);
      for (const item of page.data || []) {
        const adId = text(item.ad_id) || `account-${accountId}`;
        rows.push({
          external_id: `meta:${accountId}:${adId}`,
          report_date: text(item.date_start) || range.until,
          source: 'Meta',
          platform: 'Meta',
          account_id: accountId,
          account_name: text(item.account_name) || account.name || accountId,
          campaign_id: text(item.campaign_id),
          campaign_name: text(item.campaign_name) || 'Meta campaign',
          adset_id: text(item.adset_id),
          adset_name: text(item.adset_name),
          ad_id: adId,
          creative_name: text(item.ad_name),
          creative_type: null,
          status: null,
          impressions: number(item.impressions),
          reach: number(item.reach),
          clicks: number(item.clicks),
          link_clicks: number(item.inline_link_clicks),
          spend: number(item.spend),
          leads: actionValue(item.actions, ['lead','onsite_conversion.lead_grouped','offsite_conversion.fb_pixel_lead']),
          target_leads: 0,
          arrived: 0,
          sales: actionValue(item.actions, ['purchase','omni_purchase','offsite_conversion.fb_pixel_purchase']),
          revenue: actionValue(item.action_values, ['purchase','omni_purchase','offsite_conversion.fb_pixel_purchase']),
          utm_source: 'meta',
          utm_medium: 'paid_social',
          utm_campaign: text(item.campaign_id),
          utm_content: text(item.ad_id),
          metadata: { meta: item },
        });
      }
      next = page.paging?.next;
    }
  }

  if (!rows.length) throw new Error(`Meta не вернула статистику за ${range.since} — ${range.until}. Проверьте, что у выбранных кабинетов были показы и расход в этот период.`);
  await supabaseWrite(env, 'marketing_ads?on_conflict=external_id,report_date', rows, 'resolution=merge-duplicates,return=minimal');
  return rows.length;
}

export async function handleMetaSdkRequest(request: Request, env: MetaSdkEnv, url: URL): Promise<Response | null> {
  if (url.pathname === '/api/integrations/meta/sdk-config' && request.method === 'GET') {
    const appId = text(env.META_APP_ID);
    return json({ configured: Boolean(appId && env.META_APP_SECRET), appId, version: graphVersion(env) }, appId ? 200 : 503);
  }

  if (url.pathname === '/api/integrations/meta/sdk-connect' && request.method === 'POST') {
    try {
      const payload = record(await request.json());
      const shortToken = text(payload.accessToken);
      if (!shortToken) return json({ error: 'Facebook accessToken не получен' }, 400);
      const accessToken = await exchangeForLongToken(env, shortToken);
      const items = await accounts(env, accessToken);
      await save(env, accessToken, items);
      const written = await syncInsights(env, accessToken, items, 90);
      return json({ ok: true, accounts: items.length, written, accountNames: items.map((item) => item.name || item.id) });
    } catch (error) {
      console.error('Meta SDK connection failed', error);
      return json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  }

  return null;
}
