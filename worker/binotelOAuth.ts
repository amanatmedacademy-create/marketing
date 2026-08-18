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

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const text = (value: unknown): string => typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim();
const rec = (value: unknown): Row => value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {};
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });

function redirectUri(env: BinotelOAuthEnv): string {
  const explicit = text(env.BINOTEL_OAUTH_REDIRECT_URI);
  if (explicit) return explicit;
  const origin = text(env.APP_ORIGIN).replace(/\/$/, '');
  if (!origin) throw new Error('APP_ORIGIN не настроен на VPS');
  return `${origin}/integrations`;
}

function encryptionSecret(env: BinotelOAuthEnv): string {
  const secret = text(env.INTEGRATION_ENCRYPTION_KEY);
  if (!secret) throw new Error('INTEGRATION_ENCRYPTION_KEY не настроен на VPS');
  return secret;
}

function requiredConfig(env: BinotelOAuthEnv) {
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
  const missing = [
    ['BINOTEL_OAUTH_CLIENT_ID', env.BINOTEL_OAUTH_CLIENT_ID],
    ['BINOTEL_OAUTH_CLIENT_SECRET', env.BINOTEL_OAUTH_CLIENT_SECRET],
    ['BINOTEL_OAUTH_AUTHORIZE_URL', env.BINOTEL_OAUTH_AUTHORIZE_URL],
    ['BINOTEL_OAUTH_TOKEN_URL', env.BINOTEL_OAUTH_TOKEN_URL],
  ].filter(([, value]) => !text(value)).map(([name]) => name);
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

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
function base64Url(bytes: Uint8Array): string { return bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, ''); }
function base64Basic(value: string): string { return btoa(unescape(encodeURIComponent(value))); }

async function stateSignature(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return base64Url(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload))));
}
async function createState(env: BinotelOAuthEnv, companyId: string, branchId: string): Promise<string> {
  const payload = `binotel:${companyId}:${branchId}:${Date.now()}:${crypto.randomUUID().replace(/-/g, '')}`;
  return `${payload}.${await stateSignature(encryptionSecret(env), payload)}`;
}
async function validateState(env: BinotelOAuthEnv, state: string, companyId: string, branchId: string): Promise<void> {
  const separator = state.lastIndexOf('.');
  if (separator <= 0) throw new Error('Некорректный OAuth state');
  const payload = state.slice(0, separator);
  const signature = state.slice(separator + 1);
  const parts = payload.split(':');
  if (parts.length !== 5 || parts[0] !== 'binotel') throw new Error('Некорректный OAuth state');
  if (parts[1] !== companyId || parts[2] !== branchId) throw new Error('OAuth относится к другой клинике или филиалу');
  const issuedAt = Number(parts[3]);
  if (!Number.isFinite(issuedAt) || Date.now() - issuedAt > 10 * 60 * 1000 || issuedAt > Date.now() + 60_000) throw new Error('OAuth state устарел. Повторите подключение.');
  const expected = await stateSignature(encryptionSecret(env), payload);
  if (signature !== expected) throw new Error('OAuth state не прошёл проверку');
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
function base64ToBytes(value: string): Uint8Array { const raw = atob(value); return Uint8Array.from(raw, (character) => character.charCodeAt(0)); }
async function decryptPayload(row: Row, secret: string): Promise<Row> {
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: base64ToBytes(text(row.iv)) }, await cryptoKey(secret), base64ToBytes(text(row.encrypted_payload)));
  return rec(JSON.parse(new TextDecoder().decode(decrypted)));
}

async function db<T>(env: BinotelOAuthEnv, path: string, init: RequestInit = {}): Promise<T> {
  return localDataJson<T>(env, path, init, 'Binotel OAuth storage');
}

async function parseTokenResponse(response: Response): Promise<TokenResponse> {
  const raw = await response.text();
  let payload: TokenResponse = {};
  try { payload = raw ? JSON.parse(raw) as TokenResponse : {}; }
  catch { payload = Object.fromEntries(new URLSearchParams(raw).entries()) as TokenResponse; }
  if (!response.ok) throw new Error(payload.error_description || payload.error || raw || `Binotel OAuth token HTTP ${response.status}`);
  if (!text(payload.access_token)) throw new Error('Binotel OAuth token endpoint не вернул access_token');
  return payload;
}

async function exchangeCode(env: BinotelOAuthEnv, code: string): Promise<TokenResponse> {
  const { clientId, clientSecret, tokenUrl } = requiredConfig(env);
  const params = new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri(env) });
  const headers = new Headers({ accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' });
  const method = text(env.BINOTEL_OAUTH_TOKEN_AUTH_METHOD).toLowerCase() || 'client_secret_post';
  if (method === 'client_secret_basic') headers.set('authorization', `Basic ${base64Basic(`${clientId}:${clientSecret}`)}`);
  else { params.set('client_id', clientId); params.set('client_secret', clientSecret); }
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
      method: 'PATCH', headers: { prefer: 'return=minimal' },
      body: JSON.stringify({ config_summary: { ...rec(row.config_summary), active: false }, updated_at: new Date().toISOString() }),
    });
  }
}

async function saveOAuthCredential(env: BinotelOAuthEnv, companyId: string, branchId: string, token: TokenResponse): Promise<void> {
  const existing = (await db<Row[]>(env, `integration_credentials?company_id=eq.${encodeURIComponent(companyId)}&branch_id=eq.${encodeURIComponent(branchId)}&user_id=is.null&provider=eq.binotel&select=*&limit=1`))[0] || null;
  const secret = encryptionSecret(env);
  let previousPayload: Row = {};
  if (existing) { try { previousPayload = await decryptPayload(existing, secret); } catch { previousPayload = {}; } }
  const now = new Date();
  const expiresIn = Number(token.expires_in || 0);
  const payload: Row = {
    ...previousPayload,
    authMode: 'oauth',
    oauthAccessToken: text(token.access_token),
    oauthRefreshToken: text(token.refresh_token) || text(previousPayload.oauthRefreshToken),
    oauthTokenType: text(token.token_type) || 'Bearer',
    oauthScope: text(token.scope) || text(env.BINOTEL_OAUTH_SCOPES),
    oauthExpiresAt: Number.isFinite(expiresIn) && expiresIn > 0 ? new Date(now.getTime() + expiresIn * 1000).toISOString() : '',
    oauthConnectedAt: now.toISOString(),
    webhookSecret: text(previousPayload.webhookSecret) || randomSecret(),
  };
  const sealed = await encryptPayload(payload, secret);
  const previousSummary = rec(existing?.config_summary);
  const row = {
    provider: 'binotel', company_id: companyId, branch_id: branchId, user_id: null, ...sealed,
    config_summary: {
      ...previousSummary,
      values: { ...rec(previousSummary.values), authMode: 'oauth', oauthScope: text(payload.oauthScope), oauthExpiresAt: text(payload.oauthExpiresAt) },
      secretFields: { ...rec(previousSummary.secretFields), oauthAccessToken: true, oauthRefreshToken: Boolean(text(payload.oauthRefreshToken)), webhookSecret: true },
      active: true,
    },
    status: 'connected', last_error: null, last_verified_at: now.toISOString(), updated_at: now.toISOString(),
  };
  if (existing?.id) await db(env, `integration_credentials?id=eq.${encodeURIComponent(text(existing.id))}`, { method: 'PATCH', headers: { prefer: 'return=minimal' }, body: JSON.stringify(row) });
  else await db(env, 'integration_credentials', { method: 'POST', headers: { prefer: 'return=minimal' }, body: JSON.stringify(row) });
  await deactivateSipuni(env, companyId, branchId);
}

export async function handleBinotelOAuthRequest(request: Request, env: BinotelOAuthEnv, url: URL): Promise<Response | null> {
  if (url.pathname === '/api/telephony/providers/binotel/oauth-config' && request.method === 'GET') return json(configStatus(env));

  if (url.pathname === '/api/telephony/providers/binotel/oauth/start' && request.method === 'POST') {
    try {
      const { clientId, authorizeUrl } = requiredConfig(env);
      const companyId = requireCompanyId(env);
      const branchId = requireBranchId(env);
      if (!UUID_PATTERN.test(companyId) || !UUID_PATTERN.test(branchId)) return json({ error: 'Выберите конкретный филиал перед подключением Binotel' }, 409);
      const state = await createState(env, companyId, branchId);
      const params = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri(env), response_type: 'code', state });
      const scopes = text(env.BINOTEL_OAUTH_SCOPES).replace(/,/g, ' ').replace(/\s+/g, ' ').trim();
      if (scopes) params.set('scope', scopes);
      for (const [key, value] of Object.entries(parseExtraParams(env.BINOTEL_OAUTH_AUTHORIZE_PARAMS))) {
        if (!['client_id', 'redirect_uri', 'response_type', 'state', 'scope'].includes(key)) params.set(key, value);
      }
      const target = new URL(authorizeUrl);
      params.forEach((value, key) => target.searchParams.set(key, value));
      return json({ ok: true, authorizationUrl: target.toString(), redirectUri: redirectUri(env) });
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : String(error) }, 503);
    }
  }

  if (url.pathname === '/api/telephony/providers/binotel/oauth/complete' && request.method === 'POST') {
    try {
      requiredConfig(env);
      const companyId = requireCompanyId(env);
      const branchId = requireBranchId(env);
      const body = rec(await request.json().catch(() => ({})));
      const code = text(body.code);
      const state = text(body.state);
      if (!code || !state) return json({ error: 'Binotel OAuth не вернул code/state' }, 400);
      await validateState(env, state, companyId, branchId);
      const token = await exchangeCode(env, code);
      await saveOAuthCredential(env, companyId, branchId, token);
      return json({ ok: true, provider: 'binotel', connected: true });
    } catch (error) {
      console.error('Binotel OAuth completion failed', error);
      return json({ error: error instanceof Error ? error.message : 'Ошибка подключения Binotel' }, 400);
    }
  }

  return null;
}
