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

async function save(env: MetaSdkEnv, accessToken: string, items: MetaAccount[]): Promise<void> {
  const ids = items.map((item) => item.id || (item.account_id ? `act_${item.account_id}` : '')).filter(Boolean);
  if (!ids.length) throw new Error('В профиле Facebook не найдено доступных рекламных кабинетов');
  const encrypted = await encrypt({
    accessToken,
    adAccountIds: ids.join(','),
    graphVersion: graphVersion(env),
    appSecret: env.META_APP_SECRET,
  }, encryptionSecret(env));
  const response = await fetch(`${env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/integration_credentials?on_conflict=provider`, {
    method: 'POST',
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      'content-type': 'application/json',
      prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify({
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
    }),
  });
  if (!response.ok) throw new Error(`Supabase: ${response.status} ${await response.text()}`);
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
      return json({ ok: true, accounts: items.length, accountNames: items.map((item) => item.name || item.id) });
    } catch (error) {
      console.error('Meta SDK connection failed', error);
      return json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  }

  return null;
}
