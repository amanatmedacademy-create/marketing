import type { Env } from './integrations';
import { requireCompanyId, type TenantScopedEnv } from './tenantScope';

type Row = Record<string, unknown>;
type ScopedEnv = Env & TenantScopedEnv;

const BUCKET = 'contact-avatars';
const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp']);

const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';
const isUuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const tenantId = (env: Env) => requireCompanyId(env as ScopedEnv);

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
}

function headers(env: Env, extra: HeadersInit = {}): Headers {
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error('Supabase server key is missing');
  const result = new Headers(extra);
  result.set('apikey', key);
  if (!key.startsWith('sb_secret_')) result.set('authorization', `Bearer ${key}`);
  return result;
}

async function db<T>(env: Env, path: string, init: RequestInit = {}): Promise<T> {
  const requestHeaders = headers(env, init.headers);
  requestHeaders.set('accept', 'application/json');
  if (init.body != null && !requestHeaders.has('content-type')) requestHeaders.set('content-type', 'application/json');
  const response = await fetch(`${env.SUPABASE_URL.replace(/\/+$/, '')}/rest/v1${path}`, { ...init, headers: requestHeaders, cache: 'no-store' });
  const raw = await response.text();
  if (!response.ok) throw new Error(`Contact avatar database ${response.status}: ${raw.slice(0, 600)}`);
  return (raw ? JSON.parse(raw) : null) as T;
}

function normalizePhone(value: string): string {
  let digits = value.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('8')) digits = `7${digits.slice(1)}`;
  return digits.length >= 10 && digits.length <= 15 ? `+${digits}` : '';
}

function decodeBase64(value: string): Uint8Array {
  const clean = value.replace(/^data:[^;]+;base64,/, '');
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function extension(mime: string): string {
  return mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg';
}

async function findContact(env: Env, contactId: string, phone: string): Promise<Row | null> {
  const companyId = tenantId(env);
  if (contactId && isUuid(contactId)) {
    const rows = await db<Row[]>(env, `/crm_contacts?company_id=eq.${encodeURIComponent(companyId)}&id=eq.${encodeURIComponent(contactId)}&archived_at=is.null&select=id,display_name,phone,normalized_phone&limit=1`);
    if (rows[0]) return rows[0];
  }
  const normalized = normalizePhone(phone);
  if (!normalized) return null;
  const rows = await db<Row[]>(env, `/crm_contacts?company_id=eq.${encodeURIComponent(companyId)}&normalized_phone=eq.${encodeURIComponent(normalized)}&archived_at=is.null&select=id,display_name,phone,normalized_phone&order=last_seen_at.desc.nullslast&limit=1`);
  return rows[0] || null;
}

async function ensureContact(env: Env, contactId: string, phone: string, displayName: string): Promise<Row> {
  const found = await findContact(env, contactId, phone);
  if (found) return found;
  const normalized = normalizePhone(phone);
  if (!normalized) throw new Error('Для фото нужен телефон контакта');
  const now = new Date().toISOString();
  const rows = await db<Row[]>(env, '/crm_contacts', {
    method: 'POST', headers: { prefer: 'return=representation' },
    body: JSON.stringify({ company_id: tenantId(env), display_name: displayName || normalized, phone: phone || normalized, normalized_phone: normalized, source_hint: 'messaging', first_seen_at: now, last_seen_at: now, updated_at: now }),
  });
  if (!rows[0]) throw new Error('Не удалось создать CRM Contact');
  return rows[0];
}

async function bestAvatar(env: Env, contactId: string): Promise<Row | null> {
  const rows = await db<Row[]>(env, `/crm_contact_avatars?company_id=eq.${encodeURIComponent(tenantId(env))}&contact_id=eq.${encodeURIComponent(contactId)}&is_active=eq.true&storage_path=not.is.null&select=id,source,storage_path,priority,updated_at&order=priority.desc,updated_at.desc&limit=1`);
  return rows[0] || null;
}

function dto(row: Row | null) {
  if (!row) return null;
  const id = text(row.id); const updatedAt = text(row.updated_at);
  return { id, source: text(row.source), url: `/api/contact-avatars/file/${encodeURIComponent(id)}${updatedAt ? `?v=${encodeURIComponent(updatedAt)}` : ''}`, updatedAt: updatedAt || undefined };
}

async function resolveAvatar(env: Env, url: URL): Promise<Response> {
  const contact = await findContact(env, text(url.searchParams.get('contactId')), text(url.searchParams.get('phone')));
  if (!contact) return json({ contactId: null, avatar: null });
  const contactId = text(contact.id);
  return json({ contactId, avatar: dto(await bestAvatar(env, contactId)) });
}

async function serveAvatar(env: Env, avatarId: string): Promise<Response> {
  if (!isUuid(avatarId)) return json({ error: 'Некорректный avatar id' }, 400);
  const rows = await db<Row[]>(env, `/crm_contact_avatars?company_id=eq.${encodeURIComponent(tenantId(env))}&id=eq.${encodeURIComponent(avatarId)}&is_active=eq.true&storage_path=not.is.null&select=storage_path&limit=1`);
  const path = text(rows[0]?.storage_path);
  if (!path) return json({ error: 'Фото не найдено' }, 404);
  const response = await fetch(`${env.SUPABASE_URL.replace(/\/+$/, '')}/storage/v1/object/${BUCKET}/${path.split('/').map(encodeURIComponent).join('/')}`, { headers: headers(env) });
  if (!response.ok) return json({ error: 'Файл фото недоступен' }, response.status === 404 ? 404 : 502);
  return new Response(response.body, { status: 200, headers: { 'content-type': response.headers.get('content-type') || 'application/octet-stream', 'cache-control': 'private, max-age=300', 'x-content-type-options': 'nosniff' } });
}

async function uploadAvatar(request: Request, env: Env): Promise<Response> {
  const input = await request.json().catch(() => null) as Row | null;
  if (!input) return json({ error: 'Некорректный запрос' }, 400);
  const mime = text(input.mimeType).toLowerCase();
  if (!ALLOWED.has(mime)) return json({ error: 'Разрешены JPEG, PNG и WebP' }, 415);
  let bytes: Uint8Array;
  try { bytes = decodeBase64(text(input.base64)); } catch { return json({ error: 'Некорректный файл' }, 400); }
  if (!bytes.byteLength || bytes.byteLength > MAX_BYTES) return json({ error: 'Максимальный размер фото — 5 МБ' }, 413);
  const contact = await ensureContact(env, text(input.contactId), text(input.phone), text(input.displayName));
  const contactId = text(contact.id); const companyId = tenantId(env);
  const storagePath = `${companyId}/${contactId}/crm_manual.${extension(mime)}`;
  const upload = await fetch(`${env.SUPABASE_URL.replace(/\/+$/, '')}/storage/v1/object/${BUCKET}/${storagePath.split('/').map(encodeURIComponent).join('/')}`, { method: 'POST', headers: headers(env, { 'content-type': mime, 'x-upsert': 'true' }), body: bytes });
  if (!upload.ok) return json({ error: `Не удалось сохранить фото: HTTP ${upload.status}` }, 502);
  const now = new Date().toISOString();
  const rows = await db<Row[]>(env, '/crm_contact_avatars?on_conflict=company_id,contact_id,source', { method: 'POST', headers: { prefer: 'resolution=merge-duplicates,return=representation' }, body: JSON.stringify({ company_id: companyId, contact_id: contactId, source: 'crm_manual', storage_path: storagePath, external_url: null, priority: 900, is_active: true, fetched_at: now, expires_at: null, metadata: { mimeType: mime, uploadedFrom: 'imds_messaging' }, updated_at: now }) });
  return json({ contactId, avatar: dto(rows[0] || await bestAvatar(env, contactId)) }, 201);
}

export async function handleContactAvatars(request: Request, env: Env, url: URL): Promise<Response | null> {
  try {
    if (url.pathname === '/api/contact-avatars/resolve' && request.method === 'GET') return await resolveAvatar(env, url);
    const file = request.method === 'GET' ? url.pathname.match(/^\/api\/contact-avatars\/file\/([0-9a-f-]+)$/i) : null;
    if (file) return await serveAvatar(env, file[1]);
    if (url.pathname === '/api/contact-avatars/upload' && request.method === 'POST') return await uploadAvatar(request, env);
    return null;
  } catch (error) { return json({ error: error instanceof Error ? error.message : String(error) }, 500); }
}
