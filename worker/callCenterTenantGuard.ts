import { handleCallCenterChat } from './callCenterChat';
import type { Env } from './integrations';

type Row = Record<string, unknown>;

export type CallCenterTenantEnv = Env & { CURRENT_COMPANY_ID?: string; DEFAULT_COMPANY_ID?: string };

const text = (value: unknown): string => typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim();
const record = (value: unknown): Row => value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {};
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});

function companyId(env: CallCenterTenantEnv): string {
  return text(env.CURRENT_COMPANY_ID) || text(env.DEFAULT_COMPANY_ID);
}

function headers(env: CallCenterTenantEnv, extra: HeadersInit = {}): Headers {
  const result = new Headers(extra);
  result.set('apikey', env.SUPABASE_SERVICE_ROLE_KEY);
  result.set('authorization', `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`);
  result.set('accept', 'application/json');
  return result;
}

async function db<T>(env: CallCenterTenantEnv, path: string, init: RequestInit = {}): Promise<T> {
  const requestHeaders = headers(env, init.headers);
  if (init.body != null) requestHeaders.set('content-type', 'application/json');
  if (init.method && !['GET', 'HEAD'].includes(init.method) && !requestHeaders.has('prefer')) requestHeaders.set('prefer', 'return=representation');
  const response = await fetch(`${env.SUPABASE_URL.replace(/\/+$/, '')}/rest/v1/${path}`, { ...init, headers: requestHeaders, cache: 'no-store' });
  const body = await response.text();
  if (!response.ok) throw new Error(`Call-center tenant guard ${response.status}: ${body.slice(0, 1400)}`);
  return (body ? JSON.parse(body) : null) as T;
}

async function threadRow(env: CallCenterTenantEnv, threadId: string): Promise<Row | null> {
  const tenant = companyId(env);
  if (!tenant) return null;
  const rows = await db<Row[]>(env,
    `marketing_conversations?id=eq.${encodeURIComponent(threadId)}&company_id=eq.${encodeURIComponent(tenant)}&select=id,company_id,channel&limit=1`,
  );
  return rows[0] || null;
}

async function messageBelongsToTenant(env: CallCenterTenantEnv, messageId: string): Promise<boolean> {
  const tenant = companyId(env);
  if (!tenant) return false;
  const rows = await db<Row[]>(env,
    `marketing_messages?id=eq.${encodeURIComponent(messageId)}&select=id,conversation_id,company_id&limit=1`,
  );
  const message = rows[0];
  if (!message) return false;
  if (text(message.company_id)) return text(message.company_id) === tenant;
  const conversationId = text(message.conversation_id);
  return Boolean(conversationId && await threadRow(env, conversationId));
}

async function filteredWorkspace(request: Request, env: CallCenterTenantEnv, url: URL): Promise<Response> {
  const tenant = companyId(env);
  if (!tenant) return json({ error: 'Выберите клинику для колл-центра', code: 'COMPANY_REQUIRED' }, 409);
  const allowed = await db<Row[]>(env,
    `marketing_conversations?company_id=eq.${encodeURIComponent(tenant)}&archived_at=is.null&select=id&limit=5000`,
  );
  const allowedIds = new Set(allowed.map((row) => text(row.id)).filter(Boolean));
  const response = await handleCallCenterChat(request, env, url);
  if (!response) return json({ error: 'Call-center workspace unavailable' }, 404);
  if (!response.ok) return response;
  const payload = record(await response.clone().json().catch(() => ({})));
  const threads = Array.isArray(payload.threads) ? payload.threads.filter((item) => allowedIds.has(text(record(item).id))) : [];
  const responseHeaders = new Headers(response.headers);
  responseHeaders.set('content-type', 'application/json; charset=utf-8');
  responseHeaders.set('cache-control', 'no-store');
  return new Response(JSON.stringify({ ...payload, threads }), { status: response.status, headers: responseHeaders });
}

async function createThread(request: Request, env: CallCenterTenantEnv, url: URL): Promise<Response> {
  const tenant = companyId(env);
  if (!tenant) return json({ error: 'Выберите клинику для нового диалога', code: 'COMPANY_REQUIRED' }, 409);
  const body = record(await request.clone().json().catch(() => ({})));
  const leadId = text(body.leadId);
  if (leadId) {
    const leads = await db<Row[]>(env,
      `marketing_leads?id=eq.${encodeURIComponent(leadId)}&company_id=eq.${encodeURIComponent(tenant)}&select=id&limit=1`,
    );
    if (!leads.length) return json({ error: 'Лид принадлежит другой клинике или не найден' }, 404);
  }
  const response = await handleCallCenterChat(request, env, url);
  if (!response || !response.ok) return response || json({ error: 'Не удалось создать диалог' }, 500);
  const payload = record(await response.clone().json().catch(() => ({})));
  const id = text(payload.id);
  if (!id) return response;
  await db<Row[]>(env, `marketing_conversations?id=eq.${encodeURIComponent(id)}&select=id`, {
    method: 'PATCH',
    body: JSON.stringify({ company_id: tenant, updated_at: new Date().toISOString() }),
  });
  return response;
}

async function createGenericMessage(request: Request, env: CallCenterTenantEnv, url: URL, threadId: string): Promise<Response | null> {
  const tenant = companyId(env);
  if (!tenant) return json({ error: 'Выберите клинику для отправки сообщения', code: 'COMPANY_REQUIRED' }, 409);
  const thread = await threadRow(env, threadId);
  if (!thread) return json({ error: 'Диалог другой клиники или не найден' }, 404);
  const channel = text(thread.channel).toUpperCase();
  // Social channels are handled before this guard by their dedicated API modules.
  if (['WHATSAPP', 'INSTAGRAM', 'TELEGRAM'].includes(channel)) return null;
  const response = await handleCallCenterChat(request, env, url);
  if (!response || !response.ok) return response || json({ error: 'Не удалось отправить сообщение' }, 500);
  const payload = record(await response.clone().json().catch(() => ({})));
  const messageId = text(payload.id);
  if (messageId) {
    await db<Row[]>(env, `marketing_messages?id=eq.${encodeURIComponent(messageId)}&conversation_id=eq.${encodeURIComponent(threadId)}&select=id`, {
      method: 'PATCH',
      body: JSON.stringify({ company_id: tenant }),
    });
  }
  return response;
}

export async function handleCallCenterTenantGuard(request: Request, env: CallCenterTenantEnv, url: URL): Promise<Response | null> {
  if (!url.pathname.startsWith('/api/callcenter/')) return null;
  const tenant = companyId(env);
  if (!tenant) return json({ error: 'Выберите клинику для колл-центра', code: 'COMPANY_REQUIRED' }, 409);

  if (url.pathname === '/api/callcenter/workspace' && request.method === 'GET') {
    return filteredWorkspace(request, env, url);
  }
  if (url.pathname === '/api/callcenter/threads' && request.method === 'POST') {
    return createThread(request, env, url);
  }

  const threadMatch = url.pathname.match(/^\/api\/callcenter\/threads\/([^/]+)(?:\/.*)?$/);
  if (threadMatch) {
    const threadId = decodeURIComponent(threadMatch[1]);
    const thread = await threadRow(env, threadId);
    if (!thread) return json({ error: 'Диалог другой клиники или не найден' }, 404);
    if (/^\/api\/callcenter\/threads\/[^/]+\/messages$/.test(url.pathname) && request.method === 'POST') {
      return createGenericMessage(request, env, url, threadId);
    }
    return null;
  }

  const attachmentMatch = url.pathname.match(/^\/api\/callcenter\/attachments\/([^/]+)$/);
  if (attachmentMatch) {
    const messageId = decodeURIComponent(attachmentMatch[1]);
    if (!await messageBelongsToTenant(env, messageId)) return json({ error: 'Вложение другой клиники или не найдено' }, 404);
    return null;
  }

  return null;
}
