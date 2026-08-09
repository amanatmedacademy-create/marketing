import { resolveCompanyId } from './companyContext';

type Row = Record<string, unknown>;

type TelegramCredential = {
  companyId: string;
  botToken: string;
  botId: string;
  botUsername: string;
  botName: string;
  webhookSecret: string;
};

export interface TelegramBotEnv {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  DEFAULT_COMPANY_ID?: string;
  CURRENT_COMPANY_ID?: string;
  INTEGRATION_ENCRYPTION_KEY?: string;
}

const PROVIDER = 'telegram';
const API_BASE = 'https://api.telegram.org';
const text = (value: unknown): string => typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim();
const number = (value: unknown): number => typeof value === 'number' && Number.isFinite(value) ? value : Number(value || 0) || 0;
const record = (value: unknown): Row => value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {};
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});

function authUserId(request: Request): string {
  return text(request.headers.get('x-amanat-auth-user'));
}

function dbHeaders(env: TelegramBotEnv, extra: HeadersInit = {}): Headers {
  const headers = new Headers(extra);
  headers.set('apikey', env.SUPABASE_SERVICE_ROLE_KEY);
  headers.set('authorization', `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`);
  headers.set('accept', 'application/json');
  return headers;
}

async function db<T>(env: TelegramBotEnv, path: string, init: RequestInit = {}): Promise<T> {
  const headers = dbHeaders(env, init.headers);
  if (init.body != null) headers.set('content-type', 'application/json');
  if (init.method && !['GET', 'HEAD'].includes(init.method) && !headers.has('prefer')) headers.set('prefer', 'return=representation');
  const response = await fetch(`${env.SUPABASE_URL.replace(/\/+$/, '')}/rest/v1/${path}`, { ...init, headers, cache: 'no-store' });
  const body = await response.text();
  if (!response.ok) throw new Error(`Telegram Supabase ${response.status}: ${body.slice(0, 1800)}`);
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

function encryptionSecret(env: TelegramBotEnv): string {
  return text(env.INTEGRATION_ENCRYPTION_KEY) || `imds-integrations:v1:${env.SUPABASE_SERVICE_ROLE_KEY}`;
}

async function encryptionKey(env: TelegramBotEnv): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(encryptionSecret(env)));
  return crypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

async function encryptPayload(env: TelegramBotEnv, payload: Row): Promise<{ encryptedPayload: string; iv: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await encryptionKey(env), new TextEncoder().encode(JSON.stringify(payload)));
  return { encryptedPayload: bytesToBase64(new Uint8Array(encrypted)), iv: bytesToBase64(iv) };
}

async function decryptPayload(env: TelegramBotEnv, row: Row): Promise<Row> {
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64ToBytes(text(row.iv)) },
    await encryptionKey(env),
    base64ToBytes(text(row.encrypted_payload)),
  );
  return record(JSON.parse(new TextDecoder().decode(decrypted)));
}

async function telegramApi(token: string, method: string, body?: Row): Promise<Row> {
  const response = await fetch(`${API_BASE}/bot${encodeURIComponent(token)}/${method}`, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'content-type': 'application/json', accept: 'application/json' } : { accept: 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const raw = await response.text();
  let payload: Row = {};
  try { payload = record(raw ? JSON.parse(raw) : {}); } catch { payload = { ok: false, description: raw }; }
  if (!response.ok || payload.ok !== true) throw new Error(text(payload.description) || `Telegram ${method}: HTTP ${response.status}`);
  return payload;
}

async function credentialRow(env: TelegramBotEnv, companyId: string): Promise<Row | null> {
  const rows = await db<Row[]>(env, `integration_credentials?company_id=eq.${encodeURIComponent(companyId)}&user_id=is.null&provider=eq.${PROVIDER}&select=*&limit=1`);
  return rows[0] || null;
}

async function saveCredential(env: TelegramBotEnv, credential: TelegramCredential): Promise<void> {
  const encrypted = await encryptPayload(env, {
    botToken: credential.botToken,
    botId: credential.botId,
    botUsername: credential.botUsername,
    botName: credential.botName,
    webhookSecret: credential.webhookSecret,
  });
  const current = await credentialRow(env, credential.companyId);
  const payload = {
    company_id: credential.companyId,
    user_id: null,
    provider: PROVIDER,
    encrypted_payload: encrypted.encryptedPayload,
    iv: encrypted.iv,
    config_summary: {
      values: {
        botId: credential.botId,
        botUsername: credential.botUsername,
        botName: credential.botName,
        webhook: 'configured',
      },
      secretFields: { botToken: true, webhookSecret: true },
    },
    status: 'connected',
    last_error: null,
    last_verified_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  if (current?.id) {
    await db<Row[]>(env, `integration_credentials?id=eq.${encodeURIComponent(text(current.id))}&company_id=eq.${encodeURIComponent(credential.companyId)}&select=id`, {
      method: 'PATCH', body: JSON.stringify(payload),
    });
  } else {
    await db<Row[]>(env, 'integration_credentials?select=id', { method: 'POST', body: JSON.stringify(payload) });
  }
}

async function connectedCredential(env: TelegramBotEnv, companyId: string): Promise<TelegramCredential> {
  const row = await credentialRow(env, companyId);
  if (!row || text(row.status) !== 'connected') throw new Error('Telegram Bot для клиники не подключён');
  const payload = await decryptPayload(env, row);
  const botToken = text(payload.botToken);
  const webhookSecret = text(payload.webhookSecret);
  if (!botToken || !webhookSecret) throw new Error('Telegram credential повреждён');
  return {
    companyId,
    botToken,
    botId: text(payload.botId),
    botUsername: text(payload.botUsername),
    botName: text(payload.botName),
    webhookSecret,
  };
}

async function findByBotId(env: TelegramBotEnv, botId: string): Promise<TelegramCredential | null> {
  const rows = await db<Row[]>(env, `integration_credentials?user_id=is.null&provider=eq.${PROVIDER}&status=eq.connected&select=company_id,encrypted_payload,iv&limit=500`);
  for (const row of rows) {
    try {
      const payload = await decryptPayload(env, row);
      if (text(payload.botId) !== botId) continue;
      return {
        companyId: text(row.company_id),
        botToken: text(payload.botToken),
        botId,
        botUsername: text(payload.botUsername),
        botName: text(payload.botName),
        webhookSecret: text(payload.webhookSecret),
      };
    } catch (error) {
      console.error('Unable to decrypt Telegram credential', error);
    }
  }
  return null;
}

function webhookUrl(request: Request, botId: string): string {
  const url = new URL(request.url);
  return `${url.protocol}//${url.host}/api/webhooks/telegram/${encodeURIComponent(botId)}`;
}

function webhookSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function connect(request: Request, env: TelegramBotEnv): Promise<Response> {
  const companyId = await resolveCompanyId(env, authUserId(request) || undefined);
  const input = record(await request.json().catch(() => ({})));
  const botToken = text(input.botToken);
  if (!botToken) return json({ error: 'Укажите Bot Token из @BotFather' }, 400);

  let me: Row;
  try {
    me = record((await telegramApi(botToken, 'getMe')).result);
  } catch (error) {
    return json({ error: `Telegram token: ${error instanceof Error ? error.message : String(error)}` }, 400);
  }
  const botId = text(me.id);
  const botUsername = text(me.username);
  const botName = [text(me.first_name), text(me.last_name)].filter(Boolean).join(' ') || botUsername || botId;
  if (!botId) return json({ error: 'Telegram getMe не вернул bot id' }, 400);

  const duplicate = await findByBotId(env, botId);
  if (duplicate && duplicate.companyId !== companyId) {
    return json({ error: 'Этот Telegram bot уже подключён к другой клинике' }, 409);
  }

  const secret = duplicate?.webhookSecret || webhookSecret();
  try {
    await telegramApi(botToken, 'setWebhook', {
      url: webhookUrl(request, botId),
      secret_token: secret,
      allowed_updates: ['message', 'edited_message', 'callback_query'],
      drop_pending_updates: false,
    });
  } catch (error) {
    return json({ error: `Telegram setWebhook: ${error instanceof Error ? error.message : String(error)}` }, 400);
  }

  await saveCredential(env, { companyId, botToken, botId, botUsername, botName, webhookSecret: secret });
  return json({ ok: true, connected: true, botId, botUsername, botName, webhookUrl: webhookUrl(request, botId) });
}

async function config(env: TelegramBotEnv): Promise<Response> {
  const companyId = await resolveCompanyId(env);
  const row = await credentialRow(env, companyId);
  if (!row) return json({ configured: false, connected: false, status: 'not_connected' });
  const summary = record(row.config_summary);
  return json({
    configured: true,
    connected: text(row.status) === 'connected',
    status: text(row.status),
    values: record(summary.values),
    lastVerifiedAt: text(row.last_verified_at) || null,
    lastError: text(row.last_error) || null,
  });
}

async function disconnect(request: Request, env: TelegramBotEnv): Promise<Response> {
  const companyId = await resolveCompanyId(env, authUserId(request) || undefined);
  const row = await credentialRow(env, companyId);
  if (!row) return json({ ok: true, connected: false });
  let credential: TelegramCredential | null = null;
  try { credential = await connectedCredential(env, companyId); } catch { credential = null; }
  if (credential) {
    try {
      await telegramApi(credential.botToken, 'deleteWebhook', { drop_pending_updates: false });
    } catch (error) {
      return json({ error: `Telegram deleteWebhook: ${error instanceof Error ? error.message : String(error)}` }, 409);
    }
  }
  await db<unknown>(env, `integration_credentials?company_id=eq.${encodeURIComponent(companyId)}&user_id=is.null&provider=eq.${PROVIDER}`, {
    method: 'DELETE', headers: { prefer: 'return=minimal' },
  });
  return json({ ok: true, connected: false });
}

function messageBody(message: Row): string {
  const value = text(message.text) || text(message.caption);
  if (value) return value;
  if (message.photo) return '[Фото]';
  if (message.video) return '[Видео]';
  if (message.voice) return '[Голосовое сообщение]';
  if (message.audio) return '[Аудио]';
  if (message.document) return `[Документ${text(record(message.document).file_name) ? `: ${text(record(message.document).file_name)}` : ''}]`;
  if (message.sticker) return '[Стикер]';
  if (message.location) return '[Геолокация]';
  if (message.contact) return '[Контакт]';
  return '[Telegram сообщение]';
}

function senderName(from: Row): string {
  return [text(from.first_name), text(from.last_name)].filter(Boolean).join(' ') || (text(from.username) ? `@${text(from.username)}` : text(from.id));
}

async function upsertLead(env: TelegramBotEnv, credential: TelegramCredential, chatId: string, from: Row, body: string, update: Row): Promise<Row> {
  const externalId = `telegram:${credential.companyId}:${chatId}`;
  const existing = await db<Row[]>(env, `marketing_leads?company_id=eq.${encodeURIComponent(credential.companyId)}&external_id=eq.${encodeURIComponent(externalId)}&select=*&order=updated_at.desc&limit=1`);
  const now = new Date().toISOString();
  const name = senderName(from) || chatId;
  const patch: Row = {
    company_id: credential.companyId,
    name,
    phone: text(existing[0]?.phone),
    source: 'Telegram',
    platform: 'Telegram',
    stage: text(existing[0]?.stage) || 'Новый',
    first_message: text(existing[0]?.first_message) || body,
    lead_created_at: text(existing[0]?.lead_created_at) || now,
    first_contact_at: text(existing[0]?.first_contact_at) || now,
    utm_source: 'telegram',
    utm_medium: 'bot',
    metadata: {
      ...record(existing[0]?.metadata),
      telegram_chat_id: chatId,
      telegram_user_id: text(from.id),
      telegram_username: text(from.username),
      telegram_bot_id: credential.botId,
      telegram_update: update,
    },
    updated_at: now,
  };
  const rows = existing[0]?.id
    ? await db<Row[]>(env, `marketing_leads?id=eq.${encodeURIComponent(text(existing[0].id))}&company_id=eq.${encodeURIComponent(credential.companyId)}&select=*`, { method: 'PATCH', body: JSON.stringify(patch) })
    : await db<Row[]>(env, 'marketing_leads?select=*', { method: 'POST', body: JSON.stringify({ ...patch, external_id: externalId }) });
  if (!rows[0]) throw new Error('Не удалось создать Telegram-лида');
  return rows[0];
}

async function ensureConversation(env: TelegramBotEnv, credential: TelegramCredential, lead: Row, chatId: string, title: string): Promise<Row> {
  const leadId = text(lead.id);
  const existing = await db<Row[]>(env, `marketing_conversations?company_id=eq.${encodeURIComponent(credential.companyId)}&lead_id=eq.${encodeURIComponent(leadId)}&channel=eq.TELEGRAM&archived_at=is.null&select=*&order=updated_at.desc&limit=1`);
  if (existing[0]) return existing[0];
  const now = new Date().toISOString();
  const rows = await db<Row[]>(env, 'marketing_conversations?select=*', {
    method: 'POST',
    body: JSON.stringify({
      company_id: credential.companyId,
      lead_id: leadId,
      contact_id: leadId,
      title: title || `Telegram ${chatId}`,
      phone: null,
      channel: 'TELEGRAM',
      status: 'OPEN',
      unread_count: 0,
      last_message_at: now,
      metadata: { telegram_chat_id: chatId, telegram_bot_id: credential.botId },
      created_at: now,
      updated_at: now,
    }),
  });
  if (!rows[0]) throw new Error('Не удалось создать Telegram-диалог');
  return rows[0];
}

async function saveInbound(env: TelegramBotEnv, credential: TelegramCredential, conversation: Row, message: Row, update: Row): Promise<boolean> {
  const messageId = text(message.message_id);
  const chat = record(message.chat);
  const chatId = text(chat.id);
  if (!messageId || !chatId) return false;
  const externalMessageId = `${credential.botId}:${chatId}:${messageId}`;
  const duplicate = await db<Row[]>(env, `marketing_messages?company_id=eq.${encodeURIComponent(credential.companyId)}&external_message_id=eq.${encodeURIComponent(externalMessageId)}&select=id&limit=1`);
  if (duplicate.length) return false;
  const sentAt = new Date(number(message.date) * 1000 || Date.now()).toISOString();
  const from = record(message.from);
  await db<Row[]>(env, 'marketing_messages?select=id', {
    method: 'POST',
    body: JSON.stringify({
      company_id: credential.companyId,
      conversation_id: text(conversation.id),
      body: messageBody(message),
      direction: 'INBOUND',
      sender_name: senderName(from) || null,
      external_message_id: externalMessageId,
      status: 'DELIVERED',
      sent_at: sentAt,
      metadata: { telegram: update, telegram_chat_id: chatId, telegram_bot_id: credential.botId },
      created_at: sentAt,
    }),
  });
  await db<Row[]>(env, `marketing_conversations?id=eq.${encodeURIComponent(text(conversation.id))}&company_id=eq.${encodeURIComponent(credential.companyId)}&select=id`, {
    method: 'PATCH',
    body: JSON.stringify({ last_message_at: sentAt, updated_at: sentAt, status: 'OPEN', unread_count: number(conversation.unread_count) + 1 }),
  });
  return true;
}

async function webhook(request: Request, env: TelegramBotEnv, botId: string): Promise<Response> {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const credential = await findByBotId(env, botId);
  if (!credential) return json({ error: 'Telegram bot не привязан к клинике' }, 404);
  const supplied = text(request.headers.get('x-telegram-bot-api-secret-token'));
  if (!supplied || supplied !== credential.webhookSecret) return json({ error: 'Invalid Telegram webhook secret' }, 401);
  let update: Row;
  try { update = record(await request.json()); } catch { return json({ error: 'Invalid Telegram update' }, 400); }
  const message = record(update.message || update.edited_message);
  if (!Object.keys(message).length) return json({ ok: true, processed: 0 });
  const chat = record(message.chat);
  const from = record(message.from);
  const chatId = text(chat.id);
  if (!chatId) return json({ ok: true, processed: 0 });
  const body = messageBody(message);
  const lead = await upsertLead(env, credential, chatId, from, body, update);
  const conversation = await ensureConversation(env, credential, lead, chatId, senderName(from));
  const processed = await saveInbound(env, credential, conversation, message, update);
  return json({ ok: true, processed: processed ? 1 : 0 });
}

async function outbound(request: Request, env: TelegramBotEnv, threadId: string): Promise<Response | null> {
  if (request.method !== 'POST') return null;
  const conversations = await db<Row[]>(env, `marketing_conversations?id=eq.${encodeURIComponent(threadId)}&archived_at=is.null&select=*&limit=1`);
  const conversation = conversations[0];
  if (!conversation || text(conversation.channel).toUpperCase() !== 'TELEGRAM') return null;
  const companyId = text(conversation.company_id);
  if (!companyId) return json({ error: 'У Telegram-диалога не определена клиника' }, 409);
  if (text(env.CURRENT_COMPANY_ID) && text(env.CURRENT_COMPANY_ID) !== companyId) return json({ error: 'Telegram-диалог принадлежит другой клинике' }, 403);
  const input = record(await request.clone().json().catch(() => ({})));
  const body = text(input.body);
  if (!body) return json({ error: 'Для Telegram укажите текст сообщения' }, 400);
  if (body.length > 4096) return json({ error: 'Telegram сообщение не должно превышать 4096 символов' }, 400);
  const metadata = record(conversation.metadata);
  const leadId = text(conversation.lead_id) || text(conversation.contact_id);
  let chatId = text(metadata.telegram_chat_id);
  if (!chatId && leadId) {
    const leads = await db<Row[]>(env, `marketing_leads?id=eq.${encodeURIComponent(leadId)}&company_id=eq.${encodeURIComponent(companyId)}&select=metadata,external_id&limit=1`);
    chatId = text(record(leads[0]?.metadata).telegram_chat_id);
  }
  if (!chatId) return json({ error: 'Не найден Telegram chat_id клиента' }, 409);
  const credential = await connectedCredential(env, companyId);
  const result = await telegramApi(credential.botToken, 'sendMessage', { chat_id: chatId, text: body });
  const sent = record(result.result);
  const sentAt = new Date(number(sent.date) * 1000 || Date.now()).toISOString();
  const externalMessageId = `${credential.botId}:${chatId}:${text(sent.message_id)}`;
  const rows = await db<Row[]>(env, 'marketing_messages?select=*', {
    method: 'POST',
    body: JSON.stringify({
      company_id: companyId,
      conversation_id: threadId,
      body,
      direction: 'OUTBOUND',
      sender_name: text(input.senderName) || 'Оператор',
      external_message_id: externalMessageId,
      status: 'SENT',
      sent_at: sentAt,
      read_at: sentAt,
      metadata: { telegram: sent, telegram_chat_id: chatId, telegram_bot_id: credential.botId },
      created_at: sentAt,
    }),
  });
  await db<Row[]>(env, `marketing_conversations?id=eq.${encodeURIComponent(threadId)}&company_id=eq.${encodeURIComponent(companyId)}&select=id`, {
    method: 'PATCH', body: JSON.stringify({ last_message_at: sentAt, updated_at: sentAt, status: 'OPEN' }),
  });
  return json(rows[0] || { ok: true }, 201);
}

export async function handleTelegramPublicRequest(request: Request, env: TelegramBotEnv, url: URL): Promise<Response | null> {
  const match = url.pathname.match(/^\/api\/webhooks\/telegram\/([^/]+)$/);
  if (match) return webhook(request, env, decodeURIComponent(match[1]));
  return null;
}

export async function handleTelegramBotRequest(request: Request, env: TelegramBotEnv, url: URL): Promise<Response | null> {
  if (url.pathname === '/api/integrations/telegram/config' && request.method === 'GET') return config(env);
  if (url.pathname === '/api/integrations/telegram/connect' && request.method === 'POST') return connect(request, env);
  if (url.pathname === '/api/integrations/telegram/disconnect' && request.method === 'DELETE') return disconnect(request, env);
  const messageMatch = url.pathname.match(/^\/api\/callcenter\/threads\/([^/]+)\/messages$/);
  if (messageMatch) return outbound(request, env, decodeURIComponent(messageMatch[1]));
  return null;
}
