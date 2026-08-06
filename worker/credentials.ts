import { resolveCompanyId } from './companyContext';

type JsonRecord = Record<string, unknown>;

export type IntegrationProvider = 'bitrix' | 'meta' | 'tiktok' | 'n8n';

export interface CredentialSecrets {
  FRONTEND_ADMIN_KEY?: string;
  INTEGRATION_ENCRYPTION_KEY?: string;
  SYNC_API_KEY?: string;
  N8N_WEBHOOK_SECRET?: string;
  BITRIX_WEBHOOK_BASE_URL?: string;
  BITRIX_OUTBOUND_TOKEN?: string;
  BITRIX_ENTITY_TYPE_ID?: string;
  BITRIX_TARGET_STAGE_IDS?: string;
  BITRIX_ARRIVED_STAGE_IDS?: string;
  BITRIX_SALE_STAGE_IDS?: string;
  META_ACCESS_TOKEN?: string;
  META_AD_ACCOUNT_IDS?: string;
  META_GRAPH_VERSION?: string;
  META_WEBHOOK_VERIFY_TOKEN?: string;
  META_APP_SECRET?: string;
  TIKTOK_ACCESS_TOKEN?: string;
  TIKTOK_ADVERTISER_IDS?: string;
  TIKTOK_API_BASE?: string;
  TIKTOK_WEBHOOK_SECRET?: string;
}

interface BaseEnv extends CredentialSecrets {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  DEFAULT_COMPANY_ID?: string;
}

interface CredentialRow {
  id?: string;
  company_id: string;
  user_id?: string | null;
  provider: IntegrationProvider;
  encrypted_payload: string;
  iv: string;
  config_summary: JsonRecord;
  status: string;
  last_error?: string | null;
  last_verified_at?: string | null;
  updated_at: string;
}

const providerFields: Record<IntegrationProvider, { required: string[]; secrets: string[]; mapping: Record<string, keyof CredentialSecrets> }> = {
  bitrix: {
    required: ['webhookBaseUrl'],
    secrets: ['outboundToken'],
    mapping: {
      webhookBaseUrl: 'BITRIX_WEBHOOK_BASE_URL',
      outboundToken: 'BITRIX_OUTBOUND_TOKEN',
      entityTypeId: 'BITRIX_ENTITY_TYPE_ID',
      targetStageIds: 'BITRIX_TARGET_STAGE_IDS',
      arrivedStageIds: 'BITRIX_ARRIVED_STAGE_IDS',
      saleStageIds: 'BITRIX_SALE_STAGE_IDS',
    },
  },
  meta: {
    required: ['accessToken', 'adAccountIds', 'graphVersion'],
    secrets: ['accessToken', 'webhookVerifyToken', 'appSecret'],
    mapping: {
      accessToken: 'META_ACCESS_TOKEN',
      adAccountIds: 'META_AD_ACCOUNT_IDS',
      graphVersion: 'META_GRAPH_VERSION',
      webhookVerifyToken: 'META_WEBHOOK_VERIFY_TOKEN',
      appSecret: 'META_APP_SECRET',
    },
  },
  tiktok: {
    required: ['accessToken', 'advertiserIds'],
    secrets: ['accessToken', 'webhookSecret'],
    mapping: {
      accessToken: 'TIKTOK_ACCESS_TOKEN',
      advertiserIds: 'TIKTOK_ADVERTISER_IDS',
      apiBase: 'TIKTOK_API_BASE',
      webhookSecret: 'TIKTOK_WEBHOOK_SECRET',
    },
  },
  n8n: {
    required: ['webhookSecret'],
    secrets: ['webhookSecret'],
    mapping: { webhookSecret: 'N8N_WEBHOOK_SECRET' },
  },
};

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});

const asRecord = (value: unknown): JsonRecord => value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {};
const asString = (value: unknown): string => typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim();

function secureEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let result = 0;
  for (let index = 0; index < left.length; index += 1) result |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return result === 0;
}

function bearer(request: Request): string {
  const value = request.headers.get('authorization') || '';
  return value.toLowerCase().startsWith('bearer ') ? value.slice(7).trim() : '';
}

export function isFrontendAdmin(request: Request, env: CredentialSecrets): boolean {
  if (request.headers.get('x-amanat-auth-role') === 'administrator') return true;
  const supplied = bearer(request) || request.headers.get('x-admin-key') || '';
  return Boolean(env.FRONTEND_ADMIN_KEY && supplied && secureEqual(supplied, env.FRONTEND_ADMIN_KEY));
}

function encryptionSecret(env: BaseEnv): string {
  const explicit = asString(env.INTEGRATION_ENCRYPTION_KEY);
  if (explicit) return explicit;
  const serviceRole = asString(env.SUPABASE_SERVICE_ROLE_KEY);
  if (!serviceRole) throw new Error('SUPABASE_SERVICE_ROLE_KEY не настроен в Cloudflare');
  return `amanat-integrations:v1:${serviceRole}`;
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

async function encryptionKey(secret: string): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret));
  return crypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

async function encryptPayload(payload: JsonRecord, secret: string): Promise<{ encryptedPayload: string; iv: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await encryptionKey(secret);
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(payload)));
  return { encryptedPayload: bytesToBase64(new Uint8Array(encrypted)), iv: bytesToBase64(iv) };
}

async function decryptPayload(row: CredentialRow, secret: string): Promise<JsonRecord> {
  const key = await encryptionKey(secret);
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: base64ToBytes(row.iv) }, key, base64ToBytes(row.encrypted_payload));
  return asRecord(JSON.parse(new TextDecoder().decode(decrypted)));
}

async function supabase<T>(env: BaseEnv, path: string, init: RequestInit = {}): Promise<T> {
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
  if (!response.ok) throw new Error(`Integration credentials: ${response.status} ${body}`);
  return (body ? JSON.parse(body) : null) as T;
}

async function listRows(env: BaseEnv, companyId: string): Promise<CredentialRow[]> {
  try {
    return await supabase<CredentialRow[]>(env, `integration_credentials?company_id=eq.${encodeURIComponent(companyId)}&user_id=is.null&select=*&order=provider.asc`);
  } catch (error) {
    console.error(error);
    return [];
  }
}

async function findRow(env: BaseEnv, companyId: string, provider: IntegrationProvider): Promise<CredentialRow | null> {
  const rows = await supabase<CredentialRow[]>(env, `integration_credentials?company_id=eq.${encodeURIComponent(companyId)}&user_id=is.null&provider=eq.${encodeURIComponent(provider)}&select=*&limit=1`);
  return rows[0] || null;
}

function publicSummary(row: CredentialRow) {
  const summary = asRecord(row.config_summary);
  return {
    provider: row.provider,
    configured: true,
    status: row.status,
    values: asRecord(summary.values),
    secretFields: asRecord(summary.secretFields),
    updatedAt: row.updated_at,
    lastVerifiedAt: row.last_verified_at || null,
    lastError: row.last_error || null,
  };
}

function buildSummary(provider: IntegrationProvider, payload: JsonRecord) {
  const definition = providerFields[provider];
  const values: Record<string, string> = {};
  const secretFields: Record<string, boolean> = {};
  for (const field of Object.keys(definition.mapping)) {
    const value = asString(payload[field]);
    if (definition.secrets.includes(field)) secretFields[field] = Boolean(value);
    else values[field] = value;
  }
  return { values, secretFields };
}

function validate(provider: IntegrationProvider, payload: JsonRecord): string[] {
  return providerFields[provider].required.filter((field) => !asString(payload[field]));
}

async function mergeWithStoredPayload(
  env: BaseEnv,
  companyId: string,
  provider: IntegrationProvider,
  incoming: JsonRecord,
  secret: string,
): Promise<JsonRecord> {
  const existing = await findRow(env, companyId, provider);
  if (!existing) return incoming;
  let stored: JsonRecord = {};
  try {
    stored = await decryptPayload(existing, secret);
  } catch (error) {
    console.error(`Unable to decrypt existing ${provider} credentials`, error);
  }
  const merged: JsonRecord = { ...stored };
  for (const [key, value] of Object.entries(incoming)) {
    const current = asString(value);
    if (current) merged[key] = current;
    else if (!providerFields[provider].secrets.includes(key)) merged[key] = value;
  }
  return merged;
}

export async function hydrateIntegrationEnv<T extends BaseEnv>(env: T): Promise<T & CredentialSecrets> {
  const companyId = await resolveCompanyId(env);
  const secret = encryptionSecret(env);
  const result = { ...env } as T & CredentialSecrets;
  for (const row of await listRows(env, companyId)) {
    try {
      const definition = providerFields[row.provider];
      if (!definition) continue;
      const payload = await decryptPayload(row, secret);
      for (const [field, envName] of Object.entries(definition.mapping)) {
        const value = asString(payload[field]);
        if (value) result[envName] = value;
      }
    } catch (error) {
      console.error(`Unable to decrypt ${row.provider} credentials`, error);
    }
  }
  return result;
}

export async function handleCredentialRequest(request: Request, env: BaseEnv, url: URL): Promise<Response | null> {
  if (!url.pathname.startsWith('/api/integrations/config')) return null;
  if (!isFrontendAdmin(request, env)) return json({ error: 'Настройки интеграций доступны только администратору' }, 403);

  const companyId = await resolveCompanyId(env);
  const secret = encryptionSecret(env);
  const provider = url.pathname.split('/').pop() as IntegrationProvider;

  if (url.pathname === '/api/integrations/config' && request.method === 'GET') {
    return json({ providers: (await listRows(env, companyId)).map(publicSummary), encryptionMode: env.INTEGRATION_ENCRYPTION_KEY ? 'dedicated' : 'automatic' });
  }
  if (!providerFields[provider]) return json({ error: 'Неизвестная интеграция' }, 404);

  if (request.method === 'PUT') {
    const incoming = asRecord(await request.json());
    const existing = await findRow(env, companyId, provider);
    const payload = await mergeWithStoredPayload(env, companyId, provider, incoming, secret);
    const missing = validate(provider, payload);
    if (missing.length) return json({ error: `Заполните обязательные поля: ${missing.join(', ')}` }, 400);

    const encrypted = await encryptPayload(payload, secret);
    const summary = buildSummary(provider, payload);
    const storedPayload = {
      provider,
      company_id: companyId,
      user_id: null,
      encrypted_payload: encrypted.encryptedPayload,
      iv: encrypted.iv,
      config_summary: summary,
      status: 'configured',
      last_error: null,
      updated_at: new Date().toISOString(),
    };
    const rows = existing?.id
      ? await supabase<CredentialRow[]>(env, `integration_credentials?id=eq.${encodeURIComponent(existing.id)}&company_id=eq.${encodeURIComponent(companyId)}`, {
          method: 'PATCH',
          headers: { prefer: 'return=representation' },
          body: JSON.stringify(storedPayload),
        })
      : await supabase<CredentialRow[]>(env, 'integration_credentials', {
          method: 'POST',
          headers: { prefer: 'return=representation' },
          body: JSON.stringify(storedPayload),
        });
    return json({ ok: true, provider: publicSummary(rows[0]), encryptionMode: env.INTEGRATION_ENCRYPTION_KEY ? 'dedicated' : 'automatic' });
  }

  if (request.method === 'DELETE') {
    await supabase<unknown>(env, `integration_credentials?company_id=eq.${encodeURIComponent(companyId)}&user_id=is.null&provider=eq.${encodeURIComponent(provider)}`, {
      method: 'DELETE',
      headers: { prefer: 'return=minimal' },
    });
    return json({ ok: true, provider });
  }

  return json({ error: 'Method not allowed' }, 405);
}

export async function updateCredentialVerification(env: BaseEnv, provider: IntegrationProvider, ok: boolean, error?: unknown): Promise<void> {
  try {
    const companyId = await resolveCompanyId(env);
    await supabase<unknown>(env, `integration_credentials?company_id=eq.${encodeURIComponent(companyId)}&user_id=is.null&provider=eq.${encodeURIComponent(provider)}`, {
      method: 'PATCH',
      headers: { prefer: 'return=minimal' },
      body: JSON.stringify({
        status: ok ? 'connected' : 'error',
        last_verified_at: new Date().toISOString(),
        last_error: ok ? null : error instanceof Error ? error.message : String(error || 'Ошибка проверки'),
      }),
    });
  } catch (updateError) {
    console.error(updateError);
  }
}
