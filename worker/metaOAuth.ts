import { resolveCompanyId } from './companyContext';

type JsonRecord = Record<string, unknown>;

export interface MetaOAuthEnv {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  INTEGRATION_ENCRYPTION_KEY?: string;
  META_APP_ID?: string;
  META_APP_SECRET?: string;
  META_GRAPH_VERSION?: string;
  META_OAUTH_REDIRECT_URI?: string;
  DEFAULT_COMPANY_ID?: string;
}

interface MetaAdAccount {
  id: string;
  account_id?: string;
  name?: string;
}

const DEFAULT_REDIRECT_URI = 'https://marketing.amanat-med-academy.workers.dev/api/integrations/meta/callback';
const STATE_COOKIE = 'amanat_meta_oauth_state';
const asRecord = (value: unknown): JsonRecord => value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {};
const asString = (value: unknown): string => typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim();
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
const redirectUri = (env: MetaOAuthEnv): string => asString(env.META_OAUTH_REDIRECT_URI) || DEFAULT_REDIRECT_URI;
const graphVersion = (env: MetaOAuthEnv): string => {
  const value = asString(env.META_GRAPH_VERSION) || 'v23.0';
  return value.startsWith('v') ? value : `v${value}`;
};
const encryptionSecret = (env: MetaOAuthEnv): string => asString(env.INTEGRATION_ENCRYPTION_KEY) || `amanat-integrations:v1:${env.SUPABASE_SERVICE_ROLE_KEY}`;

function requireMetaApp(env: MetaOAuthEnv): { appId: string; appSecret: string } {
  const appId = asString(env.META_APP_ID);
  const appSecret = asString(env.META_APP_SECRET);
  if (!appId || !appSecret) throw new Error('META_APP_ID или META_APP_SECRET не настроены в Cloudflare');
  return { appId, appSecret };
}

function cookieValue(request: Request, name: string): string {
  for (const item of (request.headers.get('cookie') || '').split(';')) {
    const [key, ...parts] = item.trim().split('=');
    if (key === name) return decodeURIComponent(parts.join('='));
  }
  return '';
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function encryptPayload(payload: JsonRecord, secret: string): Promise<{ encryptedPayload: string; iv: string }> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret));
  const key = await crypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(payload)));
  return { encryptedPayload: bytesToBase64(new Uint8Array(encrypted)), iv: bytesToBase64(iv) };
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { headers: { accept: 'application/json' } });
  const body = await response.text();
  let parsed: unknown = {};
  try { parsed = body ? JSON.parse(body) : {}; } catch { parsed = { error: { message: body } }; }
  if (!response.ok) throw new Error(asString(asRecord(asRecord(parsed).error).message) || `Meta API: ${response.status}`);
  return parsed as T;
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

async function exchangeCode(env: MetaOAuthEnv, code: string): Promise<string> {
  const { appId, appSecret } = requireMetaApp(env);
  const params = new URLSearchParams({ client_id: appId, client_secret: appSecret, redirect_uri: redirectUri(env), code });
  const shortToken = await fetchJson<{ access_token?: string; error?: { message?: string } }>(`https://graph.facebook.com/${graphVersion(env)}/oauth/access_token?${params}`);
  if (!shortToken.access_token) throw new Error(shortToken.error?.message || 'Meta не вернула access token');
  const longParams = new URLSearchParams({ grant_type: 'fb_exchange_token', client_id: appId, client_secret: appSecret, fb_exchange_token: shortToken.access_token });
  const longToken = await fetchJson<{ access_token?: string }>(`https://graph.facebook.com/${graphVersion(env)}/oauth/access_token?${longParams}`);
  return longToken.access_token || shortToken.access_token;
}

async function listAdAccounts(env: MetaOAuthEnv, accessToken: string): Promise<MetaAdAccount[]> {
  const accounts: MetaAdAccount[] = [];
  const params = new URLSearchParams({ fields: 'id,account_id,name,account_status,currency,timezone_name', limit: '200', access_token: accessToken });
  let next: string | undefined = `https://graph.facebook.com/${graphVersion(env)}/me/adaccounts?${params}`;
  while (next) {
    const page: { data?: MetaAdAccount[]; paging?: { next?: string } } = await fetchJson(next);
    accounts.push(...(page.data || []));
    next = page.paging?.next;
    if (accounts.length >= 1000) break;
  }
  return accounts;
}

async function saveMetaCredentials(env: MetaOAuthEnv, accessToken: string, accounts: MetaAdAccount[]): Promise<void> {
  const { appSecret } = requireMetaApp(env);
  const companyId = await resolveCompanyId(env);
  const accountIds = accounts.map((account) => account.id || (account.account_id ? `act_${account.account_id}` : '')).filter(Boolean);
  if (!accountIds.length) throw new Error('В Facebook-профиле не найдено доступных рекламных кабинетов');

  const encrypted = await encryptPayload({ accessToken, adAccountIds: accountIds.join(','), graphVersion: graphVersion(env), appSecret }, encryptionSecret(env));
  const row = {
    provider: 'meta',
    user_id: null,
    company_id: companyId,
    encrypted_payload: encrypted.encryptedPayload,
    iv: encrypted.iv,
    config_summary: {
      values: { adAccountIds: accountIds.join(','), graphVersion: graphVersion(env), accountNames: accounts.map((account) => account.name || account.id).join(', ') },
      secretFields: { accessToken: true, webhookVerifyToken: false, appSecret: true },
    },
    status: 'connected',
    last_error: null,
    last_verified_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const existing = await supabase(env, `integration_credentials?company_id=eq.${encodeURIComponent(companyId)}&user_id=is.null&provider=eq.meta&select=id&limit=1`) as Array<{ id?: string }>;
  if (existing[0]?.id) {
    await supabase(env, `integration_credentials?id=eq.${encodeURIComponent(existing[0].id)}`, { method: 'PATCH', headers: { prefer: 'return=minimal' }, body: JSON.stringify(row) });
  } else {
    await supabase(env, 'integration_credentials', { method: 'POST', headers: { prefer: 'return=minimal' }, body: JSON.stringify(row) });
  }
}

function redirectResult(env: MetaOAuthEnv, kind: 'connected' | 'error', value: string): Response {
  const target = new URL('/integrations', redirectUri(env));
  target.searchParams.set('meta', kind);
  target.searchParams.set(kind === 'connected' ? 'accounts' : 'message', value.slice(0, 300));
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
    const params = new URLSearchParams({ client_id: appId, redirect_uri: redirectUri(env), state, response_type: 'code', scope: 'ads_read,business_management' });
    return new Response(null, {
      status: 302,
      headers: {
        location: `https://www.facebook.com/${graphVersion(env)}/dialog/oauth?${params}`,
        'set-cookie': `${STATE_COOKIE}=${encodeURIComponent(state)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`,
        'cache-control': 'no-store',
      },
    });
  }

  if (url.pathname === '/api/integrations/meta/callback' && request.method === 'GET') {
    try {
      const metaError = url.searchParams.get('error_message') || url.searchParams.get('error_description');
      if (metaError) throw new Error(metaError);
      const code = url.searchParams.get('code') || '';
      const state = url.searchParams.get('state') || '';
      if (!code) throw new Error('Meta не вернула authorization code');
      if (!state || state !== cookieValue(request, STATE_COOKIE)) throw new Error('OAuth state не совпадает. Повторите подключение.');
      const accessToken = await exchangeCode(env, code);
      const accounts = await listAdAccounts(env, accessToken);
      await saveMetaCredentials(env, accessToken, accounts);
      return redirectResult(env, 'connected', String(accounts.length));
    } catch (error) {
      console.error('Meta OAuth callback failed', error);
      return redirectResult(env, 'error', error instanceof Error ? error.message : 'Ошибка подключения Meta');
    }
  }

  if (url.pathname === '/api/integrations/meta/oauth-config' && request.method === 'GET') {
    const configured = Boolean(asString(env.META_APP_ID) && asString(env.META_APP_SECRET));
    return json({ configured, redirectUri: redirectUri(env), graphVersion: graphVersion(env) }, configured ? 200 : 503);
  }

  return null;
}
