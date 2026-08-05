export interface MetaOAuthStartEnv {
  META_APP_ID?: string;
  META_GRAPH_VERSION?: string;
  META_OAUTH_REDIRECT_URI?: string;
}

const DEFAULT_REDIRECT_URI = 'https://marketing.amanat-med-academy.workers.dev/api/integrations/meta/callback';
const STATE_COOKIE = 'amanat_meta_oauth_state';

const json = (data: unknown, status = 200, headers: HeadersInit = {}) => new Response(JSON.stringify(data), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
});

const text = (value?: string): string => (value || '').trim();

export function handleMetaOAuthStart(request: Request, env: MetaOAuthStartEnv, url: URL): Response | null {
  if (url.pathname !== '/api/integrations/meta/start' || request.method !== 'POST') return null;

  const appId = text(env.META_APP_ID);
  if (!appId) return json({ error: 'META_APP_ID не настроен в Cloudflare' }, 503);

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
    'set-cookie': `${STATE_COOKIE}=${encodeURIComponent(state)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`,
  });
}
