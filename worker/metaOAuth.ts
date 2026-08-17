import { resolveCompanyId } from './companyContext';
import { localDataJson, type LocalDataEnv } from './localData';
import type { WorkerExecutionContext } from './integrations';

type JsonRecord = Record<string, unknown>;

export interface MetaOAuthEnv extends LocalDataEnv {
  INTEGRATION_ENCRYPTION_KEY?: string;
  META_APP_ID?: string;
  META_APP_SECRET?: string;
  META_GRAPH_VERSION?: string;
  META_OAUTH_REDIRECT_URI?: string;
  APP_ORIGIN?: string;
  DEFAULT_COMPANY_ID?: string;
  CURRENT_COMPANY_ID?: string;
}

interface MetaAdAccount {
  id: string;
  account_id?: string;
  name?: string;
}

const STATE_COOKIE = 'amanat_meta_oauth_state';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const asRecord = (value: unknown): JsonRecord => value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {};
const asString = (value: unknown): string => typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim();
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
const redirectUri = (env: MetaOAuthEnv): string => {
  const explicit = asString(env.META_OAUTH_REDIRECT_URI);
  if (explicit) return explicit;
  const origin = asString(env.APP_ORIGIN).replace(/\/$/, '');
  if (!origin) throw new Error('APP_ORIGIN не настроен на VPS');
  return `${origin}/api/integrations/meta/callback`;
};
const graphVersion = (env: MetaOAuthEnv): string => {
  const value = asString(env.META_GRAPH_VERSION) || 'v23.0';
  return value.startsWith('v') ? value : `v${value}`;
};
const encryptionSecret = (env: MetaOAuthEnv): string => {
  const secret = asString(env.INTEGRATION_ENCRYPTION_KEY);
  if (!secret) throw new Error('INTEGRATION_ENCRYPTION_KEY не настроен на VPS');
  return secret;
};

function requireMetaApp(env: MetaOAuthEnv): { appId: string; appSecret: string } {
  const appId = asString(env.META_APP_ID);
  const appSecret = asString(env.META_APP_SECRET);
  if (!appId || !appSecret) throw new Error('META_APP_ID или META_APP_SECRET не настроены на VPS');
  return { appId, appSecret };
}

function cookieValue(request: Request, name: string): string {
  for (const item of (request.headers.get('cookie') || '').split(';')) {
    const [key, ...parts] = item.trim().split('=');
    if (key === name) return decodeURIComponent(parts.join('='));
  }
  return '';
}

function stateBinding(request: Request): { state: string; companyId: string } {
  const raw = cookieValue(request, STATE_COOKIE);
  const separator = raw.indexOf('.');
  if (separator <= 0) return { state: raw, companyId: '' };
  return { state: raw.slice(0, separator), companyId: raw.slice(separator + 1) };
}

function boundStateCookie(env: MetaOAuthEnv, state: string): string {
  const companyId = asString(env.CURRENT_COMPANY_ID);
  if (!UUID_PATTERN.test(companyId)) throw new Error('Выберите клинику перед подключением Meta');
  return `${state}.${companyId}`;
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

async function db<T>(env: MetaOAuthEnv, path: string, init: RequestInit = {}): Promise<T> {
  return localDataJson<T>(env, path, init, 'Meta OAuth storage');
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

  const encrypted = await encryptPayload({ accessToken, adAccountIds: accountIds.join(','), selectedAdIds: '', graphVersion: graphVersion(env), appSecret }, encryptionSecret(env));
  const row = {
    provider: 'meta',
    user_id: null,
    company_id: companyId,
    encrypted_payload: encrypted.encryptedPayload,
    iv: encrypted.iv,
    config_summary: {
      values: {
        adAccountIds: accountIds.join(','),
        selectedAdIds: '',
        graphVersion: graphVersion(env),
        accountNames: accounts.map((account) => account.name || account.id).join(', '),
      },
      secretFields: { accessToken: true, webhookVerifyToken: false, appSecret: true },
    },
    status: 'connected',
    last_error: null,
    last_verified_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const existing = await db<Array<{ id?: string }>>(env, `integration_credentials?company_id=eq.${encodeURIComponent(companyId)}&user_id=is.null&provider=eq.meta&select=id&limit=1`);
  if (existing[0]?.id) {
    await db(env, `integration_credentials?id=eq.${encodeURIComponent(existing[0].id)}`, { method: 'PATCH', headers: { prefer: 'return=minimal' }, body: JSON.stringify(row) });
  } else {
    await db(env, 'integration_credentials', { method: 'POST', headers: { prefer: 'return=minimal' }, body: JSON.stringify(row) });
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

export async function handleMetaOAuthRequest(
  request: Request,
  env: MetaOAuthEnv,
  url: URL,
  ctx?: WorkerExecutionContext,
): Promise<Response | null> {
  void ctx;

  if (url.pathname === '/api/integrations/meta/connect' && request.method === 'GET') {
    const { appId } = requireMetaApp(env);
    const state = crypto.randomUUID().replace(/-/g, '');
    const params = new URLSearchParams({ client_id: appId, redirect_uri: redirectUri(env), state, response_type: 'code', scope: 'ads_read,business_management' });
    return new Response(null, {
      status: 302,
      headers: {
        location: `https://www.facebook.com/${graphVersion(env)}/dialog/oauth?${params}`,
        'set-cookie': `${STATE_COOKIE}=${encodeURIComponent(boundStateCookie(env, state))}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`,
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
      const binding = stateBinding(request);
      if (!code) throw new Error('Meta не вернула authorization code');
      if (!state || state !== binding.state) throw new Error('OAuth state не совпадает. Повторите подключение.');
      if (!UUID_PATTERN.test(binding.companyId)) throw new Error('OAuth не содержит выбранную клинику. Повторите подключение.');
      const tenantEnv = { ...env, CURRENT_COMPANY_ID: binding.companyId };
      const accessToken = await exchangeCode(tenantEnv, code);
      const accounts = await listAdAccounts(tenantEnv, accessToken);
      await saveMetaCredentials(tenantEnv, accessToken, accounts);
      return redirectResult(tenantEnv, 'connected', String(accounts.length));
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
