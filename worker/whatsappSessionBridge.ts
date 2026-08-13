import type { Env } from './integrations';

type Row = Record<string, unknown>;
export type WhatsAppSessionBridgeEnv = Env & { WHATSAPP_SESSION_BRIDGE_SECRET?: string };
const text = (value: unknown): string => typeof value === 'string' ? value.trim() : '';

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
}

function authorized(request: Request, env: WhatsAppSessionBridgeEnv): boolean {
  const expected = env.WHATSAPP_SESSION_BRIDGE_SECRET || '';
  const supplied = request.headers.get('x-imds-session-secret') || '';
  if (!expected || expected.length !== supplied.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i += 1) diff |= expected.charCodeAt(i) ^ supplied.charCodeAt(i);
  return diff === 0;
}

function headers(env: Env, extra: HeadersInit = {}): Headers {
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error('Supabase server key missing');
  const out = new Headers(extra);
  out.set('apikey', key);
  if (!key.startsWith('sb_secret_')) out.set('authorization', `Bearer ${key}`);
  return out;
}

async function db(env: Env, path: string, init: RequestInit): Promise<void> {
  const response = await fetch(`${env.SUPABASE_URL.replace(/\/+$/, '')}/rest/v1${path}`, { ...init, headers: headers(env, init.headers) });
  if (!response.ok) throw new Error(`WhatsApp session DB HTTP ${response.status}`);
}

function normalizePhone(value: string): string {
  let digits = value.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('8')) digits = `7${digits.slice(1)}`;
  return digits.length >= 10 && digits.length <= 15 ? `+${digits}` : '';
}

function base64Buffer(value: string): ArrayBuffer {
  const binary = atob(value.replace(/^data:[^;]+;base64,/, ''));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

async function ingestAvatar(request: Request, env: WhatsAppSessionBridgeEnv): Promise<Response> {
  const body = await request.json().catch(() => null) as Row | null;
  if (!body) return json({ error: 'Invalid JSON' }, 400);
  const companyId = text(body.companyId);
  const contactId = text(body.contactId);
  const mimeType = text(body.mimeType).toLowerCase();
  if (!/^[0-9a-f-]{36}$/i.test(companyId) || !/^[0-9a-f-]{36}$/i.test(contactId)) return json({ error: 'Invalid id' }, 400);
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(mimeType)) return json({ error: 'Unsupported mime type' }, 415);
  const file = base64Buffer(text(body.avatarBase64));
  if (!file.byteLength || file.byteLength > 5 * 1024 * 1024) return json({ error: 'Avatar too large' }, 413);
  const ext = mimeType === 'image/png' ? 'png' : mimeType === 'image/webp' ? 'webp' : 'jpg';
  const storagePath = `${companyId}/${contactId}/whatsapp_session.${ext}`;
  const upload = await fetch(`${env.SUPABASE_URL.replace(/\/+$/, '')}/storage/v1/object/contact-avatars/${storagePath.split('/').map(encodeURIComponent).join('/')}`, {
    method: 'POST', headers: headers(env, { 'content-type': mimeType, 'x-upsert': 'true' }), body: file,
  });
  if (!upload.ok) return json({ error: `Storage HTTP ${upload.status}` }, 502);
  const now = new Date().toISOString();
  await db(env, '/crm_contact_avatars?on_conflict=company_id,contact_id,source', {
    method: 'POST',
    headers: { 'content-type': 'application/json', prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ company_id: companyId, contact_id: contactId, source: 'whatsapp_session', storage_path: storagePath, external_url: null, priority: 1000, is_active: true, fetched_at: now, metadata: { provider: 'baileys', mimeType }, updated_at: now }),
  });
  return json({ ok: true, source: 'whatsapp_session' }, 201);
}

async function updateStatus(request: Request, env: WhatsAppSessionBridgeEnv): Promise<Response> {
  const body = await request.json().catch(() => null) as Row | null;
  if (!body) return json({ error: 'Invalid JSON' }, 400);
  const companyId = text(body.companyId);
  const status = text(body.status).toUpperCase();
  if (!/^[0-9a-f-]{36}$/i.test(companyId)) return json({ error: 'Invalid companyId' }, 400);
  if (!['DISCONNECTED','CONNECTING','PAIRING','CONNECTED','ERROR','LOGGED_OUT'].includes(status)) return json({ error: 'Invalid status' }, 400);
  const now = new Date().toISOString();
  await db(env, '/whatsapp_session_connections?on_conflict=company_id', {
    method: 'POST',
    headers: { 'content-type': 'application/json', prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ company_id: companyId, provider: 'baileys', status, phone_e164: normalizePhone(text(body.phone)) || null, linked_jid: text(body.linkedJid) || null, display_name: text(body.displayName) || null, last_connected_at: status === 'CONNECTED' ? now : null, last_error: text(body.error) || null, updated_at: now }),
  });
  return json({ ok: true, status });
}

export async function handleWhatsAppSessionBridge(request: Request, env: WhatsAppSessionBridgeEnv, url: URL): Promise<Response | null> {
  if (!url.pathname.startsWith('/api/internal/whatsapp-session/')) return null;
  if (!authorized(request, env)) return json({ error: 'Unauthorized' }, 401);
  try {
    if (url.pathname === '/api/internal/whatsapp-session/avatar' && request.method === 'POST') return await ingestAvatar(request, env);
    if (url.pathname === '/api/internal/whatsapp-session/status' && request.method === 'POST') return await updateStatus(request, env);
    return json({ error: 'Not found' }, 404);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
}
