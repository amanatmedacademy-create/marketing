import { resolveCompanyId } from './companyContext';

type Row = Record<string, unknown>;
type GoogleProvider = 'google_ads' | 'ga4';

type StoredCredential = {
  id: string;
  provider: GoogleProvider;
  encrypted_payload: string;
  iv: string;
  config_summary: Row;
  status: string;
  last_error?: string | null;
  last_verified_at?: string | null;
  updated_at: string;
};

export interface GoogleIntegrationEnv {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  DEFAULT_COMPANY_ID?: string;
  INTEGRATION_ENCRYPTION_KEY?: string;
}

const text = (value: unknown): string => typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim();
const number = (value: unknown): number => {
  const parsed = typeof value === 'number' ? value : Number(String(value ?? '').replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : 0;
};
const record = (value: unknown): Row => value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {};
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
const csv = (value: unknown): string[] => text(value).split(',').map((item) => item.trim()).filter(Boolean);
const iso = (value: Date): string => value.toISOString().slice(0, 10);

function dbHeaders(env: GoogleIntegrationEnv, extra: HeadersInit = {}): Headers {
  const headers = new Headers(extra);
  headers.set('apikey', env.SUPABASE_SERVICE_ROLE_KEY);
  headers.set('authorization', `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`);
  headers.set('accept', 'application/json');
  if (!headers.has('content-type')) headers.set('content-type', 'application/json');
  return headers;
}

async function db<T>(env: GoogleIntegrationEnv, path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/${path}`, { ...init, headers: dbHeaders(env, init.headers), cache: 'no-store' });
  const body = await response.text();
  if (!response.ok) throw new Error(`Google integration DB ${response.status}: ${body.slice(0, 1600)}`);
  return (body ? JSON.parse(body) : null) as T;
}

function encryptionSecret(env: GoogleIntegrationEnv): string {
  return text(env.INTEGRATION_ENCRYPTION_KEY) || `amanat-integrations:v1:${env.SUPABASE_SERVICE_ROLE_KEY}`;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

async function cryptoKey(env: GoogleIntegrationEnv): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(encryptionSecret(env)));
  return crypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

async function encrypt(env: GoogleIntegrationEnv, payload: Row): Promise<{ encrypted_payload: string; iv: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const value = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await cryptoKey(env), new TextEncoder().encode(JSON.stringify(payload)));
  return { encrypted_payload: bytesToBase64(new Uint8Array(value)), iv: bytesToBase64(iv) };
}

async function decrypt(env: GoogleIntegrationEnv, row: StoredCredential): Promise<Row> {
  const value = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: base64ToBytes(row.iv) }, await cryptoKey(env), base64ToBytes(row.encrypted_payload));
  return record(JSON.parse(new TextDecoder().decode(value)));
}

async function findCredential(env: GoogleIntegrationEnv, provider: GoogleProvider): Promise<StoredCredential | null> {
  const companyId = await resolveCompanyId(env);
  const rows = await db<StoredCredential[]>(env, `integration_credentials?company_id=eq.${encodeURIComponent(companyId)}&user_id=is.null&provider=eq.${provider}&select=*&limit=1`);
  return rows[0] || null;
}

function publicConfig(provider: GoogleProvider, row: StoredCredential | null) {
  const summary = record(row?.config_summary);
  return {
    provider,
    configured: Boolean(row),
    status: row?.status || 'not_configured',
    values: record(summary.values),
    secretFields: record(summary.secretFields),
    updatedAt: row?.updated_at || null,
    lastVerifiedAt: row?.last_verified_at || null,
    lastError: row?.last_error || null,
  };
}

function summarize(provider: GoogleProvider, payload: Row): Row {
  const secretNames = provider === 'google_ads' ? ['clientSecret', 'refreshToken', 'developerToken'] : ['clientSecret', 'refreshToken'];
  const values: Row = {};
  const secretFields: Row = {};
  for (const [key, value] of Object.entries(payload)) {
    if (secretNames.includes(key)) secretFields[key] = Boolean(text(value));
    else values[key] = text(value);
  }
  return { values, secretFields };
}

function required(provider: GoogleProvider, payload: Row): string[] {
  const fields = provider === 'google_ads'
    ? ['clientId', 'clientSecret', 'refreshToken', 'developerToken', 'customerIds']
    : ['clientId', 'clientSecret', 'refreshToken', 'propertyIds'];
  return fields.filter((field) => !text(payload[field]));
}

async function saveCredential(env: GoogleIntegrationEnv, provider: GoogleProvider, incoming: Row): Promise<StoredCredential> {
  const companyId = await resolveCompanyId(env);
  const existing = await findCredential(env, provider);
  let payload: Row = {};
  if (existing) {
    try { payload = await decrypt(env, existing); } catch { payload = {}; }
  }
  for (const [key, value] of Object.entries(incoming)) {
    if (text(value)) payload[key] = text(value);
    else if (!['clientSecret', 'refreshToken', 'developerToken'].includes(key)) payload[key] = value;
  }
  const missing = required(provider, payload);
  if (missing.length) throw new Error(`Заполните обязательные поля: ${missing.join(', ')}`);
  if (provider === 'google_ads' && !text(payload.apiVersion)) payload.apiVersion = 'v25';
  const encrypted = await encrypt(env, payload);
  const stored = {
    company_id: companyId,
    user_id: null,
    provider,
    ...encrypted,
    config_summary: summarize(provider, payload),
    status: 'configured',
    last_error: null,
    updated_at: new Date().toISOString(),
  };
  const rows = existing
    ? await db<StoredCredential[]>(env, `integration_credentials?id=eq.${encodeURIComponent(existing.id)}&select=*`, { method: 'PATCH', headers: { prefer: 'return=representation' }, body: JSON.stringify(stored) })
    : await db<StoredCredential[]>(env, 'integration_credentials?select=*', { method: 'POST', headers: { prefer: 'return=representation' }, body: JSON.stringify(stored) });
  if (!rows[0]) throw new Error('Google credential was not saved');
  return rows[0];
}

async function accessToken(payload: Row): Promise<string> {
  const body = new URLSearchParams({
    client_id: text(payload.clientId),
    client_secret: text(payload.clientSecret),
    refresh_token: text(payload.refreshToken),
    grant_type: 'refresh_token',
  });
  const response = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body });
  const result = record(await response.json().catch(() => ({})));
  const token = text(result.access_token);
  if (!response.ok || !token) throw new Error(`Google OAuth ${response.status}: ${JSON.stringify(result).slice(0, 900)}`);
  return token;
}

async function markStatus(env: GoogleIntegrationEnv, row: StoredCredential, ok: boolean, error?: unknown): Promise<void> {
  await db(env, `integration_credentials?id=eq.${encodeURIComponent(row.id)}`, {
    method: 'PATCH',
    headers: { prefer: 'return=minimal' },
    body: JSON.stringify({ status: ok ? 'connected' : 'error', last_verified_at: new Date().toISOString(), last_error: ok ? null : error instanceof Error ? error.message : String(error || 'Google integration error') }),
  });
}

async function insertRun(env: GoogleIntegrationEnv, source: GoogleProvider, from: string, to: string): Promise<string | null> {
  try {
    const companyId = await resolveCompanyId(env);
    const rows = await db<Array<{ id: string }>>(env, 'integration_runs?select=id', { method: 'POST', headers: { prefer: 'return=representation' }, body: JSON.stringify({ company_id: companyId, source, status: 'running', date_from: from, date_to: to, started_at: new Date().toISOString() }) });
    return rows[0]?.id || null;
  } catch { return null; }
}

async function finishRun(env: GoogleIntegrationEnv, id: string | null, status: 'success' | 'failed', fetched: number, written: number, error?: unknown): Promise<void> {
  if (!id) return;
  await db(env, `integration_runs?id=eq.${encodeURIComponent(id)}`, { method: 'PATCH', headers: { prefer: 'return=minimal' }, body: JSON.stringify({ status, fetched, written, error: error ? (error instanceof Error ? error.message : String(error)) : null, finished_at: new Date().toISOString() }) }).catch(() => undefined);
}

async function syncGoogleAds(env: GoogleIntegrationEnv, row: StoredCredential, payload: Row, from: string, to: string): Promise<{ fetched: number; written: number }> {
  const token = await accessToken(payload);
  const companyId = await resolveCompanyId(env);
  const apiVersion = text(payload.apiVersion) || 'v25';
  const customerIds = csv(payload.customerIds).map((id) => id.replace(/\D/g, '')).filter(Boolean);
  const loginCustomerId = text(payload.loginCustomerId).replace(/\D/g, '');
  const rows: Row[] = [];
  const query = `SELECT segments.date, customer.id, customer.descriptive_name, campaign.id, campaign.name, ad_group.id, ad_group.name, ad_group_ad.ad.id, ad_group_ad.status, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions, metrics.conversions_value FROM ad_group_ad WHERE segments.date BETWEEN '${from}' AND '${to}'`;
  for (const customerId of customerIds) {
    const headers = new Headers({ authorization: `Bearer ${token}`, 'developer-token': text(payload.developerToken), 'content-type': 'application/json' });
    if (loginCustomerId) headers.set('login-customer-id', loginCustomerId);
    const response = await fetch(`https://googleads.googleapis.com/${apiVersion}/customers/${customerId}/googleAds:searchStream`, { method: 'POST', headers, body: JSON.stringify({ query }) });
    const result = await response.json().catch(() => null) as unknown;
    if (!response.ok || !Array.isArray(result)) throw new Error(`Google Ads ${response.status}: ${JSON.stringify(result).slice(0, 1400)}`);
    for (const batch of result) {
      const results = Array.isArray(record(batch).results) ? record(batch).results as unknown[] : [];
      for (const raw of results) {
        const item = record(raw); const customer = record(item.customer); const campaign = record(item.campaign); const adGroup = record(item.adGroup); const adGroupAd = record(item.adGroupAd); const ad = record(adGroupAd.ad); const metrics = record(item.metrics); const segments = record(item.segments);
        const adId = text(ad.id) || crypto.randomUUID();
        rows.push({
          company_id: companyId,
          external_id: `google:${customerId}:${adId}`,
          report_date: text(segments.date) || to,
          source: 'Google Ads', platform: 'Google Ads', account_id: text(customer.id) || customerId, account_name: text(customer.descriptiveName),
          campaign_id: text(campaign.id), campaign_name: text(campaign.name) || 'Google campaign', adset_id: text(adGroup.id), adset_name: text(adGroup.name), ad_id: adId,
          creative_name: `Ad ${adId}`, creative_type: null, status: text(adGroupAd.status), impressions: number(metrics.impressions), clicks: number(metrics.clicks),
          spend: number(metrics.costMicros) / 1_000_000, leads: number(metrics.conversions), target_leads: 0, arrived: 0, sales: 0, revenue: number(metrics.conversionsValue),
          utm_source: 'google', utm_medium: 'cpc', metadata: { google_ads: item },
        });
      }
    }
  }
  if (rows.length) await db(env, `marketing_ads?on_conflict=${encodeURIComponent('company_id,external_id,report_date')}`, { method: 'POST', headers: { prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(rows) });
  return { fetched: rows.length, written: rows.length };
}

async function syncGa4(env: GoogleIntegrationEnv, row: StoredCredential, payload: Row, from: string, to: string): Promise<{ fetched: number; written: number }> {
  const token = await accessToken(payload);
  const companyId = await resolveCompanyId(env);
  const rows: Row[] = [];
  for (const propertyIdRaw of csv(payload.propertyIds)) {
    const propertyId = propertyIdRaw.replace(/^properties\//, '').replace(/\D/g, '');
    const response = await fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        dateRanges: [{ startDate: from, endDate: to }],
        dimensions: [{ name: 'date' }, { name: 'sessionSource' }, { name: 'sessionMedium' }, { name: 'sessionCampaignName' }],
        metrics: [{ name: 'totalUsers' }, { name: 'sessions' }, { name: 'keyEvents' }, { name: 'purchaseRevenue' }],
        limit: 100000,
      }),
    });
    const result = record(await response.json().catch(() => ({})));
    if (!response.ok) throw new Error(`GA4 ${response.status}: ${JSON.stringify(result).slice(0, 1400)}`);
    const dataRows = Array.isArray(result.rows) ? result.rows as unknown[] : [];
    for (const raw of dataRows) {
      const item = record(raw); const dims = Array.isArray(item.dimensionValues) ? item.dimensionValues.map(record) : []; const metrics = Array.isArray(item.metricValues) ? item.metricValues.map(record) : [];
      const dateRaw = text(dims[0]?.value); const date = /^\d{8}$/.test(dateRaw) ? `${dateRaw.slice(0,4)}-${dateRaw.slice(4,6)}-${dateRaw.slice(6,8)}` : from;
      rows.push({ company_id: companyId, report_date: date, source: text(dims[1]?.value) || '(direct)', medium: text(dims[2]?.value) || '(none)', campaign: text(dims[3]?.value) || '(not set)', users: number(metrics[0]?.value), sessions: number(metrics[1]?.value), key_events: number(metrics[2]?.value), revenue: number(metrics[3]?.value), metadata: { property_id: propertyId, ga4: item } });
    }
  }
  if (rows.length) await db(env, `marketing_web_analytics?on_conflict=${encodeURIComponent('company_id,report_date,source,medium,campaign')}`, { method: 'POST', headers: { prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(rows) });
  return { fetched: rows.length, written: rows.length };
}

async function syncProvider(env: GoogleIntegrationEnv, provider: GoogleProvider, days: number): Promise<Row> {
  const row = await findCredential(env, provider);
  if (!row) throw new Error(`${provider === 'google_ads' ? 'Google Ads' : 'GA4'} не настроен`);
  const payload = await decrypt(env, row);
  const end = new Date(); const start = new Date(end.getTime() - (Math.max(1, days) - 1) * 86400000); const from = iso(start); const to = iso(end); const runId = await insertRun(env, provider, from, to);
  try {
    const result = provider === 'google_ads' ? await syncGoogleAds(env, row, payload, from, to) : await syncGa4(env, row, payload, from, to);
    await markStatus(env, row, true); await finishRun(env, runId, 'success', result.fetched, result.written);
    return { ok: true, provider, from, to, ...result };
  } catch (error) {
    await markStatus(env, row, false, error); await finishRun(env, runId, 'failed', 0, 0, error); throw error;
  }
}

export async function handleGoogleIntegrationRequest(request: Request, env: GoogleIntegrationEnv, url: URL): Promise<Response | null> {
  if (!url.pathname.startsWith('/api/integrations/google')) return null;
  const role = text(request.headers.get('x-amanat-auth-role'));
  if (role !== 'administrator' && role !== 'super_admin') return json({ error: 'Настройки Google доступны только администратору' }, 403);

  if (url.pathname === '/api/integrations/google/config' && request.method === 'GET') {
    const [ads, ga4] = await Promise.all([findCredential(env, 'google_ads'), findCredential(env, 'ga4')]);
    return json({ providers: [publicConfig('google_ads', ads), publicConfig('ga4', ga4)] });
  }

  const configMatch = url.pathname.match(/^\/api\/integrations\/google\/config\/(google_ads|ga4)$/);
  if (configMatch) {
    const provider = configMatch[1] as GoogleProvider;
    if (request.method === 'PUT') {
      try { return json({ ok: true, provider: publicConfig(provider, await saveCredential(env, provider, record(await request.json().catch(() => ({}))))) }); }
      catch (error) { return json({ error: error instanceof Error ? error.message : String(error) }, 400); }
    }
    if (request.method === 'DELETE') {
      const companyId = await resolveCompanyId(env);
      await db(env, `integration_credentials?company_id=eq.${encodeURIComponent(companyId)}&user_id=is.null&provider=eq.${provider}`, { method: 'DELETE', headers: { prefer: 'return=minimal' } });
      return json({ ok: true, provider });
    }
  }

  const syncMatch = url.pathname.match(/^\/api\/integrations\/google\/sync\/(google_ads|ga4)$/);
  if (syncMatch && request.method === 'POST') {
    const input = record(await request.json().catch(() => ({})));
    const days = Math.min(Math.max(number(input.days) || 30, 1), 365);
    try { return json(await syncProvider(env, syncMatch[1] as GoogleProvider, days)); }
    catch (error) { return json({ error: error instanceof Error ? error.message : String(error) }, 400); }
  }

  return json({ error: 'Google integration route not found' }, 404);
}