type JsonRecord = Record<string, unknown>;

export interface MetaOAuthEnv {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  INTEGRATION_ENCRYPTION_KEY?: string;
  META_APP_ID?: string;
  META_APP_SECRET?: string;
  META_GRAPH_VERSION?: string;
  META_OAUTH_REDIRECT_URI?: string;
}

interface MetaTokenResponse {
  access_token?: string;
  token_type?: string;
  expires_in?: number;
  error?: { message?: string; type?: string; code?: number };
}

interface MetaAdAccount {
  id: string;
  account_id?: string;
  name?: string;
  account_status?: number;
  currency?: string;
  timezone_name?: string;
}

interface MetaAdAccountsResponse {
  data?: MetaAdAccount[];
  paging?: { next?: string };
  error?: { message?: string; type?: string; code?: number };
}

const DEFAULT_REDIRECT_URI = 'https://marketing.amanat-med-academy.workers.dev/api/integrations/meta/callback';
const STATE_COOKIE = 'amanat_meta_oauth_state';

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});

const asRecord = (value: unknown): JsonRecord => value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {};
const asString = (value: unknown): string => typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim();

function encryptionSecret(env: MetaOAuthEnv): string {
  const explicit = asString(env.INTEGRATION_ENCRYPTION_KEY);
  if (explicit) return explicit;
  if (!env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY не настроен');
  return `amanat-integrations:v1:${env.SUPABASE_SERVICE_ROLE_KEY}`;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function encryptionKey(secret: string): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret));
  return crypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, ['encrypt']);
}

async function encryptPayload(payload: JsonRecord, secret: string): Promise<{ encryptedPayload: string; iv: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await encryptionKey(secret);
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(payload)));
  return { encryptedPayload: bytesToBase64(new Uint8Array(encrypted)), iv: bytesToBase64(iv) };
}

async function supabase(env: MetaOAuthEnv, path: string, init: RequestInit = {}): Promise<unknown> {
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
  if (!response.ok) throw new Error(`Supabase: ${response.status} ${body}`);
  return body ? JSON.parse(body) : null;
}

function cookieValue(request: Request, name: string): string {
  const cookie = request.headers.get('cookie') || '';
  for (const item of cookie.split(';')) {
    const [key, ...parts] = item.trim().split('=');
    if (key === name) return decodeURIComponent(parts.join('='));
  }
  return '';
}

function redirectUri(env: MetaOAuthEnv): string {
  return asString(env.META_OAUTH_REDIRECT_URI) || DEFAULT_REDIRECT_URI;
}

function graphVersion(env: MetaOAuthEnv): string {
  const value = asString(env.META_GRAPH_VERSION) || 'v23.0';
  return value.startsWith('v') ? value : `v${value}`;
}

function requireMetaApp(env: MetaOAuthEnv): { appId: string; appSecret: string } {
  const appId = asString(env.META_APP_ID);
  const appSecret = asString(env.META_APP_SECRET);
  if (!appId || !appSecret) throw new Error('META_APP_ID или META_APP_SECRET не настроены в Cloudflare');
  return { appId, appSecret };
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { headers: { accept: 'application/json' } });
  const body = await response.text();
  let parsed: unknown = {};
  try { parsed = body ? JSON.parse(body) : {}; } catch { parsed = { error: { message: body } }; }
  if (!response.ok) {
    const error = asRecord(asRecord(parsed).error);
    throw new Error(asString(error.message) || `Meta API: ${response.status}`);
  }
  return parsed as T;
}

async function exchangeCode(env: MetaOAuthEnv, code: string): Promise<string> {
  const { appId, appSecret } = requireMetaApp(env);
  const version = graphVersion(env);
  const params = new URLSearchParams({
    client_id: appId,
    client_secret: appSecret,
    redirect_uri: redirectUri(env),
    code,
  });
  const shortToken = await fetchJson<MetaTokenResponse>(`https://graph.facebook.com/${version}/oauth/access_token?${params.toString()}`);
  if (!shortToken.access_token) throw new Error(shortToken.error?.message || 'Meta не вернула access token');

  const longParams = new URLSearchParams({
    grant_type: 'fb_exchange_token',
    client_id: appId,
    client_secret: appSecret,
    fb_exchange_token: shortToken.access_token,
  });
  const longToken = await fetchJson<MetaTokenResponse>(`https://graph.facebook.com/${version}/oauth/access_token?${longParams.toString()}`);
  return longToken.access_token || shortToken.access_token;
}

async function listAdAccounts(env: MetaOAuthEnv, accessToken: string): Promise<MetaAdAccount[]> {
  const accounts: MetaAdAccount[] = [];
  const params = new URLSearchParams({
    fields: 'id,account_id,name,account_status,currency,timezone_name',
    limit: '200',
    access_token: accessToken,
  });
  let next: string | undefined = `https://graph.facebook.com/${graphVersion(env)}/me/adaccounts?${params.toString()}`;
  while (next) {
    const page: MetaAdAccountsResponse = await fetchJson<MetaAdAccountsResponse>(next);
    accounts.push(...(page.data || []));
    next = page.paging?.next;
    if (accounts.length >= 1000) break;
  }
  return accounts;
}

async function saveMetaCredentials(env: MetaOAuthEnv, accessToken: string, accounts: MetaAdAccount[]): Promise<void> {
  const { appSecret } = requireMetaApp(env);
  const accountIds = accounts.map((account) => account.id || (account.account_id ? `act_${account.account_id}` : '')).filter(Boolean);
  if (!accountIds.length) throw new Error('В Facebook-профиле не найдено доступных рекламных кабинетов');

  const payload: JsonRecord = {
    accessToken,
    adAccountIds: accountIds.join(','),
    graphVersion: graphVersion(env),
    appSecret,
  };
  const encrypted = await encryptPayload(payload, encryptionSecret(env));
  const summary = {
    values: {
      adAccountIds: accountIds.join(','),
      graphVersion: graphVersion(env),
      accountNames: accounts.map((account) => account.name || account.id).join(', '),
    },
    secretFields: { accessToken: true, webhookVerifyToken: false, appSecret: true },
  };

  await supabase(env, 'integration_credentials?on_conflict=provider', {
    method: 'POST',
    headers: { prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({
      provider: 'meta',
      encrypted_payload: encrypted.encryptedPayload,
      iv: encrypted.iv,
      config_summary: summary,
      status: 'connected',
      last_error: null,
      last_verified_at: new Date().toISOString(),
    }),
  });
}

function successRedirect(accounts: number): Response {
  const target = new URL('/integrations', DEFAULT_REDIRECT_URI);
  target.searchParams.set('meta', 'connected');
  target.searchParams.set('accounts', String(accounts));
  return new Response(null, {
    status: 302,
    headers: {
      location: target.toString(),
      'set-cookie': `${STATE_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`,
      'cache-control': 'no-store',
    },
  });
}

function errorRedirect(message: string): Response {
  const target = new URL('/integrations', DEFAULT_REDIRECT_URI);
  target.searchParams.set('meta', 'error');
  target.searchParams.set('message', message.slice(0, 300));
  return new Response(null, {
    status: 302,
    headers: {
      location: target.toString(),
      'set-cookie': `${STATE_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`,
      'cache-control': 'no-store',
    },
  });
}

export async function handleMetaOAuthRequest(request: Request, env: MetaOAuthEnv, url: URL): Promise<Response | null> {
  if (url.pathname === '/api/integrations/meta/connect' && request.method === 'GET') {
    const { appId } = requireMetaApp(env);
    const state = crypto.randomUUID().replace(/-/g, '');
    const params = new URLSearchParams({
      client_id: appId,
      redirect_uri: redirectUri(env),
      state,
      response_type: 'code',
      scope: 'ads_read,read_insights,business_management',
    });
    return new Response(null, {
      status: 302,
      headers: {
        location: `https://www.facebook.com/${graphVersion(env)}/dialog/oauth?${params.toString()}`,
        'set-cookie': `${STATE_COOKIE}=${encodeURIComponent(state)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`,
        'cache-control': 'no-store',
      },
    });
  }

  if (url.pathname === '/api/integrations/meta/callback' && request.method === 'GET') {
    try {
      const error = url.searchParams.get('error_message') || url.searchParams.get('error_description');
      if (error) throw new Error(error);
      const code = url.searchParams.get('code') || '';
      const state = url.searchParams.get('state') || '';
      const expectedState = cookieValue(request, STATE_COOKIE);
      if (!code) throw new Error('Meta не вернула authorization code');
      if (!state || !expectedState || state !== expectedState) throw new Error('OAuth state не совпадает. Повторите подключение.');
      const accessToken = await exchangeCode(env, code);
      const accounts = await listAdAccounts(env, accessToken);
      await saveMetaCredentials(env, accessToken, accounts);
      return successRedirect(accounts.length);
    } catch (error) {
      console.error('Meta OAuth callback failed', error);
      return errorRedirect(error instanceof Error ? error.message : 'Ошибка подключения Meta');
    }
  }

  if (url.pathname === '/api/integrations/meta/oauth-config' && request.method === 'GET') {
    const configured = Boolean(asString(env.META_APP_ID) && asString(env.META_APP_SECRET));
    return json({ configured, redirectUri: redirectUri(env), graphVersion: graphVersion(env) }, configured ? 200 : 503);
  }

  return null;
}
