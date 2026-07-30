type JsonRecord = Record<string, unknown>;

export interface TikTokOAuthEnv {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  INTEGRATION_ENCRYPTION_KEY?: string;
  TIKTOK_APP_ID?: string;
  TIKTOK_APP_SECRET?: string;
  TIKTOK_API_BASE?: string;
  APP_ORIGIN?: string;
}

interface CredentialRow { id?: string; }

const text = (value: unknown): string => typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim();
const record = (value: unknown): JsonRecord => value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {};
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function encrypt(payload: JsonRecord, env: TikTokOAuthEnv): Promise<{ encrypted_payload: string; iv: string }> {
  const secret = text(env.INTEGRATION_ENCRYPTION_KEY) || `amanat-integrations:v1:${env.SUPABASE_SERVICE_ROLE_KEY}`;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret));
  const key = await crypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(payload)));
  return { encrypted_payload: bytesToBase64(new Uint8Array(encrypted)), iv: bytesToBase64(iv) };
}

function origin(request: Request, env: TikTokOAuthEnv): string {
  return (text(env.APP_ORIGIN) || new URL(request.url).origin).replace(/\/$/, '');
}

function apiBase(env: TikTokOAuthEnv): string {
  return (text(env.TIKTOK_API_BASE) || 'https://business-api.tiktok.com/open_api/v1.3').replace(/\/$/, '');
}

async function supabase<T>(env: TikTokOAuthEnv, path: string, init: RequestInit = {}): Promise<T> {
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
  if (!response.ok) throw new Error(`TikTok OAuth storage: ${response.status} ${body}`);
  return (body ? JSON.parse(body) : null) as T;
}

async function saveCredential(env: TikTokOAuthEnv, accessToken: string, advertiserIds: string[], scope: string): Promise<void> {
  const payload = { accessToken, advertiserIds: advertiserIds.join(','), apiBase: apiBase(env), scope };
  const encrypted = await encrypt(payload, env);
  const rows = await supabase<CredentialRow[]>(env, 'integration_credentials?user_id=is.null&provider=eq.tiktok&select=id&limit=1');
  const stored = {
    provider: 'tiktok',
    user_id: null,
    ...encrypted,
    config_summary: {
      values: { advertiserIds: advertiserIds.join(','), apiBase: apiBase(env), scope },
      secretFields: { accessToken: true },
    },
    status: 'connected',
    last_error: null,
    last_verified_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  if (rows[0]?.id) {
    await supabase(env, `integration_credentials?id=eq.${encodeURIComponent(rows[0].id as string)}`, { method: 'PATCH', headers: { prefer: 'return=minimal' }, body: JSON.stringify(stored) });
  } else {
    await supabase(env, 'integration_credentials', { method: 'POST', headers: { prefer: 'return=minimal' }, body: JSON.stringify(stored) });
  }
}

async function exchangeCode(env: TikTokOAuthEnv, authCode: string): Promise<{ accessToken: string; advertiserIds: string[]; scope: string }> {
  const response = await fetch(`${apiBase(env)}/oauth2/access_token/`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ app_id: text(env.TIKTOK_APP_ID), secret: text(env.TIKTOK_APP_SECRET), auth_code: authCode }),
  });
  const payload = record(await response.json());
  const data = record(payload.data);
  if (!response.ok || Number(payload.code || 0) !== 0) throw new Error(text(payload.message) || `TikTok OAuth exchange failed (${response.status})`);
  const accessToken = text(data.access_token);
  const advertiserIds = Array.isArray(data.advertiser_ids) ? data.advertiser_ids.map(text).filter(Boolean) : [];
  if (!accessToken) throw new Error('TikTok не вернул access token');
  if (!advertiserIds.length) throw new Error('TikTok не вернул доступные рекламные кабинеты');
  return { accessToken, advertiserIds, scope: text(data.scope) };
}

export async function handleTikTokOAuth(request: Request, env: TikTokOAuthEnv, url: URL): Promise<Response | null> {
  if (!url.pathname.startsWith('/api/integrations/tiktok/oauth/')) return null;
  if (!text(env.TIKTOK_APP_ID) || !text(env.TIKTOK_APP_SECRET)) return json({ error: 'TIKTOK_APP_ID и TIKTOK_APP_SECRET не настроены' }, 503);

  if (url.pathname === '/api/integrations/tiktok/oauth/start' && request.method === 'GET') {
    const callback = `${origin(request, env)}/api/integrations/tiktok/oauth/callback`;
    const authorize = new URL('https://ads.tiktok.com/marketing_api/auth');
    authorize.searchParams.set('app_id', text(env.TIKTOK_APP_ID));
    authorize.searchParams.set('state', crypto.randomUUID());
    authorize.searchParams.set('redirect_uri', callback);
    return Response.redirect(authorize.toString(), 302);
  }

  if (url.pathname === '/api/integrations/tiktok/oauth/callback' && request.method === 'GET') {
    const authCode = text(url.searchParams.get('auth_code'));
    if (!authCode) return Response.redirect(`${origin(request, env)}/integrations?tiktok=error`, 302);
    try {
      const token = await exchangeCode(env, authCode);
      await saveCredential(env, token.accessToken, token.advertiserIds, token.scope);
      return Response.redirect(`${origin(request, env)}/integrations?tiktok=connected`, 302);
    } catch (error) {
      console.error('TikTok OAuth callback failed', error);
      return Response.redirect(`${origin(request, env)}/integrations?tiktok=error`, 302);
    }
  }

  return null;
}
