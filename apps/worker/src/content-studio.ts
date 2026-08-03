import type { AuthEnv, AuthSession } from './auth';

type Env = AuthEnv & { SUPABASE_SERVICE_ROLE_KEY?: string };

type ContentTypeRow = {
  id: string;
  api_id: string;
  display_name: string;
  description: string | null;
  fields: Array<{ name: string; label: string; type: string; required?: boolean }>;
  icon: string;
  draft_and_publish: boolean;
  localized: boolean;
  created_at: string;
  updated_at: string;
};

type EntryRow = {
  id: string;
  content_type_id: string;
  document_id: string;
  locale: string;
  status: 'draft' | 'published' | 'archived';
  title: string;
  slug: string;
  data: Record<string, unknown>;
  published_at: string | null;
  created_at: string;
  updated_at: string;
};

type MediaRow = {
  id: string;
  name: string;
  url: string;
  mime_type: string | null;
  size_bytes: number | null;
  alt_text: Record<string, string>;
  folder: string;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});

function assertEnv(env: Env): asserts env is Env & { SUPABASE_SERVICE_ROLE_KEY: string } {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('Content Studio environment is not configured');
}

async function rest<T>(env: Env, path: string, init: RequestInit = {}): Promise<T> {
  assertEnv(env);
  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      'content-type': 'application/json',
      prefer: 'return=representation',
      ...init.headers,
    },
  });
  if (!response.ok) throw new Error(`Content Studio query failed: ${response.status} ${await response.text()}`);
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

function canManageSchema(session: AuthSession) {
  return ['owner', 'admin', 'administrator'].includes(session.role);
}

function canPublish(session: AuthSession) {
  return ['owner', 'admin', 'administrator', 'manager'].includes(session.role);
}

function slugify(value: string) {
  const slug = value.toLowerCase().normalize('NFKD').replace(/[^a-z0-9а-яё]+/gi, '-').replace(/^-|-$/g, '').slice(0, 100);
  return slug || crypto.randomUUID().slice(0, 8);
}

function normalizeFields(input: unknown) {
  if (!Array.isArray(input)) return [];
  const allowed = new Set(['string', 'text', 'richtext', 'number', 'boolean', 'date', 'datetime', 'media', 'json']);
  return input
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
    .map((item) => ({
      name: String(item.name ?? '').trim().replace(/[^a-zA-Z0-9_]/g, ''),
      label: String(item.label ?? item.name ?? '').trim(),
      type: allowed.has(String(item.type)) ? String(item.type) : 'string',
      required: Boolean(item.required),
    }))
    .filter((item) => item.name && item.label);
}

async function listTypes(env: Env, session: AuthSession) {
  return rest<ContentTypeRow[]>(env, `content_types?select=id,api_id,display_name,description,fields,icon,draft_and_publish,localized,created_at,updated_at&company_id=eq.${session.companyId}&order=display_name.asc`);
}

async function createType(request: Request, env: Env, session: AuthSession) {
  if (!canManageSchema(session)) return json({ error: { code: 'FORBIDDEN', message: 'Недостаточно прав для изменения структуры контента' } }, 403);
  const body = await request.json() as Partial<ContentTypeRow>;
  const apiId = slugify(body.api_id ?? body.display_name ?? '').replace(/-/g, '_');
  const displayName = body.display_name?.trim();
  if (!displayName || !apiId) return json({ error: { code: 'VALIDATION_ERROR', message: 'Название типа контента обязательно' } }, 400);
  const rows = await rest<ContentTypeRow[]>(env, 'content_types?select=id,api_id,display_name,description,fields,icon,draft_and_publish,localized,created_at,updated_at', {
    method: 'POST',
    body: JSON.stringify({
      company_id: session.companyId,
      api_id: apiId,
      display_name: displayName,
      description: body.description?.trim() || null,
      fields: normalizeFields(body.fields),
      icon: body.icon || 'file-text',
      draft_and_publish: body.draft_and_publish !== false,
      localized: body.localized !== false,
      created_by: session.user.id,
    }),
  });
  return json(rows[0], 201);
}

async function updateType(request: Request, env: Env, session: AuthSession, id: string) {
  if (!canManageSchema(session)) return json({ error: { code: 'FORBIDDEN', message: 'Недостаточно прав для изменения структуры контента' } }, 403);
  const body = await request.json() as Partial<ContentTypeRow>;
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (typeof body.display_name === 'string') patch.display_name = body.display_name.trim();
  if (typeof body.description === 'string' || body.description === null) patch.description = body.description?.trim() || null;
  if (Array.isArray(body.fields)) patch.fields = normalizeFields(body.fields);
  if (typeof body.icon === 'string') patch.icon = body.icon;
  if (typeof body.draft_and_publish === 'boolean') patch.draft_and_publish = body.draft_and_publish;
  if (typeof body.localized === 'boolean') patch.localized = body.localized;
  const rows = await rest<ContentTypeRow[]>(env, `content_types?id=eq.${encodeURIComponent(id)}&company_id=eq.${session.companyId}&select=id,api_id,display_name,description,fields,icon,draft_and_publish,localized,created_at,updated_at`, {
    method: 'PATCH', body: JSON.stringify(patch),
  });
  if (!rows.length) return json({ error: { code: 'NOT_FOUND', message: 'Тип контента не найден' } }, 404);
  return json(rows[0]);
}

async function listEntries(env: Env, session: AuthSession, url: URL) {
  const typeId = url.searchParams.get('typeId');
  const locale = url.searchParams.get('locale');
  const status = url.searchParams.get('status');
  const filters = [`company_id=eq.${session.companyId}`];
  if (typeId) filters.push(`content_type_id=eq.${encodeURIComponent(typeId)}`);
  if (locale) filters.push(`locale=eq.${encodeURIComponent(locale)}`);
  if (status) filters.push(`status=eq.${encodeURIComponent(status)}`);
  return rest<EntryRow[]>(env, `content_entries?select=id,content_type_id,document_id,locale,status,title,slug,data,published_at,created_at,updated_at&${filters.join('&')}&order=updated_at.desc`);
}

async function nextVersion(env: Env, session: AuthSession, entryId: string) {
  const rows = await rest<Array<{ version: number }>>(env, `content_entry_versions?select=version&company_id=eq.${session.companyId}&entry_id=eq.${encodeURIComponent(entryId)}&order=version.desc&limit=1`);
  return Number(rows[0]?.version ?? 0) + 1;
}

async function saveVersion(env: Env, session: AuthSession, entry: EntryRow) {
  const version = await nextVersion(env, session, entry.id);
  await rest(env, 'content_entry_versions', {
    method: 'POST',
    body: JSON.stringify({
      company_id: session.companyId,
      entry_id: entry.id,
      version,
      status: entry.status,
      title: entry.title,
      slug: entry.slug,
      data: entry.data,
      created_by: session.user.id,
    }),
  });
}

async function createEntry(request: Request, env: Env, session: AuthSession) {
  const body = await request.json() as Partial<EntryRow>;
  if (!body.content_type_id || !body.title?.trim()) return json({ error: { code: 'VALIDATION_ERROR', message: 'Тип и заголовок обязательны' } }, 400);
  const status = body.status === 'published' && canPublish(session) ? 'published' : 'draft';
  const rows = await rest<EntryRow[]>(env, 'content_entries?select=id,content_type_id,document_id,locale,status,title,slug,data,published_at,created_at,updated_at', {
    method: 'POST',
    body: JSON.stringify({
      company_id: session.companyId,
      content_type_id: body.content_type_id,
      locale: ['ru', 'kk', 'en'].includes(body.locale ?? '') ? body.locale : 'ru',
      status,
      title: body.title.trim(),
      slug: slugify(body.slug || body.title),
      data: body.data && typeof body.data === 'object' ? body.data : {},
      published_at: status === 'published' ? new Date().toISOString() : null,
      created_by: session.user.id,
      updated_by: session.user.id,
    }),
  });
  await saveVersion(env, session, rows[0]);
  return json(rows[0], 201);
}

async function updateEntry(request: Request, env: Env, session: AuthSession, id: string) {
  const body = await request.json() as Partial<EntryRow>;
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString(), updated_by: session.user.id };
  if (typeof body.title === 'string') patch.title = body.title.trim();
  if (typeof body.slug === 'string') patch.slug = slugify(body.slug);
  if (body.data && typeof body.data === 'object') patch.data = body.data;
  if (body.locale && ['ru', 'kk', 'en'].includes(body.locale)) patch.locale = body.locale;
  if (body.status) {
    if (body.status === 'published' && !canPublish(session)) return json({ error: { code: 'FORBIDDEN', message: 'Недостаточно прав для публикации' } }, 403);
    if (['draft', 'published', 'archived'].includes(body.status)) {
      patch.status = body.status;
      patch.published_at = body.status === 'published' ? new Date().toISOString() : null;
    }
  }
  const rows = await rest<EntryRow[]>(env, `content_entries?id=eq.${encodeURIComponent(id)}&company_id=eq.${session.companyId}&select=id,content_type_id,document_id,locale,status,title,slug,data,published_at,created_at,updated_at`, {
    method: 'PATCH', body: JSON.stringify(patch),
  });
  if (!rows.length) return json({ error: { code: 'NOT_FOUND', message: 'Материал не найден' } }, 404);
  await saveVersion(env, session, rows[0]);
  return json(rows[0]);
}

async function listVersions(env: Env, session: AuthSession, entryId: string) {
  return rest(env, `content_entry_versions?select=id,entry_id,version,status,title,slug,data,created_at&company_id=eq.${session.companyId}&entry_id=eq.${encodeURIComponent(entryId)}&order=version.desc`);
}

async function listMedia(env: Env, session: AuthSession) {
  return rest<MediaRow[]>(env, `content_media?select=id,name,url,mime_type,size_bytes,alt_text,folder,metadata,created_at,updated_at&company_id=eq.${session.companyId}&order=created_at.desc`);
}

async function createMedia(request: Request, env: Env, session: AuthSession) {
  const body = await request.json() as Partial<MediaRow>;
  if (!body.name?.trim() || !body.url?.trim()) return json({ error: { code: 'VALIDATION_ERROR', message: 'Название и URL файла обязательны' } }, 400);
  try { new URL(body.url); } catch { return json({ error: { code: 'VALIDATION_ERROR', message: 'Укажите корректный URL файла' } }, 400); }
  const rows = await rest<MediaRow[]>(env, 'content_media?select=id,name,url,mime_type,size_bytes,alt_text,folder,metadata,created_at,updated_at', {
    method: 'POST',
    body: JSON.stringify({
      company_id: session.companyId,
      name: body.name.trim(),
      url: body.url.trim(),
      mime_type: body.mime_type || null,
      size_bytes: Number(body.size_bytes ?? 0) || null,
      alt_text: body.alt_text ?? {},
      folder: body.folder?.trim() || '/',
      metadata: body.metadata ?? {},
      created_by: session.user.id,
    }),
  });
  return json(rows[0], 201);
}

export async function handleContentStudioRequest(request: Request, env: Env, session: AuthSession) {
  const url = new URL(request.url);
  try {
    if (request.method === 'GET' && url.pathname === '/api/content/types') return json(await listTypes(env, session));
    if (request.method === 'POST' && url.pathname === '/api/content/types') return createType(request, env, session);
    const typeMatch = url.pathname.match(/^\/api\/content\/types\/([^/]+)$/);
    if (request.method === 'PATCH' && typeMatch) return updateType(request, env, session, typeMatch[1]);

    if (request.method === 'GET' && url.pathname === '/api/content/entries') return json(await listEntries(env, session, url));
    if (request.method === 'POST' && url.pathname === '/api/content/entries') return createEntry(request, env, session);
    const entryMatch = url.pathname.match(/^\/api\/content\/entries\/([^/]+)$/);
    if (request.method === 'PATCH' && entryMatch) return updateEntry(request, env, session, entryMatch[1]);
    const versionMatch = url.pathname.match(/^\/api\/content\/entries\/([^/]+)\/versions$/);
    if (request.method === 'GET' && versionMatch) return json(await listVersions(env, session, versionMatch[1]));

    if (request.method === 'GET' && url.pathname === '/api/content/media') return json(await listMedia(env, session));
    if (request.method === 'POST' && url.pathname === '/api/content/media') return createMedia(request, env, session);
    return null;
  } catch (error) {
    return json({ error: { code: 'CONTENT_STUDIO_ERROR', message: error instanceof Error ? error.message : 'Ошибка Content Studio' } }, 500);
  }
}
