type JsonRecord = Record<string, unknown>;

interface BitrixOAuthEnv {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  INTEGRATION_ENCRYPTION_KEY?: string;
  BITRIX_CLIENT_ID?: string;
  BITRIX_CLIENT_SECRET?: string;
  APP_ORIGIN?: string;
}

interface CredentialRow {
  id?: string;
  encrypted_payload: string;
  iv: string;
}

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});

const asRecord = (value: unknown): JsonRecord => value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {};
const asString = (value: unknown): string => typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim();

function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

async function keyFor(env: BitrixOAuthEnv): Promise<CryptoKey> {
  const secret = env.INTEGRATION_ENCRYPTION_KEY || `amanat-integrations:v1:${env.SUPABASE_SERVICE_ROLE_KEY}`;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret));
  return crypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

async function encrypt(payload: JsonRecord, env: BitrixOAuthEnv): Promise<{ encrypted_payload: string; iv: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await keyFor(env), new TextEncoder().encode(JSON.stringify(payload)));
  return { encrypted_payload: bytesToBase64(new Uint8Array(encrypted)), iv: bytesToBase64(iv) };
}

async function decrypt(row: CredentialRow, env: BitrixOAuthEnv): Promise<JsonRecord> {
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: base64ToBytes(row.iv) }, await keyFor(env), base64ToBytes(row.encrypted_payload));
  return asRecord(JSON.parse(new TextDecoder().decode(decrypted)));
}

async function supabase<T>(env: BitrixOAuthEnv, path: string, init: RequestInit = {}): Promise<T> {
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
  if (!response.ok) throw new Error(`Bitrix OAuth storage: ${response.status} ${body}`);
  return (body ? JSON.parse(body) : null) as T;
}

async function getCredential(env: BitrixOAuthEnv): Promise<CredentialRow | null> {
  const rows = await supabase<CredentialRow[]>(env, 'integration_credentials?user_id=is.null&provider=eq.bitrix&select=id,encrypted_payload,iv&limit=1');
  return rows[0] || null;
}

function appOrigin(request: Request, env: BitrixOAuthEnv): string {
  return (env.APP_ORIGIN || new URL(request.url).origin).replace(/\/$/, '');
}

async function saveConnection(env: BitrixOAuthEnv, request: Request, token: JsonRecord): Promise<void> {
  const memberId = asString(token.member_id);
  const clientEndpoint = asString(token.client_endpoint);
  const domain = asString(token.domain) || (() => { try { return new URL(clientEndpoint).hostname; } catch { return ''; } })();
  if (!memberId || !clientEndpoint || !asString(token.access_token) || !asString(token.refresh_token)) throw new Error('Bitrix24 returned incomplete OAuth credentials');
  const proxyBase = `${appOrigin(request, env)}/api/integrations/bitrix/oauth/proxy/${encodeURIComponent(memberId)}`;
  const payload: JsonRecord = {
    webhookBaseUrl: proxyBase,
    portalDomain: domain,
    memberId,
    clientEndpoint,
    accessToken: asString(token.access_token),
    refreshToken: asString(token.refresh_token),
    expiresAt: new Date(Date.now() + Number(token.expires_in || 3600) * 1000).toISOString(),
    entityTypeId: '1',
  };
  const encrypted = await encrypt(payload, env);
  const existing = await getCredential(env);
  const stored = {
    provider: 'bitrix',
    user_id: null,
    ...encrypted,
    config_summary: {
      values: { portalDomain: domain, memberId, webhookBaseUrl: proxyBase, entityTypeId: '1' },
      secretFields: { accessToken: true, refreshToken: true },
    },
    status: 'connected',
    last_error: null,
    last_verified_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  if (existing?.id) {
    await supabase(env, `integration_credentials?id=eq.${encodeURIComponent(existing.id)}`, { method: 'PATCH', headers: { prefer: 'return=minimal' }, body: JSON.stringify(stored) });
  } else {
    await supabase(env, 'integration_credentials', { method: 'POST', headers: { prefer: 'return=minimal' }, body: JSON.stringify(stored) });
  }
}

async function refreshToken(env: BitrixOAuthEnv, request: Request, payload: JsonRecord): Promise<JsonRecord> {
  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: asString(env.BITRIX_CLIENT_ID),
    client_secret: asString(env.BITRIX_CLIENT_SECRET),
    refresh_token: asString(payload.refreshToken),
  });
  const response = await fetch(`https://oauth.bitrix.info/oauth/token/?${params}`, { headers: { accept: 'application/json' } });
  const token = asRecord(await response.json());
  if (!response.ok || token.error) throw new Error(`Bitrix token refresh failed: ${JSON.stringify(token)}`);
  await saveConnection(env, request, { ...token, member_id: payload.memberId, client_endpoint: payload.clientEndpoint, domain: payload.portalDomain });
  return { ...payload, accessToken: token.access_token, refreshToken: token.refresh_token, expiresAt: new Date(Date.now() + Number(token.expires_in || 3600) * 1000).toISOString() };
}

export async function handleBitrixOAuth(request: Request, env: BitrixOAuthEnv, url: URL): Promise<Response | null> {
  if (!url.pathname.startsWith('/api/integrations/bitrix/oauth/')) return null;
  if (!env.BITRIX_CLIENT_ID || !env.BITRIX_CLIENT_SECRET) return json({ error: 'BITRIX_CLIENT_ID и BITRIX_CLIENT_SECRET не настроены' }, 503);

  if (url.pathname === '/api/integrations/bitrix/oauth/start' && request.method === 'GET') {
    const state = base64Url(crypto.getRandomValues(new Uint8Array(24)));
    const redirectUri = `${appOrigin(request, env)}/api/integrations/bitrix/oauth/callback`;
    const authorize = new URL('https://oauth.bitrix.info/oauth/authorize/');
    authorize.searchParams.set('client_id', env.BITRIX_CLIENT_ID);
    authorize.searchParams.set('response_type', 'code');
    authorize.searchParams.set('redirect_uri', redirectUri);
    authorize.searchParams.set('state', state);
    return Response.redirect(authorize.toString(), 302);
  }

  if (url.pathname === '/api/integrations/bitrix/oauth/callback' && request.method === 'GET') {
    const code = url.searchParams.get('code');
    if (!code) return Response.redirect(`${appOrigin(request, env)}/integrations?bitrix=error`, 302);
    const params = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: env.BITRIX_CLIENT_ID,
      client_secret: env.BITRIX_CLIENT_SECRET,
      code,
      redirect_uri: `${appOrigin(request, env)}/api/integrations/bitrix/oauth/callback`,
    });
    const response = await fetch(`https://oauth.bitrix.info/oauth/token/?${params}`, { headers: { accept: 'application/json' } });
    const token = asRecord(await response.json());
    if (!response.ok || token.error) return Response.redirect(`${appOrigin(request, env)}/integrations?bitrix=error`, 302);
    await saveConnection(env, request, token);
    return Response.redirect(`${appOrigin(request, env)}/integrations?bitrix=connected`, 302);
  }

  const proxyPrefix = '/api/integrations/bitrix/oauth/proxy/';
  if (url.pathname.startsWith(proxyPrefix) && request.method === 'POST') {
    const memberAndMethod = url.pathname.slice(proxyPrefix.length).split('/');
    const memberId = decodeURIComponent(memberAndMethod.shift() || '');
    const method = memberAndMethod.join('/').replace(/\.json$/, '');
    const row = await getCredential(env);
    if (!row) return json({ error: 'Bitrix24 is not connected' }, 404);
    let payload = await decrypt(row, env);
    if (asString(payload.memberId) !== memberId) return json({ error: 'Unknown Bitrix24 connection' }, 404);
    if (new Date(asString(payload.expiresAt)).getTime() < Date.now() + 60000) payload = await refreshToken(env, request, payload);
    const params = asRecord(await request.json().catch(() => ({})));
    const endpoint = `${asString(payload.clientEndpoint).replace(/\/$/, '')}/${method}.json`;
    let response = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ ...params, auth: asString(payload.accessToken) }) });
    let body = await response.text();
    if (response.status === 401 || /expired_token|invalid_token/i.test(body)) {
      payload = await refreshToken(env, request, payload);
      response = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ ...params, auth: asString(payload.accessToken) }) });
      body = await response.text();
    }
    return new Response(body, { status: response.status, headers: { 'content-type': response.headers.get('content-type') || 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
  }

  return json({ error: 'Method not allowed' }, 405);
}
