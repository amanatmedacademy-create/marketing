import { resolveCompanyId } from './companyContext';

type JsonRecord = Record<string, unknown>;

export interface WabaEmbeddedSignupEnv {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  DEFAULT_COMPANY_ID?: string;
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

function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

async function encrypt(payload: JsonRecord, secret: string): Promise<{ encryptedPayload: string; iv: string }> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret));
  const key = await crypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(payload)));
  return { encryptedPayload: bytesToBase64(new Uint8Array(encrypted)), iv: bytesToBase64(iv) };
}

async function decrypt(encryptedPayload: string, ivValue: string, secret: string): Promise<JsonRecord> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret));
  const key = await crypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, ['decrypt']);
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: base64ToBytes(ivValue) }, key, base64ToBytes(encryptedPayload));
  return record(JSON.parse(new TextDecoder().decode(decrypted)));
}

function generateRegistrationPin(): string {
  const value = crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000;
  return String(value).padStart(6, '0');
}

async function exchangeCode(env: WabaEmbeddedSignupEnv, code: string): Promise<string> {
  if (!env.META_APP_ID || !env.META_APP_SECRET) throw new Error('META_APP_ID или META_APP_SECRET не настроены');
  const params = new URLSearchParams({ client_id: env.META_APP_ID, client_secret: env.META_APP_SECRET, code });
  const response = await fetch(`https://graph.facebook.com/${graphVersion(env)}/oauth/access_token?${params}`, { headers: { accept: 'application/json' } });
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

async function graphGet(env: WabaEmbeddedSignupEnv, accessToken: string, path: string): Promise<JsonRecord> {
  const response = await fetch(`https://graph.facebook.com/${graphVersion(env)}/${path}`, {
    headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' },
  });
  const body = await response.text();
  let parsed: JsonRecord = {};
  try { parsed = record(body ? JSON.parse(body) : {}); } catch { parsed = { error: body }; }
  if (!response.ok || parsed.error) {
    const error = record(parsed.error);
    throw new Error(text(error.message) || `Meta Graph: ${response.status}`);
  }
  return parsed;
}

async function resolvePhoneNumberId(env: WabaEmbeddedSignupEnv, accessToken: string, wabaId: string, suppliedPhoneNumberId: string): Promise<string> {
  if (suppliedPhoneNumberId) return suppliedPhoneNumberId;
  const payload = await graphGet(env, accessToken, `${encodeURIComponent(wabaId)}/phone_numbers?fields=id,display_phone_number,verified_name&limit=100`);
  const rows = Array.isArray(payload.data) ? payload.data.map(record) : [];
  const ids = rows.map((row) => text(row.id)).filter(Boolean);
  if (ids.length === 1) return ids[0];
  if (ids.length === 0) throw new Error('WABA подключена, но Meta не вернула Phone Number ID. Завершите добавление номера в WhatsApp Manager и повторите подключение.');
  throw new Error('В WABA найдено несколько номеров, а Embedded Signup не указал выбранный Phone Number ID. Повторите подключение и выберите конкретный номер.');
}

async function subscribeWaba(env: WabaEmbeddedSignupEnv, accessToken: string, wabaId: string): Promise<void> {
  const response = await fetch(`https://graph.facebook.com/${graphVersion(env)}/${encodeURIComponent(wabaId)}/subscribed_apps`, {
    method: 'POST',
    headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' },
  });
  const body = await response.text();
  let parsed: JsonRecord = {};
  try { parsed = record(body ? JSON.parse(body) : {}); } catch { parsed = { error: body }; }
  if (!response.ok || parsed.success === false || parsed.error) {
    const error = record(parsed.error);
    throw new Error(text(error.message) || `Meta WABA subscription: ${response.status}`);
  }
}

async function registerPhoneNumber(env: WabaEmbeddedSignupEnv, accessToken: string, phoneNumberId: string, pin: string): Promise<void> {
  const response = await fetch(`https://graph.facebook.com/${graphVersion(env)}/${encodeURIComponent(phoneNumberId)}/register`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
      accept: 'application/json',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ messaging_product: 'whatsapp', pin }),
  });
  const body = await response.text();
  let parsed: JsonRecord = {};
  try { parsed = record(body ? JSON.parse(body) : {}); } catch { parsed = { error: body }; }
  if (!response.ok || parsed.success === false || parsed.error) {
    const error = record(parsed.error);
    const code = Number(error.code || 0);
    if (code === 133005) {
      throw new Error('PIN двухэтапной проверки WhatsApp не совпадает. Сбросьте PIN номера в WhatsApp Manager и повторите подключение.');
    }
    throw new Error(text(error.message) || `Meta phone registration: ${response.status}`);
  }
}

async function credentialRows(env: WabaEmbeddedSignupEnv, companyId: string, userId: string, select: string): Promise<JsonRecord[]> {
  const baseUrl = `${env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/integration_credentials`;
  const common = `company_id=eq.${encodeURIComponent(companyId)}&provider=eq.waba&select=${encodeURIComponent(select)}&order=updated_at.desc`;
  const tenantResponse = await fetch(`${baseUrl}?${common}&user_id=is.null`, {
    headers: supabaseHeaders(env, { accept: 'application/json' }),
  });
  if (tenantResponse.ok) {
    const tenantRows = await tenantResponse.json() as JsonRecord[];
    if (tenantRows.length) return tenantRows;
  }
  if (!userId) return [];
  const userResponse = await fetch(`${baseUrl}?${common}&user_id=eq.${encodeURIComponent(userId)}`, {
    headers: supabaseHeaders(env, { accept: 'application/json' }),
  });
  if (!userResponse.ok) return [];
  return await userResponse.json() as JsonRecord[];
}

function rowPhoneNumberId(row: JsonRecord): string {
  return text(record(record(row.config_summary).values).phoneNumberId);
}

async function readExistingRegistrationPin(env: WabaEmbeddedSignupEnv, companyId: string, userId: string, phoneNumberId: string): Promise<string> {
  const rows = await credentialRows(env, companyId, userId, 'encrypted_payload,iv,config_summary');
  const row = rows.find((item) => rowPhoneNumberId(item) === phoneNumberId);
  const encryptedPayload = text(row?.encrypted_payload);
  const iv = text(row?.iv);
  if (!encryptedPayload || !iv) return '';
  try {
    const payload = await decrypt(encryptedPayload, iv, encryptionSecret(env));
    const pin = text(payload.registrationPin);
    return /^\d{6}$/.test(pin) ? pin : '';
  } catch (error) {
    console.error('Unable to recover WABA registration PIN', error);
    return '';
  }
}

async function saveCredential(env: WabaEmbeddedSignupEnv, companyId: string, userId: string, accessToken: string, wabaId: string, phoneNumberId: string, registrationPin: string): Promise<void> {
  const encrypted = await encrypt({ accessToken, wabaId, phoneNumberId, graphVersion: graphVersion(env), registrationPin }, encryptionSecret(env));
  const baseUrl = `${env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/integration_credentials`;
  const payload = {
    company_id: companyId,
    user_id: null,
    provider: 'waba',
    encrypted_payload: encrypted.encryptedPayload,
    iv: encrypted.iv,
    config_summary: {
      values: {
        wabaId,
        phoneNumberId,
        graphVersion: graphVersion(env),
        webhookSubscribed: true,
        registered: true,
        ownership: 'tenant',
        credentialMode: 'oauth_user',
        connectedByUserId: userId,
      },
      secretFields: { accessToken: true, registrationPin: true },
    },
    status: 'connected',
    last_error: null,
    last_verified_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const tenantLookup = await fetch(`${baseUrl}?company_id=eq.${encodeURIComponent(companyId)}&user_id=is.null&provider=eq.waba&select=id,config_summary&order=updated_at.desc`, {
    headers: supabaseHeaders(env, { accept: 'application/json' }),
  });
  if (!tenantLookup.ok) throw new Error(`Supabase WABA lookup: ${tenantLookup.status} ${await tenantLookup.text()}`);
  let existingRows = await tenantLookup.json() as Array<{ id?: string; config_summary?: unknown }>;
  let existing = existingRows.find((item) => rowPhoneNumberId(item as JsonRecord) === phoneNumberId);

  if (!existing?.id && userId) {
    const userLookup = await fetch(`${baseUrl}?company_id=eq.${encodeURIComponent(companyId)}&user_id=eq.${encodeURIComponent(userId)}&provider=eq.waba&select=id,config_summary&order=updated_at.desc`, {
      headers: supabaseHeaders(env, { accept: 'application/json' }),
    });
    if (userLookup.ok) {
      existingRows = await userLookup.json() as Array<{ id?: string; config_summary?: unknown }>;
      existing = existingRows.find((item) => rowPhoneNumberId(item as JsonRecord) === phoneNumberId);
    }
  }

  const response = existing?.id
    ? await fetch(`${baseUrl}?id=eq.${encodeURIComponent(existing.id)}`, {
        method: 'PATCH', headers: supabaseHeaders(env, { prefer: 'return=minimal' }), body: JSON.stringify(payload),
      })
    : await fetch(baseUrl, {
        method: 'POST', headers: supabaseHeaders(env, { prefer: 'return=minimal' }), body: JSON.stringify(payload),
      });
  if (!response.ok) throw new Error(`Supabase WABA save: ${response.status} ${await response.text()}`);
}

async function readConnection(env: WabaEmbeddedSignupEnv, companyId: string, userId: string): Promise<JsonRecord | null> {
  const rows = await credentialRows(env, companyId, userId, 'id,status,config_summary,last_verified_at,last_error,updated_at');
  return rows[0] || null;
}

async function readConnections(env: WabaEmbeddedSignupEnv, companyId: string, userId: string): Promise<JsonRecord[]> {
  return credentialRows(env, companyId, userId, 'id,status,config_summary,last_verified_at,last_error,updated_at');
}

async function readBusinessProfile(env: WabaEmbeddedSignupEnv, companyId: string, userId: string): Promise<JsonRecord | null> {
  const rows = await credentialRows(env, companyId, userId, 'encrypted_payload,iv');
  const row = rows[0];
  const encryptedPayload = text(row?.encrypted_payload);
  const iv = text(row?.iv);
  if (!encryptedPayload || !iv) return null;

  const credential = await decrypt(encryptedPayload, iv, encryptionSecret(env));
  const accessToken = text(credential.accessToken);
  const wabaId = text(credential.wabaId);
  const phoneNumberId = text(credential.phoneNumberId);
  if (!accessToken || !wabaId || !phoneNumberId) return null;

  const [profilePayload, phonePayload] = await Promise.all([
    graphGet(env, accessToken, `${encodeURIComponent(phoneNumberId)}/whatsapp_business_profile?fields=about,address,description,email,profile_picture_url,websites,vertical`),
    graphGet(env, accessToken, `${encodeURIComponent(wabaId)}/phone_numbers?fields=id,display_phone_number,verified_name,quality_rating&limit=100`),
  ]);

  const profiles = Array.isArray(profilePayload.data) ? profilePayload.data.map(record) : [];
  const profile = profiles[0] || {};
  const phoneRows = Array.isArray(phonePayload.data) ? phonePayload.data.map(record) : [];
  const phone = phoneRows.find((item) => text(item.id) === phoneNumberId) || {};
  const websites = Array.isArray(profile.websites) ? profile.websites.map(text).filter(Boolean) : [];

  return {
    profilePictureUrl: text(profile.profile_picture_url) || null,
    verifiedName: text(phone.verified_name) || null,
    displayPhoneNumber: text(phone.display_phone_number) || null,
    qualityRating: text(phone.quality_rating) || null,
    about: text(profile.about) || null,
    description: text(profile.description) || null,
    address: text(profile.address) || null,
    email: text(profile.email) || null,
    websites,
    vertical: text(profile.vertical) || null,
  };
}

export async function handleWabaEmbeddedSignupRequest(request: Request, env: WabaEmbeddedSignupEnv, url: URL): Promise<Response | null> {
  if (url.pathname === '/api/integrations/waba/config' && request.method === 'GET') {
    const appId = text(env.META_APP_ID);
    const configId = text(env.META_WABA_CONFIG_ID);
    const userId = authenticatedUserId(request);
    const configured = Boolean(appId && env.META_APP_SECRET && configId);
    const companyId = userId ? await resolveCompanyId(env).catch(() => '') : '';
    const connections = companyId ? await readConnections(env, companyId, userId).catch(() => []) : [];
    const connection = connections[0] || null;
    const businessProfile = companyId && connection && text(connection.status) === 'connected'
      ? await readBusinessProfile(env, companyId, userId).catch((error) => {
          console.warn('Unable to load WABA business profile', error instanceof Error ? error.message : String(error));
          return null;
        })
      : null;
    return json({
      configured,
      appId,
      configId,
      version: graphVersion(env),
      connected: connections.some((item) => text(item.status) === 'connected'),
      connection: connection ? {
        id: connection.id,
        status: connection.status,
        values: record(record(connection.config_summary).values),
        businessProfile,
        lastVerifiedAt: connection.last_verified_at || null,
        lastError: connection.last_error || null,
      } : null,
      connections: connections.map((item) => ({
        id: item.id,
        status: item.status,
        values: record(record(item.config_summary).values),
        lastVerifiedAt: item.last_verified_at || null,
        lastError: item.last_error || null,
        updatedAt: item.updated_at || null,
      })),
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
      const suppliedPhoneNumberId = text(payload.phoneNumberId);
      const suppliedPin = text(payload.pin);
      if (!code) return json({ error: 'Facebook authorization code не получен' }, 400);
      if (!wabaId) return json({ error: 'Facebook не вернул WABA ID' }, 400);
      if (suppliedPin && !/^\d{6}$/.test(suppliedPin)) return json({ error: 'PIN двухэтапной проверки должен состоять из 6 цифр' }, 400);
      const companyId = await resolveCompanyId(env);
      const accessToken = await exchangeCode(env, code);
      const phoneNumberId = await resolvePhoneNumberId(env, accessToken, wabaId, suppliedPhoneNumberId);
      const existingPin = await readExistingRegistrationPin(env, companyId, userId, phoneNumberId);
      const registrationPin = suppliedPin || existingPin || generateRegistrationPin();
      await subscribeWaba(env, accessToken, wabaId);
      await registerPhoneNumber(env, accessToken, phoneNumberId, registrationPin);
      await saveCredential(env, companyId, userId, accessToken, wabaId, phoneNumberId, registrationPin);
      return json({ ok: true, wabaId, phoneNumberId, webhookSubscribed: true, registered: true, ownership: 'tenant' });
    } catch (error) {
      console.error('WABA Embedded Signup failed', error);
      return json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  }
  return null;
}
