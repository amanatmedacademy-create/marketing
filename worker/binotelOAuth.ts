import { localDataJson, type LocalDataEnv } from './localData';
import { requireBranchId, requireCompanyId } from './tenantScope';

type Row = Record<string, unknown>;

type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  token_type?: string;
  scope?: string;
  expires_in?: number | string;
  error?: string;
  error_description?: string;
};

export interface BinotelOAuthEnv extends LocalDataEnv {
  APP_ORIGIN?: string;
  CURRENT_COMPANY_ID?: string;
  CURRENT_BRANCH_ID?: string;
  INTEGRATION_ENCRYPTION_KEY?: string;
  BINOTEL_OAUTH_CLIENT_ID?: string;
  BINOTEL_OAUTH_CLIENT_SECRET?: string;
  BINOTEL_OAUTH_AUTHORIZE_URL?: string;
  BINOTEL_OAUTH_TOKEN_URL?: string;
  BINOTEL_OAUTH_SCOPES?: string;
  BINOTEL_OAUTH_REDIRECT_URI?: string;
  BINOTEL_OAUTH_TOKEN_AUTH_METHOD?: string;
  BINOTEL_OAUTH_AUTHORIZE_PARAMS?: string;
  BINOTEL_OAUTH_TOKEN_PARAMS?: string;
}

const STATE_COOKIE = 'imds_binotel_oauth_state';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const text = (value: unknown): string => typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim();
const rec = (value: unknown): Row => value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {};
const json = (data: unknown, status = 200, headers: HeadersInit = {}) => new Response(JSON.stringify(data), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
});

function redirectUri(env: BinotelOAuthEnv): string {
  const explicit = text(env.BINOTEL_OAUTH_REDIRECT_URI);
  if (explicit) return explicit;
  const origin = text(env.APP_ORIGIN).replace(/\/$/, '');
  if (!origin) throw new Error('APP_ORIGIN не настроен на VPS');
  return `${origin}/api/telephony/providers/binotel/oauth/callback`;
}

function encryptionSecret(env: BinotelOAuthEnv): string {
  const secret = text(env.INTEGRATION_ENCRYPTION_KEY);
  if (!secret) throw new Error('INTEGRATION_ENCRYPTION_KEY не настроен на VPS');
  return secret;
}

function requiredConfig(env: BinotelOAuthEnv): { clientId: string; clientSecret: string; authorizeUrl: string; tokenUrl: string } {
  const clientId = text(env.BINOTEL_OAUTH_CLIENT_ID);
  const clientSecret = text(env.BINOTEL_OAUTH_CLIENT_SECRET);
  const authorizeUrl = text(env.BINOTEL_OAUTH_AUTHORIZE_URL);
  const tokenUrl = text(env.BINOTEL_OAUTH_TOKEN_URL);
  const missing = [
    !clientId && 'BINOTEL_OAUTH_CLIENT_ID',
    !clientSecret && 'BINOTEL_OAUTH_CLIENT_SECRET',
    !authorizeUrl && 'BINOTEL_OAUTH_AUTHORIZE_URL',
    !tokenUrl && 'BINOTEL_OAUTH_TOKEN_URL',
  ].filter(Boolean) as string[];
  if (missing.length) throw new Error(`Binotel OAuth не настроен: ${missing.join(', ')}`);
  return { clientId, clientSecret, authorizeUrl, tokenUrl };
}

function configStatus(env: BinotelOAuthEnv) {
  const fields: Array<[string, unknown]> = [
    ['BINOTEL_OAUTH_CLIENT_ID', env.BINOTEL_OAUTH_CLIENT_ID],
    ['BINOTEL_OAUTH_CLIENT_SECRET', env.BINOTEL_OAUTH_CLIENT_SECRET],
    ['BINOTEL_OAUTH_AUTHORIZE_URL', env.BINOTEL_OAUTH_AUTHORIZE_URL],
    ['BINOTEL_OAUTH_TOKEN_URL', env.BINOTEL_OAUTH_TOKEN_URL],
  ];
  const missing = fields.filter(([, value]) => !text(value)).map(([name]) => name);
  let callback = '';
  try { callback = redirectUri(env); } catch { callback = ''; }
  return {
    configured: missing.length === 0 && Boolean(callback),
    missing,
    redirectUri: callback,
    scopes: text(env.BINOTEL_OAUTH_SCOPES),
    tokenAuthMethod: text(env.BINOTEL_OAUTH_TOKEN_AUTH_METHOD) || 'client_secret_post',
  };
}

function parseExtraParams(raw: unknown): Record<string, string> {
  const value = text(raw);
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).flatMap(([key, item]) => {
      const normalized = text(item);
      return key && normalized ? [[key, normalized]] : [];
    }));
  } catch {
    return {};
  }
}

function stateCookie(requestOrEnv: Request | BinotelOAuthEnv, value: string, maxAge: number): string {
  const secure = requestOrEnv instanceof Request
    ? new URL(requestOrEnv.url).protocol === 'https:'
    : (() => { try { return new URL(redirectUri(requestOrEnv)).protocol === 'https:'; } catch { return false; } })();
  return `${STATE_COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}

function cookieValue(request: Request, name: string): string {
  for (const item of (request.headers.get('cookie') || '').split(';')) {
    const [key, ...parts] = item.trim().split('=');
    if (key === name) return decodeURIComponent(parts.join('='));
  }
  return '';
}

function stateBinding(request: Request): { state: string; companyId: string; branchId: string } {
  const raw = cookieValue(request, STATE_COOKIE);
  const parts = raw.split('.');
  return { state: parts[0] || '', companyId: parts[1] || '', branchId: parts[2] || '' };
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64Basic(value: string): string {
  return btoa(unescape(encodeURIComponent(value)));
}

async function cryptoKey(secret: string): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret));
  return crypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

async function encryptPayload(payload: Row, secret: string): Promise<{ encrypted_payload: string; iv: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await cryptoKey(secret), new TextEncoder().encode(JSON.stringify(payload)));
  return { encrypted_payload: bytesToBase64(new Uint8Array(encrypted)), iv: bytesToBase64(iv) };
}

function base64ToBytes(value: string): Uint8Array {
  const raw = atob(value);
  return Uint8Array.from(raw, (character) => character.charCodeAt(0));
}

async function decryptPayload(row: Row, secret: string): Promise<Row> {
  const iv = base64ToBytes(text(row.iv));
  const encrypted = base64ToBytes(text(row.encrypted_payload));
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, await cryptoKey(secret), encrypted);
  return rec(JSON.parse(new TextDecoder().decode(decrypted)));
}

async function db<T>(env: BinotelOAuthEnv, path: string, init: RequestInit = {}): Promise<T> {
  return localDataJson<T>(env, path, init, 'Binotel OAuth storage');
}

async function parseTokenResponse(response: Response): Promise<TokenResponse> {
  const raw = await response.text();
  let payload: TokenResponse = {};
  try {
    payload = raw ? JSON.parse(raw) as TokenResponse : {};
  } catch {
    const params = new URLSearchParams(raw);
    payload = Object.fromEntries(params.entries()) as TokenResponse;
  }
  if (!response.ok) throw new Error(payload.error_description || payload.error || raw || `Binotel OAuth token HTTP ${response.status}`);
  if (!text(payload.access_token)) throw new Error('Binotel OAuth token endpoint не вернул access_token');
  return payload;
}

async function exchangeCode(env: BinotelOAuthEnv, code: string): Promise<TokenResponse> {
  const { clientId, clientSecret, tokenUrl } = requiredConfig(env);
  const params = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri(env),
  });
  const headers = new Headers({ accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' });
  const method = text(env.BINOTEL_OAUTH_TOKEN_AUTH_METHOD).toLowerCase() || 'client_secret_post';
  if (method === 'client_secret_basic') {
    headers.set('authorization', `Basic ${base64Basic(`${clientId}:${clientSecret}`)}`);
  } else {
    params.set('client_id', clientId);
    params.set('client_secret', clientSecret);
  }
  for (const [key, value] of Object.entries(parseExtraParams(env.BINOTEL_OAUTH_TOKEN_PARAMS))) {
    if (!['grant_type', 'code', 'redirect_uri', 'client_id', 'client_secret'].includes(key)) params.set(key, value);
  }
  return parseTokenResponse(await fetch(tokenUrl, { method: 'POST', headers, body: params.toString(), redirect: 'error' }));
}

function randomSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function deactivateSipuni(env: BinotelOAuthEnv, companyId: string, branchId: string): Promise<void> {
  const rows = await db<Row[]>(env, `integration_credentials?company_id=eq.${encodeURIComponent(companyId)}&branch_id=eq.${encodeURIComponent(branchId)}&user_id=is.null&provider=eq.sipuni&select=id,config_summary`);
  for (const row of rows) {
    if (!row.id || rec(row.config_summary).active !== true) continue;
    await db(env, `integration_credentials?id=eq.${encodeURIComponent(text(row.id))}`, {
      method: 'PATCH',
      headers: { prefer: 'return=minimal' },
      body: JSON.stringify({ config_summary: { ...rec(row.config_summary), active: false }, updated_at: new Date().toISOString() }),
    });
  }
}

async function saveOAuthCredential(env: BinotelOAuthEnv, companyId: string, branchId: string, token: TokenResponse): Promise<void> {
  const existing = (await db<Row[]>(env, `integration_credentials?company_id=eq.${encodeURIComponent(companyId)}&branch_id=eq.${encodeURIComponent(branchId)}&user_id=is.null&provider=eq.binotel&select=*&limit=1`))[0] || null;
  const secret = encryptionSecret(env);
  let previousPayload: Row = {};
  if (existing) {
    try { previousPayload = await decryptPayload(existing, secret); } catch { previousPayload = {}; }
  }
  const now = new Date();
  const expiresIn = Number(token.expires_in || 0);
  const expiresAt = Number.isFinite(expiresIn) && expiresIn > 0 ? new Date(now.getTime() + expiresIn * 1000).toISOString() : '';
  const payload: Row = {
    ...previousPayload,
    authMode: 'oauth',
    oauthAccessToken: text(token.access_token),
    oauthRefreshToken: text(token.refresh_token) || text(previousPayload.oauthRefreshToken),
    oauthTokenType: text(token.token_type) || 'Bearer',
    oauthScope: text(token.scope) || text(env.BINOTEL_OAUTH_SCOPES),
    oauthExpiresAt: expiresAt,
    oauthConnectedAt: now.toISOString(),
    webhookSecret: text(previousPayload.webhookSecret) || randomSecret(),
  };
  const sealed = await encryptPayload(payload, secret);
  const previousSummary = rec(existing?.config_summary);
  const previousValues = rec(previousSummary.values);
  const previousSecrets = rec(previousSummary.secretFields);
  const row = {
    provider: 'binotel',
    company_id: companyId,
    branch_id: branchId,
    user_id: null,
    ...sealed,
    config_summary: {
      ...previousSummary,
      values: {
        ...previousValues,
        authMode: 'oauth',
        oauthScope: text(payload.oauthScope),
        oauthExpiresAt: text(payload.oauthExpiresAt),
      },
      secretFields: {
        ...previousSecrets,
        oauthAccessToken: true,
        oauthRefreshToken: Boolean(text(payload.oauthRefreshToken)),
        webhookSecret: true,
      },
      active: true,
    },
    status: 'connected',
    last_error: null,
    last_verified_at: now.toISOString(),
    updated_at: now.toISOString(),
  };
  if (existing?.id) {
    await db(env, `integration_credentials?id=eq.${encodeURIComponent(text(existing.id))}`, {
      method: 'PATCH',
      headers: { prefer: 'return=minimal' },
      body: JSON.stringify(row),
    });
  } else {
    await db(env, 'integration_credentials', {
      method: 'POST',
      headers: { prefer: 'return=minimal' },
      body: JSON.stringify(row),
    });
  }
  await deactivateSipuni(env, companyId, branchId);
}

function redirectResult(env: BinotelOAuthEnv, request: Request, kind: 'connected' | 'error', value: string): Response {
  let origin = text(env.APP_ORIGIN).replace(/\/$/, '');
  if (!origin) origin = new URL(request.url).origin;
  const target = new URL('/integrations', `${origin}/`);
  target.searchParams.set('binotel', kind);
  target.searchParams.set(kind === 'connected' ? 'status' : 'message', value.slice(0, 300));
  return new Response(null, {
    status: 302,
    headers: {
      location: target.toString(),
      'set-cookie': stateCookie(request, '', 0),
      'cache-control': 'no-store',
    },
  });
}

export async function handleBinotelOAuthRequest(request: Request, env: BinotelOAuthEnv, url: URL): Promise<Response | null> {
  if (url.pathname === '/api/telephony/providers/binotel/oauth-config' && request.method === 'GET') {
    return json(configStatus(env));
  }

  if (url.pathname === '/api/telephony/providers/binotel/oauth/start' && request.method === 'POST') {
    try {
      const { clientId, authorizeUrl } = requiredConfig(env);
      const companyId = requireCompanyId(env);
      const branchId = requireBranchId(env);
      if (!UUID_PATTERN.test(companyId) || !UUID_PATTERN.test(branchId)) return json({ error: 'Выберите конкретный филиал перед подключением Binotel' }, 409);
      const state = crypto.randomUUID().replace(/-/g, '');
      const params = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri(env), response_type: 'code', state });
      const scopes = text(env.BINOTEL_OAUTH_SCOPES).replace(/,/g, ' ').replace(/\s+/g, ' ').trim();
      if (scopes) params.set('scope', scopes);
      for (const [key, value] of Object.entries(parseExtraParams(env.BINOTEL_OAUTH_AUTHORIZE_PARAMS))) {
        if (!['client_id', 'redirect_uri', 'response_type', 'state', 'scope'].includes(key)) params.set(key, value);
      }
      const target = new URL(authorizeUrl);
      params.forEach((value, key) => target.searchParams.set(key, value));
      return json({ ok: true, authorizationUrl: target.toString(), redirectUri: redirectUri(env) }, 200, {
        'set-cookie': stateCookie(env, `${state}.${companyId}.${branchId}`, 600),
      });
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : String(error) }, 503);
    }
  }

  if (url.pathname === '/api/telephony/providers/binotel/oauth/callback' && request.method === 'GET') {
    try {
      const providerError = url.searchParams.get('error_description') || url.searchParams.get('error_message') || url.searchParams.get('error');
      if (providerError) throw new Error(providerError);
      const code = url.searchParams.get('code') || '';
      const state = url.searchParams.get('state') || '';
      const binding = stateBinding(request);
      if (!code) throw new Error('Binotel не вернул authorization code');
      if (!state || state !== binding.state) throw new Error('OAuth state не совпадает. Повторите подключение Binotel.');
      if (!UUID_PATTERN.test(binding.companyId) || !UUID_PATTERN.test(binding.branchId)) throw new Error('OAuth не содержит выбранный филиал. Повторите подключение.');
      const token = await exchangeCode(env, code);
      await saveOAuthCredential(env, binding.companyId, binding.branchId, token);
      return redirectResult(env, request, 'connected', 'oauth');
    } catch (error) {
      console.error('Binotel OAuth callback failed', error);
      return redirectResult(env, request, 'error', error instanceof Error ? error.message : 'Ошибка подключения Binotel');
    }
  }

  return null;
}
