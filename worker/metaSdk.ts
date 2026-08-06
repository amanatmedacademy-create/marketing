import { resolveCompanyId } from './companyContext';

type JsonRecord = Record<string, unknown>;

export interface MetaSdkEnv {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  DEFAULT_COMPANY_ID?: string;
  INTEGRATION_ENCRYPTION_KEY?: string;
  META_APP_ID?: string;
  META_APP_SECRET?: string;
  META_GRAPH_VERSION?: string;
}

interface MetaAccount {
  id: string;
  account_id?: string;
  name?: string;
  account_status?: number | string;
  currency?: string;
  timezone_name?: string;
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
  try {
    parsed = body ? JSON.parse(body) : {};
  } catch {
    parsed = { error: { message: body } };
  }
  if (!response.ok) {
    const error = record(record(parsed).error);
    throw new Error(text(error.message) || `Meta API: ${response.status}`);
  }
  return parsed as T;
}

async function fetchAll(url: string): Promise<JsonRecord[]> {
  const rows: JsonRecord[] = [];
  let next: string | undefined = url;
  for (let page = 0; next && page < 100; page += 1) {
    const payload: { data?: JsonRecord[]; paging?: { next?: string } } = await fetchMeta(next);
    rows.push(...(payload.data || []));
    next = payload.paging?.next;
  }
  return rows;
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

function toMetaAccount(value: JsonRecord): MetaAccount | null {
  const id = text(value.id) || (text(value.account_id) ? `act_${text(value.account_id)}` : '');
  if (!id) return null;
  return {
    id,
    account_id: text(value.account_id) || undefined,
    name: text(value.name) || undefined,
    account_status: value.account_status == null ? undefined : (typeof value.account_status === 'number' ? value.account_status : text(value.account_status)),
    currency: text(value.currency) || undefined,
    timezone_name: text(value.timezone_name) || undefined,
  };
}

async function accounts(env: MetaSdkEnv, accessToken: string): Promise<MetaAccount[]> {
  const params = new URLSearchParams({
    fields: 'id,account_id,name,account_status,currency,timezone_name',
    limit: '200',
    access_token: accessToken,
  });
  const rows = await fetchAll(`https://graph.facebook.com/${graphVersion(env)}/me/adaccounts?${params}`);
  return rows.map(toMetaAccount).filter((item): item is MetaAccount => item !== null);
}

function supabaseHeaders(env: MetaSdkEnv, prefer: string): HeadersInit {
  return {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    'content-type': 'application/json',
    prefer,
  };
}

async function supabaseWrite(env: MetaSdkEnv, path: string, rows: unknown, prefer: string): Promise<void> {
  const response = await fetch(`${env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/${path}`, {
    method: 'POST',
    headers: supabaseHeaders(env, prefer),
    body: JSON.stringify(rows),
  });
  if (!response.ok) throw new Error(`Supabase: ${response.status} ${await response.text()}`);
}

async function save(env: MetaSdkEnv, companyId: string, accessToken: string, items: MetaAccount[]): Promise<void> {
  const ids = items.map((item) => item.id || (item.account_id ? `act_${item.account_id}` : '')).filter(Boolean);
  if (!ids.length) throw new Error('В профиле Facebook не найдено доступных рекламных кабинетов');

  const encrypted = await encrypt({
    accessToken,
    adAccountIds: ids.join(','),
    selectedAdIds: '',
    graphVersion: graphVersion(env),
    appSecret: env.META_APP_SECRET,
  }, encryptionSecret(env));

  const payload = {
    provider: 'meta',
    company_id: companyId,
    user_id: null,
    encrypted_payload: encrypted.encryptedPayload,
    iv: encrypted.iv,
    config_summary: {
      values: {
        adAccountIds: ids.join(','),
        selectedAdIds: '',
        graphVersion: graphVersion(env),
        accountNames: items.map((item) => item.name || item.id).join(', '),
        currencies: Object.fromEntries(items.map((item) => [text(item.id).replace(/^act_/, ''), item.currency || 'USD'])),
      },
      secretFields: {
        accessToken: true,
        webhookVerifyToken: false,
        appSecret: Boolean(env.META_APP_SECRET),
      },
    },
    status: 'connected',
    last_error: null,
    last_verified_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const base = env.SUPABASE_URL.replace(/\/$/, '');
  const filter = `company_id=eq.${encodeURIComponent(companyId)}&provider=eq.meta&user_id=is.null`;
  const updateResponse = await fetch(`${base}/rest/v1/integration_credentials?${filter}`, {
    method: 'PATCH',
    headers: supabaseHeaders(env, 'return=representation'),
    body: JSON.stringify(payload),
  });
  if (!updateResponse.ok) throw new Error(`Supabase: ${updateResponse.status} ${await updateResponse.text()}`);
  if ((await updateResponse.json() as JsonRecord[]).length) return;

  const insertResponse = await fetch(`${base}/rest/v1/integration_credentials`, {
    method: 'POST',
    headers: supabaseHeaders(env, 'return=minimal'),
    body: JSON.stringify(payload),
  });
  if (!insertResponse.ok) throw new Error(`Supabase: ${insertResponse.status} ${await insertResponse.text()}`);
}

function actionValue(items: unknown, accepted: string[]): number {
  if (!Array.isArray(items)) return 0;
  const types = new Set(accepted);
  return items.reduce((sum, item) => {
    const row = record(item);
    return types.has(text(row.action_type)) ? sum + number(row.value) : sum;
  }, 0);
}

const resultActions = [
  'lead',
  'onsite_conversion.lead_grouped',
  'offsite_conversion.fb_pixel_lead',
  'onsite_conversion.messaging_conversation_started_7d',
  'onsite_conversion.messaging_conversation_started',
  'onsite_conversion.messaging_first_reply',
  'onsite_conversion.messaging_conversation_replied_7d',
];

async function syncInsights(
  env: MetaSdkEnv,
  companyId: string,
  accessToken: string,
  items: MetaAccount[],
  days = 90,
): Promise<number> {
  const until = new Date();
  const since = new Date(until.getTime() - (days - 1) * 86400000);
  const range = { since: since.toISOString().slice(0, 10), until: until.toISOString().slice(0, 10) };
  const rows: JsonRecord[] = [];

  for (const account of items) {
    const accountId = text(account.id || account.account_id).replace(/^act_/, '');
    const base = `https://graph.facebook.com/${graphVersion(env)}`;
    const adParams = new URLSearchParams({
      access_token: accessToken,
      fields: 'id,name,status,effective_status,configured_status,created_time,updated_time,adset{id,name,status,effective_status,campaign{id,name,status,effective_status}}',
      limit: '500',
    });
    const ads = await fetchAll(`${base}/act_${accountId}/ads?${adParams}`);
    const adsById = new Map(ads.map((ad) => [text(ad.id), ad]));

    const fields = [
      'account_id','account_name','campaign_id','campaign_name','adset_id','adset_name','ad_id','ad_name',
      'impressions','reach','clicks','inline_link_clicks','spend','actions','action_values','date_start','date_stop',
    ].join(',');
    const insightParams = new URLSearchParams({
      access_token: accessToken,
      level: 'ad',
      fields,
      time_increment: '1',
      time_range: JSON.stringify(range),
      limit: '500',
    });
    const insights = await fetchAll(`${base}/act_${accountId}/insights?${insightParams}`);
    const seen = new Set<string>();

    for (const item of insights) {
      const adId = text(item.ad_id) || `account-${accountId}`;
      seen.add(adId);
      const ad = adsById.get(adId) || {};
      const adset = record(ad.adset);
      const campaign = record(adset.campaign);
      const effectiveStatus = text(ad.effective_status || ad.status) || 'UNKNOWN';
      const results = actionValue(item.actions, resultActions);
      rows.push({
        company_id: companyId,
        external_id: `meta:${accountId}:${adId}`,
        report_date: text(item.date_start) || range.until,
        source: 'Meta',
        platform: 'Meta',
        account_id: accountId,
        account_name: text(item.account_name) || account.name || accountId,
        account_status: text(account.account_status),
        currency: account.currency || 'USD',
        account_timezone: account.timezone_name || null,
        campaign_id: text(item.campaign_id || campaign.id),
        campaign_name: text(item.campaign_name || campaign.name) || 'Meta campaign',
        adset_id: text(item.adset_id || adset.id),
        adset_name: text(item.adset_name || adset.name),
        ad_id: adId,
        creative_name: text(item.ad_name || ad.name),
        creative_type: null,
        status: effectiveStatus,
        effective_status: effectiveStatus,
        impressions: number(item.impressions),
        reach: number(item.reach),
        clicks: number(item.clicks),
        link_clicks: number(item.inline_link_clicks),
        spend: number(item.spend),
        leads: results,
        results,
        result_indicator: results ? 'result' : null,
        cost_per_result: results ? number(item.spend) / results : 0,
        messaging_conversations_started: actionValue(item.actions, ['onsite_conversion.messaging_conversation_started_7d','onsite_conversion.messaging_conversation_started']),
        messaging_replies_7d: actionValue(item.actions, ['onsite_conversion.messaging_first_reply','onsite_conversion.messaging_conversation_replied_7d']),
        target_leads: 0,
        arrived: 0,
        sales: actionValue(item.actions, ['purchase','omni_purchase','offsite_conversion.fb_pixel_purchase']),
        revenue: actionValue(item.action_values, ['purchase','omni_purchase','offsite_conversion.fb_pixel_purchase']),
        utm_source: 'meta',
        utm_medium: 'paid_social',
        utm_campaign: text(item.campaign_id),
        utm_content: adId,
        metadata: { insight: item, ad, account },
      });
    }

    for (const ad of ads) {
      const adId = text(ad.id);
      if (!adId || seen.has(adId)) continue;
      const adset = record(ad.adset);
      const campaign = record(adset.campaign);
      const effectiveStatus = text(ad.effective_status || ad.status) || 'UNKNOWN';
      rows.push({
        company_id: companyId,
        external_id: `meta:${accountId}:${adId}`,
        report_date: range.until,
        source: 'Meta',
        platform: 'Meta',
        account_id: accountId,
        account_name: account.name || accountId,
        account_status: text(account.account_status),
        currency: account.currency || 'USD',
        account_timezone: account.timezone_name || null,
        campaign_id: text(campaign.id),
        campaign_name: text(campaign.name) || 'Meta campaign',
        adset_id: text(adset.id),
        adset_name: text(adset.name),
        ad_id: adId,
        creative_name: text(ad.name),
        status: effectiveStatus,
        effective_status: effectiveStatus,
        impressions: 0,
        reach: 0,
        clicks: 0,
        link_clicks: 0,
        spend: 0,
        leads: 0,
        results: 0,
        target_leads: 0,
        arrived: 0,
        sales: 0,
        revenue: 0,
        utm_source: 'meta',
        utm_medium: 'paid_social',
        utm_campaign: text(campaign.id),
        utm_content: adId,
        metadata: { ad, account, no_insights_in_period: true },
      });
    }
  }

  if (!rows.length) throw new Error('Meta не вернула рекламные объекты. Проверьте права ads_read и доступ к рекламным кабинетам.');
  await supabaseWrite(env, 'marketing_ads?on_conflict=company_id,external_id,report_date', rows, 'resolution=merge-duplicates,return=minimal');

  const refresh = await fetch(`${env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/rpc/refresh_meta_daily_metrics`, {
    method: 'POST',
    headers: supabaseHeaders(env, 'return=minimal'),
    body: JSON.stringify({ p_company_id: companyId }),
  });
  if (!refresh.ok) throw new Error(`Supabase metrics refresh: ${refresh.status} ${await refresh.text()}`);
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

      const companyId = await resolveCompanyId(env);
      const accessToken = await exchangeForLongToken(env, shortToken);
      const items = await accounts(env, accessToken);
      await save(env, companyId, accessToken, items);
      const written = await syncInsights(env, companyId, accessToken, items, 90);
      return json({
        ok: true,
        companyId,
        accounts: items.length,
        written,
        accountNames: items.map((item) => item.name || item.id),
      });
    } catch (error) {
      console.error('Meta SDK connection failed', error);
      return json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  }

  return null;
}
