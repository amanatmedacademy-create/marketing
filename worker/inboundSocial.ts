import type { Env } from './integrations';

type Row = Record<string, unknown>;

type InboundMessage = {
  channel: 'WHATSAPP' | 'INSTAGRAM';
  leadExternalId: string;
  externalContactId: string;
  externalAccountId: string;
  externalMessageId: string;
  displayName?: string;
  username?: string;
  phone?: string;
  body: string;
  sentAt: string;
  metadata: Row;
};

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});

const record = (value: unknown): Row => value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {};
const list = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const text = (value: unknown): string => typeof value === 'string' ? value.trim() : typeof value === 'number' ? String(value) : '';

function timestamp(value: unknown): string {
  const raw = text(value);
  if (!raw) return new Date().toISOString();
  const numeric = Number(raw);
  const date = Number.isFinite(numeric)
    ? new Date(numeric < 10_000_000_000 ? numeric * 1000 : numeric)
    : new Date(raw);
  return Number.isFinite(date.getTime()) ? date.toISOString() : new Date().toISOString();
}

async function hmac(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const result = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  return Array.from(new Uint8Array(result), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function secureEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

function whatsappBody(message: Row): string {
  const type = text(message.type);
  if (type === 'text') return text(record(message.text).body);
  if (type === 'button') return text(record(message.button).text) || '[Кнопка]';
  if (type === 'interactive') {
    const interactive = record(message.interactive);
    const reply = record(interactive.button_reply || interactive.list_reply);
    return text(reply.title) || text(reply.id) || '[Интерактивный ответ]';
  }
  if (type === 'image') return text(record(message.image).caption) || '[Изображение]';
  if (type === 'video') return text(record(message.video).caption) || '[Видео]';
  if (type === 'document') return text(record(message.document).caption) || text(record(message.document).filename) || '[Документ]';
  if (type === 'audio') return '[Аудиосообщение]';
  if (type === 'voice') return '[Голосовое сообщение]';
  if (type === 'sticker') return '[Стикер]';
  if (type === 'location') return '[Геолокация]';
  if (type === 'contacts') return '[Контакт]';
  return type ? `[${type}]` : '[Сообщение без текста]';
}

function parseWhatsApp(payload: Row): InboundMessage[] {
  const result: InboundMessage[] = [];
  for (const entryValue of list(payload.entry)) {
    const entry = record(entryValue);
    for (const changeValue of list(entry.changes)) {
      const change = record(changeValue);
      if (text(change.field) !== 'messages') continue;
      const value = record(change.value);
      const metadata = record(value.metadata);
      const accountId = text(metadata.phone_number_id) || text(entry.id);
      const contactNames = new Map<string, string>();
      for (const contactValue of list(value.contacts)) {
        const contact = record(contactValue);
        const waId = text(contact.wa_id);
        const name = text(record(contact.profile).name);
        if (waId && name) contactNames.set(waId, name);
      }
      for (const messageValue of list(value.messages)) {
        const message = record(messageValue);
        const from = text(message.from);
        const id = text(message.id);
        if (!from || !id) continue;
        result.push({
          channel: 'WHATSAPP',
          leadExternalId: `whatsapp:${from}`,
          externalContactId: from,
          externalAccountId: accountId,
          externalMessageId: id,
          displayName: contactNames.get(from),
          phone: from,
          body: whatsappBody(message),
          sentAt: timestamp(message.timestamp),
          metadata: { provider: 'meta', object: 'whatsapp_business_account', message, accountId },
        });
      }
    }
  }
  return result;
}

function instagramBody(message: Row): string {
  if (text(message.text)) return text(message.text);
  const attachments = list(message.attachments);
  if (attachments.length) {
    const first = record(attachments[0]);
    const type = text(first.type);
    return type ? `[Вложение: ${type}]` : '[Вложение]';
  }
  if (message.is_deleted === true) return '[Сообщение удалено]';
  return '[Сообщение без текста]';
}

function parseInstagram(payload: Row): InboundMessage[] {
  const result: InboundMessage[] = [];
  for (const entryValue of list(payload.entry)) {
    const entry = record(entryValue);
    const accountId = text(entry.id);
    for (const eventValue of list(entry.messaging)) {
      const event = record(eventValue);
      const senderId = text(record(event.sender).id);
      const recipientId = text(record(event.recipient).id) || accountId;
      const message = record(event.message);
      const messageId = text(message.mid);
      if (!senderId || !messageId || message.is_echo === true) continue;
      result.push({
        channel: 'INSTAGRAM',
        leadExternalId: `instagram:${senderId}`,
        externalContactId: senderId,
        externalAccountId: recipientId,
        externalMessageId: messageId,
        username: text(record(event.sender).username) || undefined,
        displayName: text(record(event.sender).name) || undefined,
        body: instagramBody(message),
        sentAt: timestamp(event.timestamp),
        metadata: { provider: 'meta', object: 'instagram', event, accountId: recipientId },
      });
    }
  }
  return result;
}

async function ingest(env: Env, message: InboundMessage): Promise<Row> {
  const response = await fetch(`${env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/rpc/marketing_ingest_inbound_message`, {
    method: 'POST',
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      p_channel: message.channel,
      p_lead_external_id: message.leadExternalId,
      p_external_contact_id: message.externalContactId,
      p_external_account_id: message.externalAccountId,
      p_external_message_id: message.externalMessageId,
      p_display_name: message.displayName || null,
      p_username: message.username || null,
      p_phone: message.phone || null,
      p_body: message.body,
      p_sent_at: message.sentAt,
      p_metadata: message.metadata,
    }),
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`Inbound social ingest ${response.status}: ${body.slice(0, 1000)}`);
  return body ? record(JSON.parse(body)) : {};
}

export async function handleInboundSocialWebhook(request: Request, env: Env, url: URL): Promise<Response | null> {
  if (url.pathname !== '/api/webhooks/meta') return null;

  if (request.method === 'GET') {
    const mode = url.searchParams.get('hub.mode');
    const token = url.searchParams.get('hub.verify_token');
    const challenge = url.searchParams.get('hub.challenge') || '';
    if (mode === 'subscribe' && token && env.META_WEBHOOK_VERIFY_TOKEN && secureEqual(token, env.META_WEBHOOK_VERIFY_TOKEN)) {
      return new Response(challenge, { status: 200 });
    }
    return new Response('Forbidden', { status: 403 });
  }

  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const body = await request.text();
  if (env.META_APP_SECRET) {
    const supplied = request.headers.get('x-hub-signature-256') || '';
    const expected = `sha256=${await hmac(env.META_APP_SECRET, body)}`;
    if (!supplied || !secureEqual(supplied, expected)) return json({ error: 'Invalid Meta signature' }, 401);
  }

  let payload: Row;
  try {
    payload = record(JSON.parse(body || '{}'));
  } catch {
    return json({ error: 'Invalid JSON payload' }, 400);
  }

  const object = text(payload.object);
  const messages = object === 'whatsapp_business_account'
    ? parseWhatsApp(payload)
    : object === 'instagram'
      ? parseInstagram(payload)
      : [];

  if (!messages.length) return null;

  const results: Row[] = [];
  for (const message of messages) results.push(await ingest(env, message));
  return json({ ok: true, processed: results.length, results });
}
