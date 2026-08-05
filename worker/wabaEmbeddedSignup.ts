type JsonRecord = Record<string, unknown>;

export interface WabaEmbeddedSignupEnv {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  INTEGRATION_ENCRYPTION_KEY?: string;
  META_APP_ID?: string;
  META_APP_SECRET?: string;
  META_GRAPH_VERSION?: string;
  META_WABA_CONFIG_ID?: string;
}

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});
const text = (value: unknown): string => typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim();
const record = (value: unknown): JsonRecord => value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {};
const graphVersion = (env: WabaEmbeddedSignupEnv): string => {
  const value = text(env.META_GRAPH_VERSION) || 'v23.0';
  return value.startsWith('v') ? value : `v${value}`;
};
const encryptionSecret = (env: WabaEmbeddedSignupEnv): string => text(env.INTEGRATION_ENCRYPTION_KEY) || `imds-integrations:v1:${env.SUPABASE_SERVICE_ROLE_KEY}`;
const authenticatedUserId = (request: Request): string => text(request.headers.get('x-amanat-auth-user'));

const supabaseHeaders = (env: WabaEmbeddedSignupEnv, extra: HeadersInit = {}): HeadersInit => ({
  apikey: env.SUPABASE_SERVICE_ROLE_KEY,
  authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
  'content-type': 'application/json',
  ...extra,
});

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function encrypt(payload: JsonRecord, secret: string): Promise<{ encryptedPayload: string; iv: string }> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret));
  const key = await crypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(payload)));
  return { encryptedPayload: bytesToBase64(new Uint8Array(encrypted)), iv: bytesToBase64(iv) };
}

async function exchangeCode(env: WabaEmbeddedSignupEnv, code: string): Promise<string> {
  if (!env.META_APP_ID || !env.META_APP_SECRET) throw new Error('META_APP_ID или META_APP_SECRET не настроены');
  const params = new URLSearchParams({
    client_id: env.META_APP_ID,
    client_secret: env.META_APP_SECRET,
    code,
  });
  const response = await fetch(`https://graph.facebook.com/${graphVersion(env)}/oauth/access_token?${params}`, {
    headers: { accept: 'application/json' },
  });
  const body = await response.text();
  let parsed: JsonRecord = {};
  try { parsed = record(body ? JSON.parse(body) : {}); } catch { parsed = { error: body }; }
  if (!response.ok) {
    const error = record(parsed.error);
    throw new Error(text(error.message) || text(parsed.error) || `Meta OAuth: ${response.status}`);
  }
  const accessToken = text(parsed.access_token);
  if (!accessToken) throw new Error('Meta не вернула access token для WABA');
  return accessToken;
}

async function saveCredential(env: WabaEmbeddedSignupEnv, userId: string, accessToken: string, wabaId: string, phoneNumberId: string): Promise<void> {
  const encrypted = await encrypt({ accessToken, wabaId, phoneNumberId, graphVersion: graphVersion(env) }, encryptionSecret(env));
  const baseUrl = `${env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/integration_credentials`;
  const filter = `user_id=eq.${encodeURIComponent(userId)}&provider=eq.waba`;
  const payload = {
    user_id: userId,
    provider: 'waba',
    encrypted_payload: encrypted.encryptedPayload,
    iv: encrypted.iv,
    config_summary: {
      values: { wabaId, phoneNumberId, graphVersion: graphVersion(env) },
      secretFields: { accessToken: true },
    },
    status: 'connected',
    last_error: null,
    last_verified_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const existingResponse = await fetch(`${baseUrl}?${filter}&select=id&limit=1`, {
    headers: supabaseHeaders(env, { accept: 'application/json' }),
  });
  if (!existingResponse.ok) throw new Error(`Supabase WABA lookup: ${existingResponse.status} ${await existingResponse.text()}`);
  const existingRows = await existingResponse.json() as Array<{ id?: string }>;

  const response = existingRows[0]?.id
    ? await fetch(`${baseUrl}?id=eq.${encodeURIComponent(existingRows[0].id as string)}`, {
        method: 'PATCH',
        headers: supabaseHeaders(env, { prefer: 'return=minimal' }),
        body: JSON.stringify(payload),
      })
    : await fetch(baseUrl, {
        method: 'POST',
        headers: supabaseHeaders(env, { prefer: 'return=minimal' }),
        body: JSON.stringify(payload),
      });

  if (!response.ok) throw new Error(`Supabase WABA save: ${response.status} ${await response.text()}`);
}

async function readConnection(env: WabaEmbeddedSignupEnv, userId: string): Promise<JsonRecord | null> {
  const response = await fetch(
    `${env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/integration_credentials?user_id=eq.${encodeURIComponent(userId)}&provider=eq.waba&select=status,config_summary,last_verified_at,last_error&limit=1`,
    { headers: supabaseHeaders(env, { accept: 'application/json' }) },
  );
  if (!response.ok) throw new Error(`Supabase WABA status: ${response.status} ${await response.text()}`);
  const rows = await response.json() as JsonRecord[];
  return rows[0] || null;
}

export async function handleWabaEmbeddedSignupRequest(request: Request, env: WabaEmbeddedSignupEnv, url: URL): Promise<Response | null> {
  if (url.pathname === '/api/integrations/waba/config' && request.method === 'GET') {
    const appId = text(env.META_APP_ID);
    const configId = text(env.META_WABA_CONFIG_ID);
    const userId = authenticatedUserId(request);
    const configured = Boolean(appId && env.META_APP_SECRET && configId);
    const connection = userId ? await readConnection(env, userId).catch(() => null) : null;
    return json({
      configured,
      appId,
      configId,
      version: graphVersion(env),
      connected: Boolean(connection && text(connection.status) === 'connected'),
      connection: connection ? {
        status: connection.status,
        values: record(record(connection.config_summary).values),
        lastVerifiedAt: connection.last_verified_at || null,
        lastError: connection.last_error || null,
      } : null,
      error: configured ? undefined : 'Нужны META_APP_ID, META_APP_SECRET и META_WABA_CONFIG_ID',
    }, configured ? 200 : 503);
  }

  if (url.pathname === '/api/integrations/waba/connect' && request.method === 'POST') {
    try {
      const userId = authenticatedUserId(request);
      if (!userId) return json({ error: 'Требуется авторизация пользователя' }, 401);

      const payload = record(await request.json());
      const code = text(payload.code);
      const wabaId = text(payload.wabaId);
      const phoneNumberId = text(payload.phoneNumberId);
      if (!code) return json({ error: 'Facebook authorization code не получен' }, 400);
      if (!wabaId || !phoneNumberId) return json({ error: 'Facebook не вернул WABA ID или Phone Number ID' }, 400);
      const accessToken = await exchangeCode(env, code);
      await saveCredential(env, userId, accessToken, wabaId, phoneNumberId);
      return json({ ok: true, wabaId, phoneNumberId });
    } catch (error) {
      console.error('WABA Embedded Signup failed', error);
      return json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  }

  return null;
}
