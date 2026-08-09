import { resolveCompanyId } from './companyContext';
import { handleClinicFlowExchange, handleWabaClinicFlowAdminRequest, type WabaClinicFlowEnv } from './wabaClinicFlowAdmin';

type Row = Record<string, unknown>;

type FlowKeyEnvelope = {
  ciphertext: string;
  iv: string;
  publicKeyPem: string;
  phoneNumberId: string;
  uploadedAt: string;
  signatureStatus?: string;
};

type WabaCredential = {
  rowId: string;
  companyId: string;
  accessToken: string;
  wabaId: string;
  phoneNumberId: string;
  graphVersion: string;
  configSummary: Row;
};

export interface WabaFlowsEnv extends WabaClinicFlowEnv {
  META_APP_SECRET?: string;
}

const text = (value: unknown): string => typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim();
const record = (value: unknown): Row => value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {};
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});

function graphVersion(value?: string): string {
  const version = text(value) || 'v23.0';
  return version.startsWith('v') ? version : `v${version}`;
}

function encryptionSecret(env: WabaFlowsEnv): string {
  return text(env.INTEGRATION_ENCRYPTION_KEY) || `imds-integrations:v1:${env.SUPABASE_SERVICE_ROLE_KEY}`;
}

function authHeaders(env: WabaFlowsEnv, extra: HeadersInit = {}): Headers {
  const headers = new Headers(extra);
  headers.set('apikey', env.SUPABASE_SERVICE_ROLE_KEY);
  headers.set('authorization', `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`);
  headers.set('accept', 'application/json');
  return headers;
}

async function db<T>(env: WabaFlowsEnv, path: string, init: RequestInit = {}): Promise<T> {
  const headers = authHeaders(env, init.headers);
  if (init.body != null) headers.set('content-type', 'application/json');
  if (init.method && !['GET', 'HEAD'].includes(init.method) && !headers.has('prefer')) headers.set('prefer', 'return=representation');
  const response = await fetch(`${env.SUPABASE_URL.replace(/\/+$/, '')}/rest/v1/${path}`, { ...init, headers, cache: 'no-store' });
  const body = await response.text();
  if (!response.ok) throw new Error(`Supabase ${response.status}: ${body.slice(0, 1800)}`);
  return (body ? JSON.parse(body) : null) as T;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const buffer = new ArrayBuffer(binary.length);
  const bytes = new Uint8Array(buffer);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function pem(label: string, bytes: Uint8Array): string {
  const base64 = bytesToBase64(bytes);
  const lines = base64.match(/.{1,64}/g)?.join('\n') || base64;
  return `-----BEGIN ${label}-----\n${lines}\n-----END ${label}-----`;
}

async function secretKey(env: WabaFlowsEnv): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(encryptionSecret(env)));
  return crypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

async function encryptPrivateKey(env: WabaFlowsEnv, privateKeyBytes: Uint8Array): Promise<{ ciphertext: string; iv: string }> {
  const key = await secretKey(env);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, privateKeyBytes);
  return { ciphertext: bytesToBase64(new Uint8Array(encrypted)), iv: bytesToBase64(iv) };
}

async function decryptPrivateKey(env: WabaFlowsEnv, envelope: FlowKeyEnvelope): Promise<CryptoKey> {
  const key = await secretKey(env);
  const privateKeyBytes = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64ToBytes(envelope.iv) },
    key,
    base64ToBytes(envelope.ciphertext),
  );
  return crypto.subtle.importKey(
    'pkcs8',
    privateKeyBytes,
    { name: 'RSA-OAEP', hash: 'SHA-256' },
    false,
    ['decrypt'],
  );
}

async function decryptWabaCredential(env: WabaFlowsEnv, row: Row): Promise<WabaCredential | null> {
  const encrypted = text(row.encrypted_payload);
  const iv = text(row.iv);
  if (!encrypted || !iv) return null;
  const key = await secretKey(env);
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: base64ToBytes(iv) }, key, base64ToBytes(encrypted));
  const payload = record(JSON.parse(new TextDecoder().decode(decrypted)));
  const accessToken = text(payload.accessToken);
  const wabaId = text(payload.wabaId);
  const phoneNumberId = text(payload.phoneNumberId);
  if (!accessToken || !wabaId || !phoneNumberId) return null;
  return {
    rowId: text(row.id),
    companyId: text(row.company_id),
    accessToken,
    wabaId,
    phoneNumberId,
    graphVersion: graphVersion(text(payload.graphVersion) || env.META_GRAPH_VERSION),
    configSummary: record(row.config_summary),
  };
}

async function connectedCredential(env: WabaFlowsEnv, companyId: string): Promise<WabaCredential> {
  const rows = await db<Row[]>(env,
    `integration_credentials?provider=eq.waba&status=eq.connected&company_id=eq.${encodeURIComponent(companyId)}&select=id,company_id,encrypted_payload,iv,config_summary&order=updated_at.desc&limit=20`,
  );
  for (const row of rows) {
    try {
      const credential = await decryptWabaCredential(env, row);
      if (credential) return credential;
    } catch (error) {
      console.error('Unable to decrypt WABA credential for Flows', error);
    }
  }
  throw new Error('Подключённая WABA для WhatsApp Flows не найдена');
}

function flowEnvelope(summary: Row): FlowKeyEnvelope | null {
  const flows = record(summary.flows);
  const encryption = record(flows.encryption);
  const ciphertext = text(encryption.ciphertext);
  const iv = text(encryption.iv);
  const publicKeyPem = text(encryption.publicKeyPem);
  const phoneNumberId = text(encryption.phoneNumberId);
  const uploadedAt = text(encryption.uploadedAt);
  if (!ciphertext || !iv || !publicKeyPem || !phoneNumberId) return null;
  return {
    ciphertext,
    iv,
    publicKeyPem,
    phoneNumberId,
    uploadedAt,
    signatureStatus: text(encryption.signatureStatus) || undefined,
  };
}

async function uploadPublicKey(credential: WabaCredential, publicKeyPem: string): Promise<Row> {
  const body = new FormData();
  body.set('business_public_key', publicKeyPem);
  const response = await fetch(
    `https://graph.facebook.com/${credential.graphVersion}/${encodeURIComponent(credential.phoneNumberId)}/whatsapp_business_encryption`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${credential.accessToken}`,
        accept: 'application/json',
      },
      body,
    },
  );
  const raw = await response.text();
  let payload: Row = {};
  try { payload = record(raw ? JSON.parse(raw) : {}); } catch { payload = { raw }; }
  if (!response.ok || payload.error) throw new Error(`Meta public key upload ${response.status}: ${JSON.stringify(payload).slice(0, 1400)}`);
  return payload;
}

async function readPublicKeyStatus(credential: WabaCredential): Promise<string> {
  try {
    const response = await fetch(
      `https://graph.facebook.com/${credential.graphVersion}/${encodeURIComponent(credential.phoneNumberId)}/whatsapp_business_encryption`,
      { headers: { authorization: `Bearer ${credential.accessToken}`, accept: 'application/json' } },
    );
    const raw = await response.text();
    const payload = record(raw ? JSON.parse(raw) : {});
    if (!response.ok || payload.error) return '';
    const direct = text(payload.business_public_key_signature_status);
    if (direct) return direct;
    const first = Array.isArray(payload.data) ? record(payload.data[0]) : {};
    return text(first.business_public_key_signature_status);
  } catch {
    return '';
  }
}

async function saveFlowEnvelope(env: WabaFlowsEnv, credential: WabaCredential, envelope: FlowKeyEnvelope, endpointUrl: string): Promise<void> {
  const nextSummary: Row = {
    ...credential.configSummary,
    flows: {
      ...record(credential.configSummary.flows),
      enabled: true,
      endpointUrl,
      encryption: envelope,
      updatedAt: new Date().toISOString(),
    },
  };
  await db<Row[]>(env, `integration_credentials?id=eq.${encodeURIComponent(credential.rowId)}&select=id`, {
    method: 'PATCH',
    body: JSON.stringify({ config_summary: nextSummary, updated_at: new Date().toISOString() }),
  });
}

async function setupFlows(request: Request, env: WabaFlowsEnv): Promise<Response> {
  const companyId = await resolveCompanyId(env);
  const credential = await connectedCredential(env, companyId);
  const input = record(await request.clone().json().catch(() => ({})));
  const rotate = input.rotate === true;
  const existing = flowEnvelope(credential.configSummary);
  const endpointUrl = `${new URL(request.url).origin}/api/webhooks/waba/flows`;

  if (existing && !rotate) {
    await uploadPublicKey(credential, existing.publicKeyPem);
    const signatureStatus = await readPublicKeyStatus(credential);
    const refreshed: FlowKeyEnvelope = {
      ...existing,
      phoneNumberId: credential.phoneNumberId,
      uploadedAt: new Date().toISOString(),
      signatureStatus: signatureStatus || existing.signatureStatus,
    };
    await saveFlowEnvelope(env, credential, refreshed, endpointUrl);
    return json({
      ok: true,
      configured: true,
      reused: true,
      endpointUrl,
      phoneNumberId: credential.phoneNumberId,
      publicKeyUploaded: true,
      signatureStatus: signatureStatus || existing.signatureStatus || 'UNKNOWN',
    });
  }

  const keyPair = await crypto.subtle.generateKey(
    {
      name: 'RSA-OAEP',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['encrypt', 'decrypt'],
  ) as CryptoKeyPair;
  const privateBytes = new Uint8Array(await crypto.subtle.exportKey('pkcs8', keyPair.privateKey));
  const publicBytes = new Uint8Array(await crypto.subtle.exportKey('spki', keyPair.publicKey));
  const publicKeyPem = pem('PUBLIC KEY', publicBytes);
  const encryptedPrivateKey = await encryptPrivateKey(env, privateBytes);

  await uploadPublicKey(credential, publicKeyPem);
  const signatureStatus = await readPublicKeyStatus(credential);
  const envelope: FlowKeyEnvelope = {
    ...encryptedPrivateKey,
    publicKeyPem,
    phoneNumberId: credential.phoneNumberId,
    uploadedAt: new Date().toISOString(),
    signatureStatus: signatureStatus || undefined,
  };
  await saveFlowEnvelope(env, credential, envelope, endpointUrl);

  return json({
    ok: true,
    configured: true,
    rotated: rotate,
    endpointUrl,
    phoneNumberId: credential.phoneNumberId,
    publicKeyUploaded: true,
    signatureStatus: signatureStatus || 'UNKNOWN',
  });
}

async function flowsConfig(request: Request, env: WabaFlowsEnv): Promise<Response> {
  const companyId = await resolveCompanyId(env);
  const credential = await connectedCredential(env, companyId);
  const envelope = flowEnvelope(credential.configSummary);
  const flows = record(credential.configSummary.flows);
  return json({
    configured: Boolean(envelope),
    endpointUrl: text(flows.endpointUrl) || `${new URL(request.url).origin}/api/webhooks/waba/flows`,
    phoneNumberId: credential.phoneNumberId,
    publicKeyUploaded: Boolean(envelope),
    signatureStatus: envelope?.signatureStatus || null,
    uploadedAt: envelope?.uploadedAt || null,
  });
}

function secureEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let result = 0;
  for (let index = 0; index < left.length; index += 1) result |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return result === 0;
}

async function validSignature(request: Request, env: WabaFlowsEnv, rawBody: string): Promise<boolean> {
  const secret = text(env.META_APP_SECRET);
  if (!secret) return false;
  const signature = text(request.headers.get('x-hub-signature-256'));
  if (!signature.startsWith('sha256=')) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const digest = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody));
  const expected = `sha256=${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
  return secureEqual(signature, expected);
}

async function configuredFlowKeys(env: WabaFlowsEnv): Promise<Array<{ companyId: string; envelope: FlowKeyEnvelope }>> {
  const rows = await db<Row[]>(env,
    'integration_credentials?provider=eq.waba&status=eq.connected&select=company_id,config_summary&order=updated_at.desc&limit=100',
  );
  return rows.map((row) => ({ companyId: text(row.company_id), envelope: flowEnvelope(record(row.config_summary)) }))
    .filter((item): item is { companyId: string; envelope: FlowKeyEnvelope } => Boolean(item.companyId && item.envelope));
}

async function decryptFlowPayload(env: WabaFlowsEnv, payload: Row, envelope: FlowKeyEnvelope): Promise<{ body: Row; aesKey: CryptoKey; iv: Uint8Array<ArrayBuffer> }> {
  const encryptedAesKey = text(payload.encrypted_aes_key);
  const encryptedFlowData = text(payload.encrypted_flow_data);
  const initialVector = text(payload.initial_vector);
  if (!encryptedAesKey || !encryptedFlowData || !initialVector) throw new Error('Missing WhatsApp Flow encryption fields');

  const privateKey = await decryptPrivateKey(env, envelope);
  const aesKeyBytes = await crypto.subtle.decrypt({ name: 'RSA-OAEP' }, privateKey, base64ToBytes(encryptedAesKey));
  const aesKey = await crypto.subtle.importKey('raw', aesKeyBytes, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
  const iv = base64ToBytes(initialVector);
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv, tagLength: 128 },
    aesKey,
    base64ToBytes(encryptedFlowData),
  );
  const body = record(JSON.parse(new TextDecoder().decode(decrypted)));
  return { body, aesKey, iv };
}

async function encryptFlowResponse(response: Row, aesKey: CryptoKey, iv: Uint8Array<ArrayBuffer>): Promise<string> {
  const flippedIv = new Uint8Array(new ArrayBuffer(iv.length));
  for (let index = 0; index < iv.length; index += 1) flippedIv[index] = (~iv[index]) & 0xff;
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: flippedIv, tagLength: 128 },
    aesKey,
    new TextEncoder().encode(JSON.stringify(response)),
  );
  return bytesToBase64(new Uint8Array(encrypted));
}

async function flowResponse(env: WabaFlowsEnv, companyId: string, body: Row): Promise<Row> {
  const action = text(body.action).toLowerCase();
  if (action === 'ping') return { data: { status: 'active' } };

  const clinicResponse = await handleClinicFlowExchange(env, companyId, body);
  if (clinicResponse) return clinicResponse;

  const screen = text(body.screen);
  const data = record(body.data);
  if (screen) return { screen, data };
  return { data: { status: 'active' } };
}

async function handleFlowWebhook(request: Request, env: WabaFlowsEnv): Promise<Response> {
  const rawBody = await request.text();
  if (!await validSignature(request, env, rawBody)) return new Response('', { status: 432 });

  let payload: Row;
  try { payload = record(JSON.parse(rawBody || '{}')); } catch { return json({ error: 'Invalid JSON' }, 400); }
  const keys = await configuredFlowKeys(env);
  if (!keys.length) return json({ error: 'WhatsApp Flows encryption key is not configured' }, 503);

  for (const item of keys) {
    try {
      const decrypted = await decryptFlowPayload(env, payload, item.envelope);
      const response = await flowResponse(env, item.companyId, decrypted.body);
      const encrypted = await encryptFlowResponse(response, decrypted.aesKey, decrypted.iv);
      return new Response(encrypted, { status: 200, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } });
    } catch (error) {
      console.error('WhatsApp Flow key candidate failed', error);
    }
  }

  return new Response('', { status: 421 });
}

export async function handleWabaFlowsRequest(request: Request, env: WabaFlowsEnv, url: URL): Promise<Response | null> {
  const clinicAdmin = await handleWabaClinicFlowAdminRequest(request, env, url);
  if (clinicAdmin) return clinicAdmin;

  if (url.pathname === '/api/webhooks/waba/flows' && request.method === 'POST') {
    return handleFlowWebhook(request, env);
  }
  if (url.pathname === '/api/integrations/waba/flows/config' && request.method === 'GET') {
    return flowsConfig(request, env);
  }
  if (url.pathname === '/api/integrations/waba/flows/setup' && request.method === 'POST') {
    try {
      return await setupFlows(request, env);
    } catch (error) {
      console.error('WhatsApp Flows setup failed', error);
      return json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  }
  return null;
}
