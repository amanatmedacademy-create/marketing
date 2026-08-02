import type { AuthEnv, AuthSession } from './auth';

export interface MetaEnv extends AuthEnv {
  META_APP_ID?: string;
  META_APP_SECRET?: string;
  META_WABA_CONFIG_ID?: string;
  META_ADS_CONFIG_ID?: string;
  META_GRAPH_VERSION?: string;
}

type MetaProduct = 'waba' | 'ads';
type ExchangeBody = {
  code?: string;
  product?: MetaProduct;
  wabaId?: string;
  phoneNumberId?: string;
  businessId?: string;
};

type MetaTokenResponse = {
  access_token?: string;
  token_type?: string;
  expires_in?: number;
  error?: { message?: string; type?: string; code?: number };
};

type MetaProfile = { id?: string; name?: string; error?: { message?: string } };
type AdAccount = { id: string; name?: string; account_status?: number; currency?: string; timezone_name?: string };

type StoredConnection = {
  product: MetaProduct;
  status: string;
  meta_user_id: string | null;
  meta_user_name: string | null;
  business_id: string | null;
  waba_id: string | null;
  phone_number_id: string | null;
  ad_accounts: AdAccount[] | null;
  connected_at: string;
  updated_at: string;
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});

function graphVersion(env: MetaEnv) {
  return env.META_GRAPH_VERSION?.trim() || 'v23.0';
}

function assertMetaEnv(env: MetaEnv) {
  if (!env.META_APP_ID || !env.META_APP_SECRET) throw new Error('Meta application secrets are not configured');
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('Supabase service environment is not configured');
}

async function supabaseRest(env: MetaEnv, path: string, init: RequestInit = {}) {
  assertMetaEnv(env);
  return fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY!,
      authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      'content-type': 'application/json',
      prefer: 'return=representation,resolution=merge-duplicates',
      ...init.headers,
    },
  });
}

async function graphFetch<T>(env: MetaEnv, path: string, accessToken: string) {
  const separator = path.includes('?') ? '&' : '?';
  const response = await fetch(`https://graph.facebook.com/${graphVersion(env)}/${path}${separator}access_token=${encodeURIComponent(accessToken)}`, {
    headers: { accept: 'application/json' },
  });
  const payload = await response.json() as T;
  if (!response.ok) throw new Error(`Meta Graph API error (${response.status})`);
  return payload;
}

async function exchangeCode(env: MetaEnv, code: string) {
  assertMetaEnv(env);
  const params = new URLSearchParams({
    client_id: env.META_APP_ID!,
    client_secret: env.META_APP_SECRET!,
    code,
  });
  const response = await fetch(`https://graph.facebook.com/${graphVersion(env)}/oauth/access_token?${params.toString()}`, {
    headers: { accept: 'application/json' },
  });
  const payload = await response.json() as MetaTokenResponse;
  if (!response.ok || !payload.access_token) {
    throw new Error(payload.error?.message || 'Meta authorization code exchange failed');
  }
  return payload;
}

async function loadAssets(env: MetaEnv, product: MetaProduct, token: string) {
  const profile = await graphFetch<MetaProfile>(env, 'me?fields=id,name', token);
  if (!profile.id) throw new Error(profile.error?.message || 'Meta profile is unavailable');

  let adAccounts: AdAccount[] = [];
  if (product === 'ads') {
    const accounts = await graphFetch<{ data?: AdAccount[] }>(env, 'me/adaccounts?fields=id,name,account_status,currency,timezone_name&limit=200', token);
    adAccounts = accounts.data ?? [];
  }

  return { profile, adAccounts };
}

async function saveConnection(env: MetaEnv, session: AuthSession, body: ExchangeBody, token: MetaTokenResponse, assets: Awaited<ReturnType<typeof loadAssets>>) {
  const now = new Date().toISOString();
  const record = {
    company_id: session.companyId,
    product: body.product,
    status: 'connected',
    meta_user_id: assets.profile.id,
    meta_user_name: assets.profile.name ?? null,
    business_id: body.businessId?.trim() || null,
    waba_id: body.product === 'waba' ? body.wabaId?.trim() || null : null,
    phone_number_id: body.product === 'waba' ? body.phoneNumberId?.trim() || null : null,
    ad_accounts: body.product === 'ads' ? assets.adAccounts : [],
    access_token: token.access_token,
    token_type: token.token_type ?? 'bearer',
    expires_at: token.expires_in ? new Date(Date.now() + token.expires_in * 1000).toISOString() : null,
    connected_by: session.user.id,
    connected_at: now,
    updated_at: now,
  };

  const response = await supabaseRest(env, 'meta_connections?on_conflict=company_id,product', {
    method: 'POST',
    body: JSON.stringify(record),
  });
  if (!response.ok) throw new Error(`Meta connection storage failed: ${await response.text()}`);
}

async function listConnections(env: MetaEnv, session: AuthSession) {
  const response = await supabaseRest(
    env,
    `meta_connections?select=product,status,meta_user_id,meta_user_name,business_id,waba_id,phone_number_id,ad_accounts,connected_at,updated_at&company_id=eq.${encodeURIComponent(session.companyId)}&order=product.asc`,
  );
  if (!response.ok) throw new Error(`Meta connection lookup failed: ${await response.text()}`);
  const rows = await response.json() as StoredConnection[];
  return json({ connections: rows });
}

async function disconnect(env: MetaEnv, session: AuthSession, product: MetaProduct) {
  const response = await supabaseRest(
    env,
    `meta_connections?company_id=eq.${encodeURIComponent(session.companyId)}&product=eq.${product}`,
    { method: 'DELETE' },
  );
  if (!response.ok) throw new Error(`Meta disconnect failed: ${await response.text()}`);
  return json({ success: true, product });
}

export function getMetaPublicConfig(env: MetaEnv) {
  return json({
    appId: env.META_APP_ID ?? null,
    graphVersion: graphVersion(env),
    configurations: {
      waba: env.META_WABA_CONFIG_ID ?? null,
      ads: env.META_ADS_CONFIG_ID ?? null,
    },
    configured: {
      app: Boolean(env.META_APP_ID && env.META_APP_SECRET),
      waba: Boolean(env.META_WABA_CONFIG_ID),
      ads: Boolean(env.META_ADS_CONFIG_ID),
    },
  });
}

export async function handleMetaRequest(request: Request, env: MetaEnv, session: AuthSession) {
  const url = new URL(request.url);
  const path = url.pathname;

  try {
    if (request.method === 'GET' && path === '/api/integrations/meta') return listConnections(env, session);

    if (request.method === 'POST' && path === '/api/integrations/meta/exchange') {
      const body = await request.json() as ExchangeBody;
      if (!body.code?.trim() || (body.product !== 'waba' && body.product !== 'ads')) {
        return json({ error: { code: 'INVALID_META_EXCHANGE', message: 'Не переданы code и тип Meta-подключения' } }, 400);
      }
      const token = await exchangeCode(env, body.code.trim());
      const assets = await loadAssets(env, body.product, token.access_token!);
      await saveConnection(env, session, body, token, assets);
      return json({
        connection: {
          product: body.product,
          status: 'connected',
          metaUser: { id: assets.profile.id, name: assets.profile.name ?? null },
          wabaId: body.product === 'waba' ? body.wabaId ?? null : null,
          phoneNumberId: body.product === 'waba' ? body.phoneNumberId ?? null : null,
          adAccounts: body.product === 'ads' ? assets.adAccounts : [],
        },
      });
    }

    const disconnectMatch = path.match(/^\/api\/integrations\/meta\/(waba|ads)$/);
    if (request.method === 'DELETE' && disconnectMatch) return disconnect(env, session, disconnectMatch[1] as MetaProduct);

    return null;
  } catch (error) {
    return json({ error: { code: 'META_INTEGRATION_ERROR', message: error instanceof Error ? error.message : 'Ошибка Meta integration' } }, 500);
  }
}
