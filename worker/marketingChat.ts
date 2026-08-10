import { requireCompanyId, type TenantScopedEnv } from './tenantScope';

type MarketingChatEnv = TenantScopedEnv & {
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  SUPABASE_SECRET_KEY?: string;
  SUPABASE_SERVER_KEY?: string;
};

type JsonRecord = Record<string, unknown>;

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

function serviceKey(env: MarketingChatEnv): string {
  return env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVER_KEY || '';
}

function companyId(env: MarketingChatEnv): string {
  return requireCompanyId(env);
}

function companyFilter(env: MarketingChatEnv): string {
  return `company_id=eq.${encodeURIComponent(companyId(env))}`;
}

async function db(env: MarketingChatEnv, path: string, init: RequestInit = {}): Promise<Response> {
  const key = serviceKey(env);
  if (!env.SUPABASE_URL || !key) return json({ error: 'Supabase не настроен', code: 'CHAT_DB_NOT_CONFIGURED' }, 503);
  const headers = new Headers(init.headers);
  headers.set('apikey', key);
  headers.set('authorization', `Bearer ${key}`);
  headers.set('content-type', 'application/json');
  return fetch(`${env.SUPABASE_URL.replace(/\/+$/, '')}/rest/v1/${path}`, { ...init, headers });
}

async function relay(response: Response): Promise<Response> {
  const body = await response.text();
  return new Response(body || null, {
    status: response.status,
    headers: {
      'content-type': response.headers.get('content-type') || 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

async function conversationExists(env: MarketingChatEnv, conversationId: string): Promise<boolean> {
  const response = await db(env, `marketing_conversations?select=id&id=eq.${encodeURIComponent(conversationId)}&${companyFilter(env)}&archived_at=is.null&limit=1`);
  if (!response.ok) return false;
  const rows = await response.json() as JsonRecord[];
  return rows.length > 0;
}

async function listConversations(env: MarketingChatEnv): Promise<Response> {
  const select = [
    'id,title,phone,channel,status,unread_count,last_message_at,created_at,updated_at',
    'marketing_messages(id,body,direction,sent_at,status)',
  ].join(',');
  const response = await db(env, `marketing_conversations?select=${encodeURIComponent(select)}&${companyFilter(env)}&archived_at=is.null&order=updated_at.desc&marketing_messages.order=sent_at.desc&marketing_messages.limit=1`);
  if (!response.ok) return relay(response);
  const rows = await response.json() as Array<JsonRecord & { marketing_messages?: JsonRecord[] }>;
  const normalized = rows.map((row) => ({
    id: row.id,
    title: row.title,
    phone: row.phone,
    channel: row.channel,
    status: row.status,
    unreadCount: Number(row.unread_count || 0),
    lastMessageAt: row.last_message_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastMessage: Array.isArray(row.marketing_messages) ? row.marketing_messages[0] || null : null,
  }));
  return json(normalized);
}

async function createConversation(request: Request, env: MarketingChatEnv): Promise<Response> {
  const payload = await request.json().catch(() => ({})) as JsonRecord;
  const response = await db(env, 'marketing_conversations', {
    method: 'POST',
    headers: { prefer: 'return=representation' },
    body: JSON.stringify({
      company_id: companyId(env),
      title: typeof payload.title === 'string' ? payload.title.trim() || null : null,
      phone: typeof payload.phone === 'string' ? payload.phone.trim() || null : null,
      channel: typeof payload.channel === 'string' ? payload.channel : 'WHATSAPP',
      status: 'OPEN',
    }),
  });
  return relay(response);
}

async function listMessages(env: MarketingChatEnv, conversationId: string): Promise<Response> {
  if (!await conversationExists(env, conversationId)) return json({ error: 'Диалог не найден в текущей клинике' }, 404);
  const response = await db(env, `marketing_messages?select=id,conversation_id,body,direction,sender_name,status,sent_at,read_at,metadata&${companyFilter(env)}&conversation_id=eq.${encodeURIComponent(conversationId)}&order=sent_at.asc`);
  if (!response.ok) return relay(response);
  const rows = await response.json() as JsonRecord[];
  return json(rows.map((row) => ({
    id: row.id,
    conversationId: row.conversation_id,
    body: row.body,
    direction: row.direction,
    senderName: row.sender_name,
    status: row.status,
    sentAt: row.sent_at,
    readAt: row.read_at,
    metadata: row.metadata,
  })));
}

async function sendMessage(request: Request, env: MarketingChatEnv, conversationId: string): Promise<Response> {
  if (!await conversationExists(env, conversationId)) return json({ error: 'Диалог не найден в текущей клинике' }, 404);
  const payload = await request.json().catch(() => ({})) as JsonRecord;
  const body = typeof payload.body === 'string' ? payload.body.trim() : '';
  if (!body) return json({ error: 'Текст сообщения обязателен' }, 400);
  const now = new Date().toISOString();
  const saved = await db(env, 'marketing_messages', {
    method: 'POST',
    headers: { prefer: 'return=representation' },
    body: JSON.stringify({
      company_id: companyId(env),
      conversation_id: conversationId,
      body,
      direction: 'OUTBOUND',
      sender_name: 'Marketing',
      status: 'SENT',
      sent_at: now,
    }),
  });
  if (!saved.ok) return relay(saved);
  const rows = await saved.json() as JsonRecord[];
  await db(env, `marketing_conversations?id=eq.${encodeURIComponent(conversationId)}&${companyFilter(env)}`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'OPEN', last_message_at: now, updated_at: now }),
  });
  const row = rows[0] || {};
  return json({
    id: row.id,
    conversationId: row.conversation_id,
    body: row.body,
    direction: row.direction,
    senderName: row.sender_name,
    status: row.status,
    sentAt: row.sent_at,
    readAt: row.read_at,
    metadata: row.metadata,
  }, 201);
}

async function updateConversation(request: Request, env: MarketingChatEnv, conversationId: string): Promise<Response> {
  if (!await conversationExists(env, conversationId)) return json({ error: 'Диалог не найден в текущей клинике' }, 404);
  const payload = await request.json().catch(() => ({})) as JsonRecord;
  const patch: JsonRecord = { updated_at: new Date().toISOString() };
  if (payload.status === 'OPEN' || payload.status === 'CLOSED') patch.status = payload.status;
  if (typeof payload.title === 'string') patch.title = payload.title.trim() || null;
  if (typeof payload.unreadCount === 'number') patch.unread_count = Math.max(0, Math.floor(payload.unreadCount));
  const response = await db(env, `marketing_conversations?id=eq.${encodeURIComponent(conversationId)}&${companyFilter(env)}`, {
    method: 'PATCH',
    headers: { prefer: 'return=representation' },
    body: JSON.stringify(patch),
  });
  return relay(response);
}

export async function handleMarketingChat(request: Request, env: MarketingChatEnv, url: URL): Promise<Response | null> {
  if (!url.pathname.startsWith('/api/conversations')) return null;
  try {
    requireCompanyId(env);
  } catch {
    return json({ error: 'Текущая клиника не определена' }, 409);
  }

  if (url.pathname === '/api/conversations') {
    if (request.method === 'GET') return listConversations(env);
    if (request.method === 'POST') return createConversation(request, env);
    return json({ error: 'Method not allowed' }, 405);
  }

  const messages = url.pathname.match(/^\/api\/conversations\/([^/]+)\/messages$/);
  if (messages) {
    const conversationId = decodeURIComponent(messages[1]);
    if (request.method === 'GET') return listMessages(env, conversationId);
    if (request.method === 'POST') return sendMessage(request, env, conversationId);
    return json({ error: 'Method not allowed' }, 405);
  }

  const conversation = url.pathname.match(/^\/api\/conversations\/([^/]+)$/);
  if (conversation) {
    if (request.method === 'PATCH') return updateConversation(request, env, decodeURIComponent(conversation[1]));
    return json({ error: 'Method not allowed' }, 405);
  }

  return null;
}
