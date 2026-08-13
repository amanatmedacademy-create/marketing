export interface MetaOAuthStartEnv {
  META_APP_ID?: string;
  META_APP_SECRET?: string;
  META_GRAPH_VERSION?: string;
  META_OAUTH_REDIRECT_URI?: string;
  CURRENT_COMPANY_ID?: string;
}

const DEFAULT_REDIRECT_URI = 'https://marketing.amanat-med-academy.workers.dev/api/integrations/meta/callback';
const STATE_COOKIE = 'amanat_meta_oauth_state';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const json = (data: unknown, status = 200, headers: HeadersInit = {}) => new Response(JSON.stringify(data), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
});

const text = (value?: string): string => (value || '').trim();

export function handleMetaOAuthStart(request: Request, env: MetaOAuthStartEnv, url: URL): Response | null {
  if (url.pathname !== '/api/integrations/meta/start' || request.method !== 'POST') return null;

  const appId = text(env.META_APP_ID);
  const appSecret = text(env.META_APP_SECRET);
  if (!appId || !appSecret) {
    return json({ error: 'META_APP_ID или META_APP_SECRET не настроены в Cloudflare' }, 503);
  }

  const companyId = text(env.CURRENT_COMPANY_ID);
  if (!UUID_PATTERN.test(companyId)) return json({ error: 'Выберите клинику перед подключением Meta' }, 409);

  const versionValue = text(env.META_GRAPH_VERSION) || 'v23.0';
  const version = versionValue.startsWith('v') ? versionValue : `v${versionValue}`;
  const redirectUri = text(env.META_OAUTH_REDIRECT_URI) || DEFAULT_REDIRECT_URI;
  const state = crypto.randomUUID().replace(/-/g, '');
  const stateCookie = `${state}.${companyId}`;
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
    'set-cookie': `${STATE_COOKIE}=${encodeURIComponent(stateCookie)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`,
  });
}
