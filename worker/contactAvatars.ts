import type { Env } from './integrations';
import { requireCompanyId, type TenantScopedEnv } from './tenantScope';

type Row = Record<string, unknown>;
type ScopedEnv = Env & TenantScopedEnv;

const BUCKET = 'contact-avatars';
const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';
const isUuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const tenantId = (env: Env) => requireCompanyId(env as ScopedEnv);

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
}

function headers(env: Env): Headers {
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error('Supabase server key is missing');
  const result = new Headers({ apikey: key });
  if (!key.startsWith('sb_secret_')) result.set('authorization', `Bearer ${key}`);
  return result;
}

async function db<T>(env: Env, path: string): Promise<T> {
  const response = await fetch(`${env.SUPABASE_URL.replace(/\/+$/, '')}/rest/v1${path}`, { headers: headers(env), cache: 'no-store' });
  const raw = await response.text();
  if (!response.ok) throw new Error(`Contact avatar database ${response.status}: ${raw.slice(0, 600)}`);
  return (raw ? JSON.parse(raw) : null) as T;
}

function normalizePhone(value: string): string {
  let digits = value.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('8')) digits = `7${digits.slice(1)}`;
  return digits.length >= 10 && digits.length <= 15 ? `+${digits}` : '';
}

async function findContact(env: Env, contactId: string, phone: string): Promise<Row | null> {
  const companyId = tenantId(env);
  if (contactId && isUuid(contactId)) {
    const rows = await db<Row[]>(env, `/crm_contacts?company_id=eq.${encodeURIComponent(companyId)}&id=eq.${encodeURIComponent(contactId)}&archived_at=is.null&select=id&limit=1`);
    if (rows[0]) return rows[0];
  }
  const normalized = normalizePhone(phone);
  if (!normalized) return null;
  const rows = await db<Row[]>(env, `/crm_contacts?company_id=eq.${encodeURIComponent(companyId)}&normalized_phone=eq.${encodeURIComponent(normalized)}&archived_at=is.null&select=id&order=last_seen_at.desc.nullslast&limit=1`);
  return rows[0] || null;
}

async function bestAvatar(env: Env, contactId: string): Promise<Row | null> {
  const rows = await db<Row[]>(env, `/crm_contact_avatars?company_id=eq.${encodeURIComponent(tenantId(env))}&contact_id=eq.${encodeURIComponent(contactId)}&is_active=eq.true&storage_path=not.is.null&select=id,source,updated_at&order=priority.desc,updated_at.desc&limit=1`);
  return rows[0] || null;
}

async function resolveAvatar(env: Env, url: URL): Promise<Response> {
  const contact = await findContact(env, text(url.searchParams.get('contactId')), text(url.searchParams.get('phone')));
  if (!contact) return json({ contactId: null, avatar: null });
  const contactId = text(contact.id);
  const avatar = await bestAvatar(env, contactId);
  if (!avatar) return json({ contactId, avatar: null });
  const id = text(avatar.id);
  const updatedAt = text(avatar.updated_at);
  return json({ contactId, avatar: { id, source: text(avatar.source), url: `/api/contact-avatars/file/${encodeURIComponent(id)}${updatedAt ? `?v=${encodeURIComponent(updatedAt)}` : ''}`, updatedAt: updatedAt || undefined } });
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

export async function handleContactAvatars(request: Request, env: Env, url: URL): Promise<Response | null> {
  try {
    if (url.pathname === '/api/contact-avatars/resolve' && request.method === 'GET') return await resolveAvatar(env, url);
    const match = request.method === 'GET' ? url.pathname.match(/^\/api\/contact-avatars\/file\/([0-9a-f-]+)$/i) : null;
    if (match) return await serveAvatar(env, match[1]);
    return null;
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
}
