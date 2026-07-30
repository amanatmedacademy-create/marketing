type JsonRecord = Record<string, unknown>;

export interface TikTokLoginKitEnv {
  TIKTOK_CLIENT_KEY?: string;
  TIKTOK_CLIENT_SECRET?: string;
  APP_ORIGIN?: string;
}

export interface TikTokLoginProfile {
  openId: string;
  displayName: string;
  avatarUrl: string;
  scope: string;
  connectedAt: string;
}

const START_PATH = '/api/integrations/tiktok/login/start';
const STATUS_PATH = '/api/integrations/tiktok/login/status';
const DISCONNECT_PATH = '/api/integrations/tiktok/login/disconnect';
const CALLBACK_PATH = '/api/integrations/tiktok/oauth/callback';
const STATE_COOKIE = 'imds_tiktok_login_state';
const PROFILE_COOKIE = 'imds_tiktok_login_profile';

const text = (value: unknown): string => typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim();
const record = (value: unknown): JsonRecord => value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {};
const json = (value: unknown, status = 200, headers?: HeadersInit) => new Response(JSON.stringify(value), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
});

function appOrigin(request: Request, env: TikTokLoginKitEnv): string {
  return (text(env.APP_ORIGIN) || new URL(request.url).origin).replace(/\/$/, '');
}

function callbackUri(request: Request, env: TikTokLoginKitEnv): string {
  return `${appOrigin(request, env)}${CALLBACK_PATH}`;
}

function cookieValue(request: Request, name: string): string {
  const cookie = request.headers.get('cookie') || '';
  for (const item of cookie.split(';')) {
    const [key, ...rest] = item.trim().split('=');
    if (key === name) return rest.join('=');
  }
  return '';
}

function encodeProfile(profile: TikTokLoginProfile): string {
  const bytes = new TextEncoder().encode(JSON.stringify(profile));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decodeProfile(value: string): TikTokLoginProfile | null {
  try {
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4);
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes)) as TikTokLoginProfile;
  } catch {
    return null;
  }
}

function secureCookie(name: string, value: string, maxAge: number): string {
  return `${name}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
}

async function exchangeCode(env: TikTokLoginKitEnv, code: string, redirectUri: string): Promise<JsonRecord> {
  const body = new URLSearchParams({
    client_key: text(env.TIKTOK_CLIENT_KEY),
    client_secret: text(env.TIKTOK_CLIENT_SECRET),
    code,
    grant_type: 'authorization_code',
    redirect_uri: redirectUri,
  });
  const response = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body,
  });
  const payload = record(await response.json());
  if (!response.ok || text(payload.error)) {
    throw new Error(text(payload.error_description) || text(payload.error) || `TikTok token exchange failed (${response.status})`);
  }
  return payload;
}

async function getUserProfile(accessToken: string): Promise<{ displayName: string; avatarUrl: string; openId: string }> {
  const response = await fetch('https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name,avatar_url', {
    headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' },
  });
  const payload = record(await response.json());
  const error = record(payload.error);
  if (!response.ok || (text(error.code) && text(error.code) !== 'ok')) {
    throw new Error(text(error.message) || `TikTok user info failed (${response.status})`);
  }
  const data = record(payload.data);
  const user = record(data.user);
  return {
    openId: text(user.open_id),
    displayName: text(user.display_name) || 'TikTok user',
    avatarUrl: text(user.avatar_url),
  };
}

export async function handleTikTokLoginKit(request: Request, env: TikTokLoginKitEnv, url: URL): Promise<Response | null> {
  const isLoginCallback = url.pathname === CALLBACK_PATH && request.method === 'GET' && url.searchParams.has('code');
  const isLoginPath = url.pathname === START_PATH || url.pathname === STATUS_PATH || url.pathname === DISCONNECT_PATH;
  if (!isLoginCallback && !isLoginPath) return null;

  if (url.pathname === STATUS_PATH && request.method === 'GET') {
    const profile = decodeProfile(cookieValue(request, PROFILE_COOKIE));
    return json({ connected: Boolean(profile), profile });
  }

  if (url.pathname === DISCONNECT_PATH && request.method === 'POST') {
    return json({ ok: true }, 200, { 'set-cookie': secureCookie(PROFILE_COOKIE, '', 0) });
  }

  if (!text(env.TIKTOK_CLIENT_KEY) || !text(env.TIKTOK_CLIENT_SECRET)) {
    return json({ error: 'TIKTOK_CLIENT_KEY и TIKTOK_CLIENT_SECRET не настроены' }, 503);
  }

  if (url.pathname === START_PATH && request.method === 'GET') {
    const state = crypto.randomUUID().replace(/-/g, '');
    const authorize = new URL('https://www.tiktok.com/v2/auth/authorize/');
    authorize.searchParams.set('client_key', text(env.TIKTOK_CLIENT_KEY));
    authorize.searchParams.set('response_type', 'code');
    authorize.searchParams.set('scope', 'user.info.basic');
    authorize.searchParams.set('redirect_uri', callbackUri(request, env));
    authorize.searchParams.set('state', state);
    authorize.searchParams.set('disable_auto_auth', '1');
    return new Response(null, {
      status: 302,
      headers: {
        location: authorize.toString(),
        'set-cookie': secureCookie(STATE_COOKIE, state, 600),
        'cache-control': 'no-store',
      },
    });
  }

  if (isLoginCallback) {
    const expectedState = cookieValue(request, STATE_COOKIE);
    const returnedState = text(url.searchParams.get('state'));
    const error = text(url.searchParams.get('error'));
    if (error) return Response.redirect(`${appOrigin(request, env)}/integrations?tiktok_login=error&reason=${encodeURIComponent(error)}`, 302);
    if (!expectedState || !returnedState || expectedState !== returnedState) {
      return Response.redirect(`${appOrigin(request, env)}/integrations?tiktok_login=error&reason=invalid_state`, 302);
    }

    try {
      const token = await exchangeCode(env, text(url.searchParams.get('code')), callbackUri(request, env));
      const accessToken = text(token.access_token);
      if (!accessToken) throw new Error('TikTok did not return an access token');
      const user = await getUserProfile(accessToken);
      const profile: TikTokLoginProfile = {
        ...user,
        openId: user.openId || text(token.open_id),
        scope: text(token.scope),
        connectedAt: new Date().toISOString(),
      };
      const headers = new Headers({ location: `${appOrigin(request, env)}/integrations?tiktok_login=connected`, 'cache-control': 'no-store' });
      headers.append('set-cookie', secureCookie(STATE_COOKIE, '', 0));
      headers.append('set-cookie', secureCookie(PROFILE_COOKIE, encodeProfile(profile), 86400));
      return new Response(null, { status: 302, headers });
    } catch (callbackError) {
      console.error('TikTok Login Kit callback failed', callbackError);
      const reason = callbackError instanceof Error ? callbackError.message : 'callback_failed';
      return Response.redirect(`${appOrigin(request, env)}/integrations?tiktok_login=error&reason=${encodeURIComponent(reason)}`, 302);
    }
  }

  return json({ error: 'Method not allowed' }, 405, { allow: 'GET, POST' });
}
