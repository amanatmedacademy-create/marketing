import { handleCredentialRequest, updateCredentialVerification } from './credentials';
import { handleGoogleIntegrationRequest } from './googleIntegrations';

type Row = Record<string, unknown>;

type OAuthEnv = {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  INTEGRATION_ENCRYPTION_KEY?: string;
  CURRENT_COMPANY_ID?: string;
  DEFAULT_COMPANY_ID?: string;
  GOOGLE_OAUTH_CLIENT_ID?: string;
  GOOGLE_OAUTH_CLIENT_SECRET?: string;
  GOOGLE_OAUTH_REDIRECT_URI?: string;
  GOOGLE_ADS_DEVELOPER_TOKEN?: string;
  GOOGLE_ADS_API_VERSION?: string;
  TIKTOK_APP_ID?: string;
  TIKTOK_APP_SECRET?: string;
  TIKTOK_OAUTH_REDIRECT_URI?: string;
  TIKTOK_OAUTH_AUTHORIZE_URL?: string;
};

type Provider = 'google_ads' | 'tiktok';

type CookieBinding = { state: string; companyId: string };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const GOOGLE_COOKIE = 'imds_google_ads_oauth_state';
const TIKTOK_COOKIE = 'imds_tiktok_ads_oauth_state';

const text = (value: unknown): string => typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim();
const record = (value: unknown): Row => value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {};
const json = (data: unknown, status = 200, headers: HeadersInit = {}) => new Response(JSON.stringify(data), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
});

function isAdmin(request: Request): boolean {
  return text(request.headers.get('x-amanat-auth-role')).toLowerCase() === 'administrator';
}

function companyId(env: OAuthEnv): string {
  const value = text(env.CURRENT_COMPANY_ID);
  if (!UUID_PATTERN.test(value)) throw new Error('Выберите клинику перед подключением рекламной платформы');
  return value;
}

function cookieName(provider: Provider): string {
  return provider === 'google_ads' ? GOOGLE_COOKIE : TIKTOK_COOKIE;
}

function cookieValue(request: Request, name: string): string {
  for (const part of (request.headers.get('cookie') || '').split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return '';
}

function binding(request: Request, provider: Provider): CookieBinding {
  const raw = cookieValue(request, cookieName(provider));
  const separator = raw.indexOf('.');
  if (separator <= 0) return { state: raw, companyId: '' };
  return { state: raw.slice(0, separator), companyId: raw.slice(separator + 1) };
}

function stateCookie(provider: Provider, state: string, tenantId: string): string {
  return `${cookieName(provider)}=${encodeURIComponent(`${state}.${tenantId}`)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=900`;
}

function clearCookie(provider: Provider): string {
  return `${cookieName(provider)}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

function redirectUri(request: Request, env: OAuthEnv, provider: Provider): string {
  const explicit = provider === 'google_ads' ? text(env.GOOGLE_OAUTH_REDIRECT_URI) : text(env.TIKTOK_OAUTH_REDIRECT_URI);
  if (explicit) return explicit;
  const path = provider === 'google_ads' ? '/api/integrations/google/oauth/callback' : '/api/integrations/tiktok/oauth/callback';
  return new URL(path, request.url).toString();
}

function resultRedirect(request: Request, provider: Provider, status: 'connected' | 'error', value: string, accounts = 0): Response {
  const target = new URL('/integrations', request.url);
  target.searchParams.set('oauth', provider);
  target.searchParams.set('status', status);
  if (status === 'connected') target.searchParams.set('accounts', String(accounts));
  else target.searchParams.set('message', value.slice(0, 350));
  return new Response(null, {
    status: 302,
    headers: { location: target.toString(), 'set-cookie': clearCookie(provider), 'cache-control': 'no-store' },
  });
}

async function fetchJson(url: string, init?: RequestInit): Promise<Row> {
  const response = await fetch(url, init);
  const body = await response.text();
  let payload: unknown = {};
  try { payload = body ? JSON.parse(body) : {}; } catch { payload = { error: body }; }
  if (!response.ok) throw new Error(`${response.status}: ${text(record(payload).error_description || record(payload).error || body)}`);
  return record(payload);
}

async function patchConnected(env: OAuthEnv, provider: Provider): Promise<void> {
  const tenantId = companyId(env);
  const response = await fetch(`${env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/integration_credentials?company_id=eq.${encodeURIComponent(tenantId)}&user_id=is.null&provider=eq.${encodeURIComponent(provider)}`, {
    method: 'PATCH',
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      'content-type': 'application/json',
      prefer: 'return=minimal',
    },
    body: JSON.stringify({ status: 'connected', last_verified_at: new Date().toISOString(), last_error: null }),
  });
  if (!response.ok) throw new Error(`Не удалось обновить статус OAuth: ${response.status} ${(await response.text()).slice(0, 500)}`);
}

async function saveGoogleAdsCredential(request: Request, env: OAuthEnv, values: Row): Promise<void> {
  const internalUrl = new URL('/api/integrations/google/config/google_ads', request.url);
  const headers = new Headers({ 'content-type': 'application/json', 'x-amanat-auth-role': 'administrator' });
  const internalRequest = new Request(internalUrl, { method: 'PUT', headers, body: JSON.stringify(values) });
  const response = await handleGoogleIntegrationRequest(internalRequest, env, internalUrl);
  if (!response) throw new Error('Google Ads credential handler unavailable');
  if (!response.ok) throw new Error(text(record(await response.json().catch(() => ({}))).error) || `Google config HTTP ${response.status}`);
  await patchConnected(env, 'google_ads');
}

async function saveTikTokCredential(request: Request, env: OAuthEnv, accessToken: string, advertiserIds: string[]): Promise<void> {
  const internalUrl = new URL('/api/integrations/config/tiktok', request.url);
  const headers = new Headers({ 'content-type': 'application/json', 'x-amanat-auth-role': 'administrator' });
  const internalRequest = new Request(internalUrl, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ accessToken, advertiserIds: advertiserIds.join(',') }),
  });
  const response = await handleCredentialRequest(internalRequest, env, internalUrl);
  if (!response) throw new Error('TikTok credential handler unavailable');
  if (!response.ok) throw new Error(text(record(await response.json().catch(() => ({}))).error) || `TikTok config HTTP ${response.status}`);
  await updateCredentialVerification(env, 'tiktok', true);
}

function googleStart(request: Request, env: OAuthEnv): Response {
  if (!isAdmin(request)) return json({ error: 'Google Ads OAuth доступен только администратору' }, 403);
  const clientId = text(env.GOOGLE_OAUTH_CLIENT_ID);
  const clientSecret = text(env.GOOGLE_OAUTH_CLIENT_SECRET);
  const developerToken = text(env.GOOGLE_ADS_DEVELOPER_TOKEN);
  if (!clientId || !clientSecret || !developerToken) {
    return json({ error: 'Настройте GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET и GOOGLE_ADS_DEVELOPER_TOKEN в Cloudflare' }, 503);
  }
  const tenantId = companyId(env);
  const state = crypto.randomUUID().replace(/-/g, '');
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri(request, env, 'google_ads'),
    response_type: 'code',
    scope: 'https://www.googleapis.com/auth/adwords',
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
  });
  return json({ ok: true, authorizationUrl: `https://accounts.google.com/o/oauth2/v2/auth?${params}` }, 200, {
    'set-cookie': stateCookie('google_ads', state, tenantId),
  });
}

async function googleCallback(request: Request, env: OAuthEnv, url: URL): Promise<Response> {
  try {
    const error = text(url.searchParams.get('error'));
    if (error) throw new Error(text(url.searchParams.get('error_description')) || error);
    const code = text(url.searchParams.get('code'));
    const state = text(url.searchParams.get('state'));
    const bound = binding(request, 'google_ads');
    if (!code) throw new Error('Google не вернул authorization code');
    if (!state || state !== bound.state || !UUID_PATTERN.test(bound.companyId)) throw new Error('Google OAuth state не совпадает. Повторите подключение.');

    const tenantEnv = { ...env, CURRENT_COMPANY_ID: bound.companyId };
    const clientId = text(env.GOOGLE_OAUTH_CLIENT_ID);
    const clientSecret = text(env.GOOGLE_OAUTH_CLIENT_SECRET);
    const developerToken = text(env.GOOGLE_ADS_DEVELOPER_TOKEN);
    if (!clientId || !clientSecret || !developerToken) throw new Error('Google OAuth app не настроен');

    const tokenBody = new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri(request, env, 'google_ads'),
      grant_type: 'authorization_code',
    });
    const token = await fetchJson('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: tokenBody,
    });
    const accessToken = text(token.access_token);
    const refreshToken = text(token.refresh_token);
    if (!accessToken || !refreshToken) throw new Error('Google не вернул refresh token. Повторите согласие с доступом.');

    const apiVersion = text(env.GOOGLE_ADS_API_VERSION) || 'v25';
    const customers = await fetchJson(`https://googleads.googleapis.com/${apiVersion}/customers:listAccessibleCustomers`, {
      headers: { authorization: `Bearer ${accessToken}`, 'developer-token': developerToken, accept: 'application/json' },
    });
    const names = Array.isArray(customers.resourceNames) ? customers.resourceNames.map(text) : [];
    const customerIds = names.map((name) => name.replace(/^customers\//, '').replace(/\D/g, '')).filter(Boolean);
    if (!customerIds.length) throw new Error('Google Ads OAuth успешен, но доступных рекламных аккаунтов не найдено');

    await saveGoogleAdsCredential(request, tenantEnv, {
      clientId,
      clientSecret,
      refreshToken,
      developerToken,
      customerIds: customerIds.join(','),
      apiVersion,
    });
    return resultRedirect(request, 'google_ads', 'connected', '', customerIds.length);
  } catch (error) {
    console.error('Google Ads OAuth callback failed', error);
    return resultRedirect(request, 'google_ads', 'error', error instanceof Error ? error.message : String(error));
  }
}

function tiktokStart(request: Request, env: OAuthEnv): Response {
  if (!isAdmin(request)) return json({ error: 'TikTok Ads OAuth доступен только администратору' }, 403);
  const appId = text(env.TIKTOK_APP_ID);
  const secret = text(env.TIKTOK_APP_SECRET);
  if (!appId || !secret) return json({ error: 'Настройте TIKTOK_APP_ID и TIKTOK_APP_SECRET в Cloudflare' }, 503);
  const tenantId = companyId(env);
  const state = crypto.randomUUID().replace(/-/g, '');
  const base = text(env.TIKTOK_OAUTH_AUTHORIZE_URL) || 'https://business-api.tiktok.com/portal/auth';
  const target = new URL(base);
  target.searchParams.set('app_id', appId);
  target.searchParams.set('state', state);
  target.searchParams.set('redirect_uri', redirectUri(request, env, 'tiktok'));
  return json({ ok: true, authorizationUrl: target.toString() }, 200, {
    'set-cookie': stateCookie('tiktok', state, tenantId),
  });
}

async function tiktokCallback(request: Request, env: OAuthEnv, url: URL): Promise<Response> {
  try {
    const error = text(url.searchParams.get('error') || url.searchParams.get('error_description'));
    if (error) throw new Error(error);
    const authCode = text(url.searchParams.get('auth_code') || url.searchParams.get('code'));
    const state = text(url.searchParams.get('state'));
    const bound = binding(request, 'tiktok');
    if (!authCode) throw new Error('TikTok не вернул auth_code');
    if (!state || state !== bound.state || !UUID_PATTERN.test(bound.companyId)) throw new Error('TikTok OAuth state не совпадает. Повторите подключение.');
    const appId = text(env.TIKTOK_APP_ID);
    const secret = text(env.TIKTOK_APP_SECRET);
    if (!appId || !secret) throw new Error('TikTok developer app не настроен');

    const payload = await fetchJson('https://business-api.tiktok.com/open_api/v1.3/oauth2/access_token/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ app_id: appId, secret, auth_code: authCode }),
    });
    if (Number(payload.code || 0) !== 0) throw new Error(text(payload.message) || `TikTok OAuth code ${payload.code}`);
    const data = record(payload.data);
    const accessToken = text(data.access_token);
    const advertiserIds = Array.isArray(data.advertiser_ids) ? data.advertiser_ids.map(text).filter(Boolean) : [];
    if (!accessToken || !advertiserIds.length) throw new Error('TikTok OAuth не вернул access token или рекламные аккаунты');

    const tenantEnv = { ...env, CURRENT_COMPANY_ID: bound.companyId };
    await saveTikTokCredential(request, tenantEnv, accessToken, advertiserIds);
    return resultRedirect(request, 'tiktok', 'connected', '', advertiserIds.length);
  } catch (error) {
    console.error('TikTok Ads OAuth callback failed', error);
    return resultRedirect(request, 'tiktok', 'error', error instanceof Error ? error.message : String(error));
  }
}

export async function handlePlatformOAuth(request: Request, env: OAuthEnv, url: URL): Promise<Response | null> {
  if (url.pathname === '/api/integrations/google/oauth/start' && request.method === 'POST') return googleStart(request, env);
  if (url.pathname === '/api/integrations/google/oauth/callback' && request.method === 'GET') return googleCallback(request, env, url);
  if (url.pathname === '/api/integrations/tiktok/oauth/start' && request.method === 'POST') return tiktokStart(request, env);
  if (url.pathname === '/api/integrations/tiktok/oauth/callback' && request.method === 'GET') return tiktokCallback(request, env, url);
  return null;
}
