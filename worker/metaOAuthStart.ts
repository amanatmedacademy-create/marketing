export interface MetaOAuthStartEnv {
  META_APP_ID?: string;
  META_APP_SECRET?: string;
  META_GRAPH_VERSION?: string;
  META_OAUTH_REDIRECT_URI?: string;
  CURRENT_COMPANY_ID?: string;
}

const DEFAULT_REDIRECT_URI = 'https://marketing.amanat-med-academy.workers.dev/api/integrations/meta/callback';
const STATE_COOKIE = 'amanat_meta_oauth_state';

const json = (data: unknown, status = 200, headers: HeadersInit = {}) => new Response(JSON.stringify(data), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
});

const text = (value?: string | null): string => (value || '').trim();

function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function signedStateCookie(state: string, companyId: string, userId: string, secret: string): Promise<string> {
  const payload = base64Url(new TextEncoder().encode(JSON.stringify({ state, companyId, userId, issuedAt: Date.now() })));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  return encodeURIComponent(`${payload}.${base64Url(new Uint8Array(signature))}`);
}

export async function handleMetaOAuthStart(request: Request, env: MetaOAuthStartEnv, url: URL): Promise<Response | null> {
  if (url.pathname !== '/api/integrations/meta/start' || request.method !== 'POST') return null;

  const appId = text(env.META_APP_ID);
  const appSecret = text(env.META_APP_SECRET);
  if (!appId || !appSecret) {
    return json({ error: 'META_APP_ID или META_APP_SECRET не настроены в Cloudflare' }, 503);
  }

  const companyId = text(env.CURRENT_COMPANY_ID);
  const userId = text(request.headers.get('x-amanat-auth-user'));
  if (!companyId || !userId) return json({ error: 'Не удалось определить клинику для Meta OAuth' }, 409);

  const versionValue = text(env.META_GRAPH_VERSION) || 'v23.0';
  const version = versionValue.startsWith('v') ? versionValue : `v${versionValue}`;
  const redirectUri = text(env.META_OAUTH_REDIRECT_URI) || DEFAULT_REDIRECT_URI;
  const state = crypto.randomUUID().replace(/-/g, '');
  const params = new URLSearchParams({
    client_id: appId,
    redirect_uri: redirectUri,
    state,
    response_type: 'code',
    scope: 'ads_read,business_management',
  });

  return json({
    ok: true,
    authorizationUrl: `https://www.facebook.com/${version}/dialog/oauth?${params.toString()}`,
    redirectUri,
  }, 200, {
    'set-cookie': `${STATE_COOKIE}=${await signedStateCookie(state, companyId, userId, appSecret)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`,
  });
}
