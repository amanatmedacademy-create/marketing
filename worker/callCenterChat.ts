import type { Env } from './integrations';

// Колл-Центр: порт Unified Inbox из МИС в модуль «Чат».
// Диалоги — marketing_conversations, сообщения — marketing_messages,
// контакты — marketing_leads, сотрудники — marketing_users,
// контекст воронки — sales_funnel_leads. Вложения — Storage-бакет
// marketing-chat-attachments.

type Row = Record<string, unknown>;
type ChatDirection = 'INBOUND' | 'OUTBOUND';
type ChatStatus = 'OPEN' | 'PENDING' | 'CLOSED';

type AttachmentInput = {
  name?: string;
  mimeType?: string;
  base64?: string;
  sizeBytes?: number;
};

type MessageInput = {
  body?: string;
  direction?: ChatDirection;
  senderName?: string;
  attachment?: AttachmentInput;
};

type ThreadInput = {
  leadId?: string;
  channel?: string;
  title?: string;
  phone?: string;
  assignedUserId?: string;
};

type ThreadPatchInput = {
  status?: ChatStatus;
  assignedUserId?: string | null;
  title?: string;
};

const ROLE_HEADER = 'x-amanat-auth-role';
const WRITE_ROLES = ['administrator', 'marketer'];

const THREAD_SELECT = 'id,lead_id,contact_id,title,phone,channel,status,assigned_user_id,unread_count,last_message_at,created_at,updated_at';
const MESSAGE_SELECT = 'id,conversation_id,direction,sender_name,body,status,external_message_id,read_at,attachment_path,attachment_name,attachment_mime_type,attachment_size_bytes,sent_at';
const CONTACT_SELECT = 'id,name,phone,source,stage,utm_source,first_message';
const FUNNEL_SELECT = 'id,contact_id,stage,priority,amount,source,updated_at';
const STATUSES: ChatStatus[] = ['OPEN', 'PENDING', 'CLOSED'];
const CHANNELS = ['WHATSAPP', 'INSTAGRAM', 'WEB', 'PHONE', 'OTHER'];
const STORAGE_BUCKET = 'marketing-chat-attachments';
const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg', 'image/png', 'image/webp', 'application/pdf', 'text/plain',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
]);
const MESSAGE_PAGE_DEFAULT = 100;
const MESSAGE_PAGE_MAX = 200;

class ChatUpstreamError extends Error {
  constructor(readonly status: number, readonly detail: string) {
    super(`Supabase request failed with HTTP ${status}`);
  }
}

const stringValue = (row: Row, key: string) => {
  const value = row[key];
  return typeof value === 'string' ? value : typeof value === 'number' && Number.isFinite(value) ? String(value) : '';
};
const optionalString = (row: Row, key: string) => {
  const value = stringValue(row, key).trim();
  return value || undefined;
};
const numberValue = (row: Row, key: string) => {
  const value = row[key];
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return 0;
};

const isUuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

function requestRole(request: Request): string {
  return (request.headers.get(ROLE_HEADER) || '').trim().toLowerCase();
}

function canWrite(request: Request): boolean {
  return WRITE_ROLES.includes(requestRole(request));
}

function baseHeaders(requestId: string): Record<string, string> {
  return {
    'cache-control': 'no-store',
    'x-request-id': requestId,
    'x-content-type-options': 'nosniff',
    'access-control-expose-headers': 'X-Request-Id,Content-Disposition,X-Inbox-Has-More,X-Inbox-Next-Before'
  };
}

function json(requestId: string, value: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { ...baseHeaders(requestId), 'content-type': 'application/json; charset=utf-8', ...extra }
  });
}

function serviceKey(env: Env): string {
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error('Supabase server key is missing');
  return key;
}

function authHeaders(env: Env, extra: Record<string, string> = {}): Headers {
  const key = serviceKey(env);
  const headers = new Headers(extra);
  headers.set('apikey', key);
  if (!key.startsWith('sb_secret_')) headers.set('Authorization', `Bearer ${key}`);
  return headers;
}

async function db<T>(env: Env, path: string, init: RequestInit = {}): Promise<T> {
  const headers = authHeaders(env);
  new Headers(init.headers).forEach((value, name) => headers.set(name, value));
  headers.set('Accept', 'application/json');
  if (init.body != null) headers.set('Content-Type', 'application/json');
  if (init.method && !['GET', 'HEAD'].includes(init.method) && !headers.has('Prefer')) headers.set('Prefer', 'return=representation');
  const response = await fetch(`${env.SUPABASE_URL.replace(/\/+$/, '')}/rest/v1${path}`, { ...init, headers, cache: 'no-store' });
  if (!response.ok) throw new ChatUpstreamError(response.status, (await response.text()).slice(0, 4096));
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

function inFilter(values: string[]): string {
  return values.map((value) => encodeURIComponent(value)).join(',');
}

function normalizePhone(value: unknown): string {
  if (typeof value !== 'string') return '';
  let digits = value.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('8')) digits = `7${digits.slice(1)}`;
  return digits.length >= 10 && digits.length <= 15 ? digits : '';
}

function mapMessage(row: Row) {
  return {
    id: stringValue(row, 'id'),
    threadId: stringValue(row, 'conversation_id'),
    direction: stringValue(row, 'direction') as ChatDirection,
    senderName: optionalString(row, 'sender_name'),
    body: stringValue(row, 'body'),
    status: stringValue(row, 'status'),
    externalId: optionalString(row, 'external_message_id'),
    readAt: optionalString(row, 'read_at'),
    attachmentName: optionalString(row, 'attachment_name'),
    attachmentMimeType: optionalString(row, 'attachment_mime_type'),
    attachmentSizeBytes: numberValue(row, 'attachment_size_bytes') || undefined,
    hasAttachment: Boolean(optionalString(row, 'attachment_path')),
    sentAt: stringValue(row, 'sent_at')
  };
}

function mapThreadBase(row: Row) {
  return {
    id: stringValue(row, 'id'),
    leadId: optionalString(row, 'lead_id') || optionalString(row, 'contact_id'),
    channel: stringValue(row, 'channel'),
    title: optionalString(row, 'title'),
    phone: optionalString(row, 'phone'),
    status: stringValue(row, 'status') as ChatStatus,
    assignedUserId: optionalString(row, 'assigned_user_id'),
    lastMessageAt: optionalString(row, 'last_message_at') || stringValue(row, 'updated_at'),
    createdAt: stringValue(row, 'created_at'),
    updatedAt: stringValue(row, 'updated_at')
  };
}

function mapContact(row: Row) {
  return {
    id: stringValue(row, 'id'),
    fullName: stringValue(row, 'name'),
    phone: optionalString(row, 'phone'),
    source: optionalString(row, 'source'),
    stage: optionalString(row, 'stage'),
    utmSource: optionalString(row, 'utm_source'),
    firstMessage: optionalString(row, 'first_message')
  };
}

function mapFunnelLead(row: Row) {
  return {
    id: stringValue(row, 'id'),
    contactId: optionalString(row, 'contact_id'),
    stage: stringValue(row, 'stage'),
    priority: stringValue(row, 'priority'),
    amount: numberValue(row, 'amount'),
    source: stringValue(row, 'source')
  };
}

function mapUser(row: Row) {
  return {
    id: stringValue(row, 'id'),
    fullName: stringValue(row, 'name'),
    role: stringValue(row, 'role'),
    active: stringValue(row, 'status') === 'active'
  };
}

async function ensureThread(env: Env, threadId: string): Promise<Row | null> {
  if (!isUuid(threadId)) return null;
  const rows = await db<Row[]>(env, `/marketing_conversations?select=${THREAD_SELECT}&id=eq.${encodeURIComponent(threadId)}&archived_at=is.null&limit=1`);
  return rows[0] || null;
}

async function ensureActiveUser(env: Env, id?: string | null): Promise<boolean> {
  if (!id) return true;
  if (!isUuid(id)) return false;
  const rows = await db<Row[]>(env, `/marketing_users?select=id&id=eq.${encodeURIComponent(id)}&status=eq.active&limit=1`);
  return rows.length > 0;
}

// ---------------------------------------------------------------------------
// Workspace
// ---------------------------------------------------------------------------

async function workspace(env: Env, requestId: string): Promise<Response> {
  const [threads, users] = await Promise.all([
    db<Row[]>(env, `/marketing_conversations?select=${THREAD_SELECT}&archived_at=is.null&order=last_message_at.desc.nullslast&limit=500`),
    db<Row[]>(env, '/marketing_users?select=id,name,role,status&status=eq.active&order=name.asc&limit=500')
  ]);

  const threadIds = threads.map((row) => stringValue(row, 'id')).filter(Boolean);
  const contactIds = Array.from(new Set(threads
    .flatMap((row) => [optionalString(row, 'lead_id'), optionalString(row, 'contact_id')])
    .filter((value): value is string => Boolean(value && isUuid(value)))));

  const [messages, contacts, funnelLeads] = await Promise.all([
    threadIds.length
      ? db<Row[]>(env, `/marketing_messages?select=${MESSAGE_SELECT}&conversation_id=in.(${inFilter(threadIds)})&order=sent_at.desc&limit=5000`)
      : Promise.resolve([] as Row[]),
    contactIds.length
      ? db<Row[]>(env, `/marketing_leads?select=${CONTACT_SELECT}&id=in.(${inFilter(contactIds)})&limit=500`)
      : Promise.resolve([] as Row[]),
    contactIds.length
      ? db<Row[]>(env, `/sales_funnel_leads?select=${FUNNEL_SELECT}&contact_id=in.(${inFilter(contactIds)})&order=updated_at.desc&limit=1000`)
      : Promise.resolve([] as Row[])
  ]);

  const contactMap = new Map(contacts.map((row) => [stringValue(row, 'id'), mapContact(row)]));
  const funnelMap = new Map<string, ReturnType<typeof mapFunnelLead>>();
  funnelLeads.forEach((row) => {
    const lead = mapFunnelLead(row);
    if (lead.contactId && !funnelMap.has(lead.contactId)) funnelMap.set(lead.contactId, lead);
  });
  const userMap = new Map(users.map((row) => [stringValue(row, 'id'), mapUser(row)]));

  const lastMessageMap = new Map<string, ReturnType<typeof mapMessage>>();
  const unreadMap = new Map<string, number>();
  messages.forEach((row) => {
    const message = mapMessage(row);
    if (!lastMessageMap.has(message.threadId)) lastMessageMap.set(message.threadId, message);
    if (message.direction === 'INBOUND' && !message.readAt) {
      unreadMap.set(message.threadId, (unreadMap.get(message.threadId) || 0) + 1);
    }
  });

  return json(requestId, {
    threads: threads.map((row) => {
      const base = mapThreadBase(row);
      return {
        ...base,
        contact: base.leadId ? contactMap.get(base.leadId) : undefined,
        funnelLead: base.leadId ? funnelMap.get(base.leadId) : undefined,
        assignedUser: base.assignedUserId ? userMap.get(base.assignedUserId) : undefined,
        lastMessage: lastMessageMap.get(base.id),
        unreadCount: unreadMap.get(base.id) || 0
      };
    }),
    users: users.map(mapUser)
  });
}

// ---------------------------------------------------------------------------
// Диалоги
// ---------------------------------------------------------------------------

async function createThread(request: Request, env: Env, requestId: string): Promise<Response> {
  const input = await request.json().catch(() => null) as ThreadInput | null;
  const leadId = input?.leadId?.trim() || '';
  const channel = (input?.channel || 'WHATSAPP').toUpperCase();
  if (!CHANNELS.includes(channel)) return json(requestId, { error: 'Недопустимый канал' }, 400);
  if (!await ensureActiveUser(env, input?.assignedUserId || null)) return json(requestId, { error: 'Выбранный сотрудник не найден или заблокирован' }, 400);

  let contact: Row | null = null;
  if (leadId) {
    if (!isUuid(leadId)) return json(requestId, { error: 'Некорректный контакт' }, 400);
    const rows = await db<Row[]>(env, `/marketing_leads?select=${CONTACT_SELECT}&id=eq.${encodeURIComponent(leadId)}&limit=1`);
    contact = rows[0] || null;
    if (!contact) return json(requestId, { error: 'Контакт не найден' }, 404);
  }

  const title = input?.title?.trim() || (contact ? stringValue(contact, 'name') : '');
  const phone = normalizePhone(input?.phone) || (contact ? normalizePhone(contact.phone) : '');
  if (!title && !phone) return json(requestId, { error: 'Укажите имя лида или телефон' }, 400);

  const now = new Date().toISOString();
  const rows = await db<Row[]>(env, `/marketing_conversations?select=${THREAD_SELECT}`, {
    method: 'POST',
    body: JSON.stringify({
      lead_id: leadId || null,
      title: title || phone,
      phone: phone || null,
      channel,
      status: 'OPEN',
      assigned_user_id: input?.assignedUserId || null,
      unread_count: 0,
      last_message_at: now,
      created_at: now,
      updated_at: now
    })
  });
  return rows[0] ? json(requestId, mapThreadBase(rows[0]), 201) : json(requestId, { error: 'Диалог не создан' }, 502);
}

async function updateThread(request: Request, env: Env, requestId: string, threadId: string): Promise<Response> {
  const current = await ensureThread(env, threadId);
  if (!current) return json(requestId, { error: 'Диалог не найден' }, 404);
  const input = await request.json().catch(() => null) as ThreadPatchInput | null;
  if (!input) return json(requestId, { error: 'Тело запроса не распознано' }, 400);
  const patch: Row = { updated_at: new Date().toISOString() };
  if (input.status !== undefined) {
    if (!STATUSES.includes(input.status)) return json(requestId, { error: 'Недопустимый статус диалога' }, 400);
    patch.status = input.status;
  }
  if (input.assignedUserId !== undefined) {
    if (!await ensureActiveUser(env, input.assignedUserId)) return json(requestId, { error: 'Выбранный сотрудник не найден или заблокирован' }, 400);
    patch.assigned_user_id = input.assignedUserId || null;
  }
  if (input.title !== undefined) {
    const title = input.title.trim();
    if (!title) return json(requestId, { error: 'Название диалога обязательно' }, 400);
    patch.title = title.slice(0, 160);
  }
  const rows = await db<Row[]>(env, `/marketing_conversations?id=eq.${encodeURIComponent(threadId)}&select=${THREAD_SELECT}`, {
    method: 'PATCH', body: JSON.stringify(patch)
  });
  return rows[0] ? json(requestId, mapThreadBase(rows[0])) : json(requestId, { error: 'Диалог не обновлён' }, 502);
}

// ---------------------------------------------------------------------------
// Сообщения
// ---------------------------------------------------------------------------

async function listMessages(env: Env, url: URL, requestId: string, threadId: string): Promise<Response> {
  const thread = await ensureThread(env, threadId);
  if (!thread) return json(requestId, { error: 'Диалог не найден' }, 404);
  const limitRaw = Number(url.searchParams.get('limit'));
  const limit = Number.isInteger(limitRaw) ? Math.min(MESSAGE_PAGE_MAX, Math.max(20, limitRaw)) : MESSAGE_PAGE_DEFAULT;
  const before = (url.searchParams.get('before') || '').trim();
  const beforeDate = before ? new Date(before) : null;

  const params = new URLSearchParams();
  params.set('select', MESSAGE_SELECT);
  params.set('conversation_id', `eq.${threadId}`);
  params.set('order', 'sent_at.desc,id.desc');
  params.set('limit', String(limit + 1));
  if (beforeDate && Number.isFinite(beforeDate.getTime())) params.set('sent_at', `lt.${beforeDate.toISOString()}`);

  const rows = await db<Row[]>(env, `/marketing_messages?${params.toString()}`);
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit).reverse();
  const nextBefore = hasMore && page.length ? stringValue(page[0], 'sent_at') : '';

  return json(requestId, page.map(mapMessage), 200, {
    'x-inbox-has-more': hasMore ? '1' : '0',
    ...(nextBefore ? { 'x-inbox-next-before': nextBefore } : {})
  });
}

function decodeBase64(value: string): Uint8Array {
  const normalized = value.replace(/^data:[^;]+;base64,/, '').replace(/\s+/g, '');
  const binary = atob(normalized);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function safeFilename(value: string): string {
  const cleaned = value.trim().replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '');
  return cleaned.slice(0, 120) || 'attachment';
}

async function storageUpload(env: Env, path: string, bytes: Uint8Array, mimeType: string): Promise<void> {
  const headers = authHeaders(env, { 'Content-Type': mimeType, 'x-upsert': 'false' });
  const response = await fetch(`${env.SUPABASE_URL.replace(/\/+$/, '')}/storage/v1/object/${STORAGE_BUCKET}/${path}`, {
    method: 'POST', headers, body: bytes as unknown as BodyInit
  });
  if (!response.ok) throw new ChatUpstreamError(response.status, (await response.text()).slice(0, 4096));
}

async function storageDelete(env: Env, paths: string[]): Promise<void> {
  if (!paths.length) return;
  const headers = authHeaders(env, { 'Content-Type': 'application/json' });
  await fetch(`${env.SUPABASE_URL.replace(/\/+$/, '')}/storage/v1/object/${STORAGE_BUCKET}`, {
    method: 'DELETE', headers, body: JSON.stringify({ prefixes: paths })
  }).catch(() => undefined);
}

async function createMessage(request: Request, env: Env, requestId: string, threadId: string): Promise<Response> {
  const input = await request.json().catch(() => null) as MessageInput | null;
  const body = input?.body?.trim() || '';
  const direction = input?.direction || 'OUTBOUND';
  const attachment = input?.attachment;
  if (!body && !attachment?.base64) return json(requestId, { error: 'Сообщение и вложение отсутствуют' }, 400);
  if (!['INBOUND', 'OUTBOUND'].includes(direction)) return json(requestId, { error: 'Недопустимое направление сообщения' }, 400);
  const thread = await ensureThread(env, threadId);
  if (!thread) return json(requestId, { error: 'Диалог не найден' }, 404);

  let attachmentPath: string | null = null;
  let attachmentName: string | null = null;
  let attachmentMimeType: string | null = null;
  let attachmentSizeBytes: number | null = null;

  if (attachment?.base64) {
    const name = safeFilename(attachment.name || 'attachment');
    const mimeType = attachment.mimeType || 'application/octet-stream';
    if (!ALLOWED_MIME_TYPES.has(mimeType)) return json(requestId, { error: 'Этот тип файла не разрешён' }, 400);
    const bytes = decodeBase64(attachment.base64);
    if (!bytes.byteLength || bytes.byteLength > MAX_ATTACHMENT_BYTES) return json(requestId, { error: 'Размер вложения должен быть от 1 байта до 5 МБ' }, 400);
    if (attachment.sizeBytes != null && Math.abs(attachment.sizeBytes - bytes.byteLength) > 8) return json(requestId, { error: 'Размер вложения не совпадает с переданными данными' }, 400);
    attachmentPath = `${threadId}/${crypto.randomUUID()}-${name}`;
    attachmentName = name;
    attachmentMimeType = mimeType;
    attachmentSizeBytes = bytes.byteLength;
    await storageUpload(env, attachmentPath, bytes, mimeType);
  }

  const sentAt = new Date().toISOString();
  try {
    const rows = await db<Row[]>(env, `/marketing_messages?select=${MESSAGE_SELECT}`, {
      method: 'POST',
      body: JSON.stringify({
        conversation_id: threadId,
        direction,
        sender_name: input?.senderName?.trim() || null,
        body: body || (attachmentName ? `Вложение: ${attachmentName}` : ''),
        status: 'SENT',
        read_at: direction === 'OUTBOUND' ? sentAt : null,
        attachment_path: attachmentPath,
        attachment_name: attachmentName,
        attachment_mime_type: attachmentMimeType,
        attachment_size_bytes: attachmentSizeBytes,
        sent_at: sentAt,
        created_at: sentAt
      })
    });
    await db<Row[]>(env, `/marketing_conversations?id=eq.${encodeURIComponent(threadId)}&select=id`, {
      method: 'PATCH',
      body: JSON.stringify(direction === 'INBOUND'
        ? { last_message_at: sentAt, updated_at: sentAt, status: 'OPEN', unread_count: numberValue(thread, 'unread_count') + 1 }
        : { last_message_at: sentAt, updated_at: sentAt, status: 'OPEN' })
    });
    return rows[0] ? json(requestId, mapMessage(rows[0]), 201) : json(requestId, { error: 'Сообщение не сохранено' }, 502);
  } catch (error) {
    if (attachmentPath) await storageDelete(env, [attachmentPath]);
    throw error;
  }
}

async function markRead(env: Env, requestId: string, threadId: string): Promise<Response> {
  const thread = await ensureThread(env, threadId);
  if (!thread) return json(requestId, { error: 'Диалог не найден' }, 404);
  const readAt = new Date().toISOString();
  await db<Row[]>(env, `/marketing_messages?conversation_id=eq.${encodeURIComponent(threadId)}&direction=eq.INBOUND&read_at=is.null&select=id`, {
    method: 'PATCH', body: JSON.stringify({ read_at: readAt })
  });
  await db<Row[]>(env, `/marketing_conversations?id=eq.${encodeURIComponent(threadId)}&select=id`, {
    method: 'PATCH', body: JSON.stringify({ unread_count: 0 })
  });
  return json(requestId, { ok: true, readAt });
}

async function downloadAttachment(env: Env, requestId: string, messageId: string): Promise<Response> {
  if (!isUuid(messageId)) return json(requestId, { error: 'Вложение не найдено' }, 404);
  const rows = await db<Row[]>(env, `/marketing_messages?select=attachment_path,attachment_name,attachment_mime_type&id=eq.${encodeURIComponent(messageId)}&limit=1`);
  const row = rows[0];
  const path = row ? optionalString(row, 'attachment_path') : undefined;
  if (!path) return json(requestId, { error: 'Вложение не найдено' }, 404);
  const response = await fetch(`${env.SUPABASE_URL.replace(/\/+$/, '')}/storage/v1/object/${STORAGE_BUCKET}/${path}`, { headers: authHeaders(env) });
  if (!response.ok) throw new ChatUpstreamError(response.status, (await response.text()).slice(0, 4096));
  const filename = safeFilename(optionalString(row, 'attachment_name') || 'attachment');
  return new Response(response.body, {
    status: 200,
    headers: {
      ...baseHeaders(requestId),
      'content-type': optionalString(row, 'attachment_mime_type') || response.headers.get('content-type') || 'application/octet-stream',
      'content-disposition': `inline; filename="${filename}"`
    }
  });
}

// ---------------------------------------------------------------------------
// Маршрутизация
// ---------------------------------------------------------------------------

export async function handleCallCenterChat(request: Request, env: Env, url: URL): Promise<Response | null> {
  const path = url.pathname.replace(/\/+$/, '') || '/';
  if (!path.startsWith('/api/callcenter/')) return null;
  const requestId = crypto.randomUUID();
  const isRead = request.method === 'GET' || request.method === 'HEAD';
  const isMarkRead = request.method === 'PATCH' && /^\/api\/callcenter\/threads\/[^/]+\/read$/.test(path);
  if (!isRead && !isMarkRead && !canWrite(request)) {
    return json(requestId, { error: 'Изменения в колл-центре доступны администратору и маркетологу' }, 403);
  }
  try {
    if (request.method === 'GET' && path === '/api/callcenter/workspace') return await workspace(env, requestId);
    if (request.method === 'POST' && path === '/api/callcenter/threads') return await createThread(request, env, requestId);

    const threadMatch = path.match(/^\/api\/callcenter\/threads\/([^/]+)$/);
    if (request.method === 'PATCH' && threadMatch) return await updateThread(request, env, requestId, decodeURIComponent(threadMatch[1]));

    const messagesMatch = path.match(/^\/api\/callcenter\/threads\/([^/]+)\/messages$/);
    if (request.method === 'GET' && messagesMatch) return await listMessages(env, url, requestId, decodeURIComponent(messagesMatch[1]));
    if (request.method === 'POST' && messagesMatch) return await createMessage(request, env, requestId, decodeURIComponent(messagesMatch[1]));

    const readMatch = path.match(/^\/api\/callcenter\/threads\/([^/]+)\/read$/);
    if (request.method === 'PATCH' && readMatch) return await markRead(env, requestId, decodeURIComponent(readMatch[1]));

    const attachmentMatch = path.match(/^\/api\/callcenter\/attachments\/([^/]+)$/);
    if (request.method === 'GET' && attachmentMatch) return await downloadAttachment(env, requestId, decodeURIComponent(attachmentMatch[1]));

    return json(requestId, { error: 'Маршрут колл-центра не найден' }, 404);
  } catch (error) {
    const upstream = error instanceof ChatUpstreamError;
    console.error(JSON.stringify({
      level: 'error', area: 'callcenter-chat', requestId, path,
      message: error instanceof Error ? error.message : 'Unknown error',
      upstreamStatus: upstream ? error.status : undefined,
      upstreamDetail: upstream ? error.detail : undefined
    }));
    return json(requestId, {
      error: upstream ? 'Ошибка подключения к Supabase или хранилищу вложений' : 'Внутренняя ошибка модуля Колл-Центра',
      requestId
    }, upstream ? 502 : 500);
  }
}
