import type { AuthSession } from './auth';
import type { MetaEnv } from './meta-auth';

export interface TikTokEnv extends MetaEnv {
  TIKTOK_APP_ID?: string;
  TIKTOK_APP_SECRET?: string;
  TIKTOK_REDIRECT_URI?: string;
  OAUTH_TOKEN_ENCRYPTION_KEY?: string;
}

type TikTokTokenResponse = {
  code?: number;
  message?: string;
  data?: {
    access_token?: string;
    advertiser_ids?: string[];
    scope?: string[];
  };
};

type Advertiser = {
  advertiser_id: string;
  advertiser_name?: string;
  currency?: string;
  timezone?: string;
  status?: string;
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});

function assertEnv(env: TikTokEnv) {
  if (!env.TIKTOK_APP_ID || !env.TIKTOK_APP_SECRET || !env.TIKTOK_REDIRECT_URI) {
    throw new Error('TikTok OAuth environment is not configured');
  }
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('Supabase service environment is not configured');
  if (!env.OAUTH_TOKEN_ENCRYPTION_KEY) throw new Error('OAuth token encryption key is not configured');
}

async function rest<T>(env: TikTokEnv, path: string, init: RequestInit = {}): Promise<T> {
  assertEnv(env);
  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY!,
      authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      'content-type': 'application/json',
      prefer: 'return=representation,resolution=merge-duplicates',
      ...init.headers,
    },
  });
  if (!response.ok) throw new Error(`Supabase request failed: ${response.status} ${await response.text()}`);
  const text = await response.text();
  return (text ? JSON.parse(text) : null) as T;
}

const bytesToBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const base64ToBytes = (value: string) => Uint8Array.from(atob(value), (char) => char.charCodeAt(0));

async function encryptionKey(secret: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret));
  return crypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

async function encryptToken(secret: string, token: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await encryptionKey(secret);
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(token));
  return JSON.stringify({ v: 1, iv: bytesToBase64(iv), ciphertext: bytesToBase64(new Uint8Array(encrypted)) });
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function randomState() {
  return bytesToBase64(crypto.getRandomValues(new Uint8Array(32))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function exchangeCode(env: TikTokEnv, authCode: string) {
  assertEnv(env);
  const response = await fetch('https://business-api.tiktok.com/open_api/v1.3/oauth2/access_token/', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ app_id: env.TIKTOK_APP_ID, secret: env.TIKTOK_APP_SECRET, auth_code: authCode }),
  });
  const payload = await response.json() as TikTokTokenResponse;
  if (!response.ok || payload.code !== 0 || !payload.data?.access_token) {
    throw new Error(payload.message || 'TikTok authorization code exchange failed');
  }
  return payload.data;
}

async function loadAdvertisers(env: TikTokEnv, accessToken: string, authorizedIds: string[] = []) {
  assertEnv(env);
  let advertiserIds = authorizedIds;
  if (!advertiserIds.length) {
    const query = new URLSearchParams({ app_id: env.TIKTOK_APP_ID!, secret: env.TIKTOK_APP_SECRET! });
    const response = await fetch(`https://business-api.tiktok.com/open_api/v1.3/oauth2/advertiser/get/?${query.toString()}`, {
      headers: { 'Access-Token': accessToken },
    });
    const payload = await response.json() as { code?: number; message?: string; data?: { list?: Array<{ advertiser_id?: string }> } };
    if (!response.ok || payload.code !== 0) throw new Error(payload.message || 'TikTok advertiser list request failed');
    advertiserIds = (payload.data?.list ?? []).map((item) => item.advertiser_id).filter((id): id is string => Boolean(id));
  }
  if (!advertiserIds.length) return [];

  const response = await fetch('https://business-api.tiktok.com/open_api/v1.3/advertiser/info/', {
    method: 'GET',
    headers: { 'Access-Token': accessToken },
  });
  if (!response.ok) return advertiserIds.map((advertiser_id) => ({ advertiser_id }));
  const payload = await response.json() as { code?: number; data?: { list?: Advertiser[] } };
  return payload.code === 0 && payload.data?.list?.length
    ? payload.data.list
    : advertiserIds.map((advertiser_id) => ({ advertiser_id }));
}

async function start(request: Request, env: TikTokEnv, session: AuthSession) {
  assertEnv(env);
  const state = randomState();
  const stateHash = await sha256(state);
  const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
  await rest(env, 'marketing_oauth_states', {
    method: 'POST',
    body: JSON.stringify({
      state_hash: stateHash,
      company_id: session.companyId,
      user_id: session.user.id,
      provider: 'tiktok_ads',
      redirect_uri: env.TIKTOK_REDIRECT_URI,
      expires_at: expiresAt,
    }),
  });
  const params = new URLSearchParams({
    app_id: env.TIKTOK_APP_ID!,
    state,
    redirect_uri: env.TIKTOK_REDIRECT_URI!,
  });
  return json({ authorizationUrl: `https://ads.tiktok.com/marketing_api/auth?${params.toString()}`, expiresAt });
}

async function callback(request: Request, env: TikTokEnv) {
  assertEnv(env);
  const url = new URL(request.url);
  const authCode = url.searchParams.get('auth_code');
  const state = url.searchParams.get('state');
  if (!authCode || !state) return new Response('TikTok callback is missing auth_code or state', { status: 400 });

  const stateHash = await sha256(state);
  const states = await rest<Array<{ id: string; company_id: string; user_id: string; expires_at: string }>>(
    env,
    `marketing_oauth_states?select=id,company_id,user_id,expires_at&state_hash=eq.${encodeURIComponent(stateHash)}&provider=eq.tiktok_ads&limit=1`,
  );
  const record = states[0];
  if (!record || new Date(record.expires_at).getTime() <= Date.now()) return new Response('TikTok OAuth state is invalid or expired', { status: 400 });

  const token = await exchangeCode(env, authCode);
  const advertisers = await loadAdvertisers(env, token.access_token!, token.advertiser_ids ?? []);
  const encryptedToken = await encryptToken(env.OAUTH_TOKEN_ENCRYPTION_KEY!, token.access_token!);

  await rest(env, 'marketing_oauth_connections?on_conflict=company_id,provider', {
    method: 'POST',
    body: JSON.stringify({
      company_id: record.company_id,
      provider: 'tiktok_ads',
      status: 'connected',
      token_payload: encryptedToken,
      token_type: 'Bearer',
      scopes: token.scope ?? [],
      accounts: advertisers,
      connected_by: record.user_id,
      connected_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      last_error: null,
    }),
  });
  await rest(env, `marketing_oauth_states?id=eq.${encodeURIComponent(record.id)}`, { method: 'DELETE' });

  const origin = new URL(env.TIKTOK_REDIRECT_URI!).origin;
  return Response.redirect(`${origin}/?integration=tiktok_ads&status=connected`, 302);
}

async function list(env: TikTokEnv, session: AuthSession) {
  const rows = await rest<Array<{ provider: string; status: string; scopes: string[]; accounts: Advertiser[]; connected_at: string; updated_at: string; last_error: string | null }>>(
    env,
    `marketing_oauth_connections?select=provider,status,scopes,accounts,connected_at,updated_at,last_error&company_id=eq.${encodeURIComponent(session.companyId)}&provider=eq.tiktok_ads&limit=1`,
  );
  return json({ connection: rows[0] ?? null, configured: Boolean(env.TIKTOK_APP_ID && env.TIKTOK_APP_SECRET && env.TIKTOK_REDIRECT_URI && env.OAUTH_TOKEN_ENCRYPTION_KEY) });
}

async function disconnect(env: TikTokEnv, session: AuthSession) {
  await rest(env, `marketing_oauth_connections?company_id=eq.${encodeURIComponent(session.companyId)}&provider=eq.tiktok_ads`, { method: 'DELETE' });
  return json({ success: true });
}

export async function handleTikTokPublicRequest(request: Request, env: TikTokEnv) {
  const path = new URL(request.url).pathname;
  if (request.method === 'GET' && path === '/api/integrations/tiktok/callback') {
    try { return await callback(request, env); }
    catch (error) { return new Response(error instanceof Error ? error.message : 'TikTok OAuth callback failed', { status: 500 }); }
  }
  return null;
}

export async function handleTikTokRequest(request: Request, env: TikTokEnv, session: AuthSession) {
  const path = new URL(request.url).pathname;
  try {
    if (request.method === 'GET' && path === '/api/integrations/tiktok') return list(env, session);
    if (request.method === 'POST' && path === '/api/integrations/tiktok/start') return start(request, env, session);
    if (request.method === 'DELETE' && path === '/api/integrations/tiktok') return disconnect(env, session);
    return null;
  } catch (error) {
    return json({ error: { code: 'TIKTOK_INTEGRATION_ERROR', message: error instanceof Error ? error.message : 'TikTok integration failed' } }, 500);
  }
}
