import { resolveCompanyId } from './companyContext';

type Row = Record<string, unknown>;

type WabaCredential = {
  companyId: string;
  accessToken: string;
  wabaId: string;
  phoneNumberId: string;
  graphVersion: string;
};

export interface WabaMessagingEnv {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  INTEGRATION_ENCRYPTION_KEY?: string;
  META_APP_SECRET?: string;
  META_WEBHOOK_VERIFY_TOKEN?: string;
  META_GRAPH_VERSION?: string;
  META_ACCESS_TOKEN?: string;
}

const STORAGE_BUCKET = 'marketing-chat-attachments';
const MAX_MEDIA_BYTES = 25 * 1024 * 1024;

const record = (value: unknown): Row => value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {};
const text = (value: unknown): string => typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim();
const number = (value: unknown): number => typeof value === 'number' && Number.isFinite(value) ? value : Number(value || 0) || 0;
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});

function graphVersion(value?: string): string {
  const version = text(value) || 'v23.0';
  return version.startsWith('v') ? version : `v${version}`;
}

function authHeaders(env: WabaMessagingEnv, extra: HeadersInit = {}): Headers {
  const headers = new Headers(extra);
  headers.set('apikey', env.SUPABASE_SERVICE_ROLE_KEY);
  headers.set('authorization', `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`);
  return headers;
}

async function db<T>(env: WabaMessagingEnv, path: string, init: RequestInit = {}): Promise<T> {
  const headers = authHeaders(env, init.headers);
  headers.set('accept', 'application/json');
  if (init.body != null) headers.set('content-type', 'application/json');
  if (init.method && !['GET', 'HEAD'].includes(init.method) && !headers.has('prefer')) headers.set('prefer', 'return=representation');
  const response = await fetch(`${env.SUPABASE_URL.replace(/\/+$/, '')}/rest/v1/${path}`, { ...init, headers });
  const body = await response.text();
  if (!response.ok) throw new Error(`Supabase ${response.status}: ${body.slice(0, 2000)}`);
  return (body ? JSON.parse(body) : null) as T;
}

function secureEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let result = 0;
  for (let index = 0; index < left.length; index += 1) result |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return result === 0;
}

async function hmacSha256(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

async function decryptCredential(env: WabaMessagingEnv, row: Row): Promise<WabaCredential | null> {
  const companyId = text(row.company_id);
  const encrypted = text(row.encrypted_payload);
  const iv = text(row.iv);
  if (!companyId || !encrypted || !iv) return null;
  const secret = text(env.INTEGRATION_ENCRYPTION_KEY) || `imds-integrations:v1:${env.SUPABASE_SERVICE_ROLE_KEY}`;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret));
  const key = await crypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, ['decrypt']);
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: base64ToBytes(iv) }, key, base64ToBytes(encrypted));
  const payload = record(JSON.parse(new TextDecoder().decode(decrypted)));
  const accessToken = text(payload.accessToken);
  const phoneNumberId = text(payload.phoneNumberId);
  if (!accessToken || !phoneNumberId) return null;
  return {
    companyId,
    accessToken,
    phoneNumberId,
    wabaId: text(payload.wabaId),
    graphVersion: graphVersion(text(payload.graphVersion) || env.META_GRAPH_VERSION),
  };
}

async function listWabaCredentials(env: WabaMessagingEnv): Promise<WabaCredential[]> {
  const rows = await db<Row[]>(env, 'integration_credentials?provider=eq.waba&status=eq.connected&select=company_id,encrypted_payload,iv');
  const credentials: WabaCredential[] = [];
  for (const row of rows) {
    try {
      const credential = await decryptCredential(env, row);
      if (credential) credentials.push(credential);
    } catch (error) {
      console.error('Unable to decrypt WABA credential', error);
    }
  }
  return credentials;
}

async function findCredential(
  env: WabaMessagingEnv,
  options: { phoneNumberId?: string; companyId?: string } = {},
): Promise<WabaCredential> {
  const credentials = await listWabaCredentials(env);
  const selected = credentials.find((item) =>
    (!options.phoneNumberId || item.phoneNumberId === options.phoneNumberId)
    && (!options.companyId || item.companyId === options.companyId));
  if (!selected) throw new Error('Подключённая WABA для этой клиники не найдена');
  return selected;
}

function safeFilename(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 120) || 'whatsapp-media';
}

async function storageUpload(env: WabaMessagingEnv, path: string, body: ArrayBuffer, mimeType: string): Promise<void> {
  const response = await fetch(`${env.SUPABASE_URL.replace(/\/+$/, '')}/storage/v1/object/${STORAGE_BUCKET}/${path}`, {
    method: 'POST',
    headers: authHeaders(env, { 'content-type': mimeType, 'x-upsert': 'false' }),
    body,
  });
  if (!response.ok) throw new Error(`Storage upload ${response.status}: ${(await response.text()).slice(0, 1000)}`);
}

async function storageDownload(env: WabaMessagingEnv, path: string): Promise<Response> {
  const response = await fetch(`${env.SUPABASE_URL.replace(/\/+$/, '')}/storage/v1/object/${STORAGE_BUCKET}/${path}`, {
    headers: authHeaders(env),
  });
  if (!response.ok) throw new Error(`Storage download ${response.status}: ${(await response.text()).slice(0, 1000)}`);
  return response;
}

async function graphJson(url: string, accessToken: string, init: RequestInit = {}): Promise<Row> {
  const headers = new Headers(init.headers);
  headers.set('authorization', `Bearer ${accessToken}`);
  headers.set('accept', 'application/json');
  if (init.body && !(init.body instanceof FormData)) headers.set('content-type', 'application/json');
  const response = await fetch(url, { ...init, headers });
  const body = await response.text();
  let payload: Row = {};
  try { payload = record(body ? JSON.parse(body) : {}); } catch { payload = { raw: body }; }
  if (!response.ok || payload.error) throw new Error(`Meta Graph ${response.status}: ${JSON.stringify(payload).slice(0, 1800)}`);
  return payload;
}

async function downloadMetaMedia(credential: WabaCredential, mediaId: string): Promise<{ bytes: ArrayBuffer; mimeType: string; filename: string }> {
  const metadata = await graphJson(`https://graph.facebook.com/${credential.graphVersion}/${encodeURIComponent(mediaId)}`, credential.accessToken);
  const url = text(metadata.url);
  if (!url) throw new Error('Meta не вернула URL медиафайла');
  const response = await fetch(url, { headers: { authorization: `Bearer ${credential.accessToken}` } });
  if (!response.ok) throw new Error(`WhatsApp media download ${response.status}`);
  const bytes = await response.arrayBuffer();
  if (!bytes.byteLength || bytes.byteLength > MAX_MEDIA_BYTES) throw new Error('Медиафайл WhatsApp превышает допустимый размер');
  const mimeType = response.headers.get('content-type') || text(metadata.mime_type) || 'application/octet-stream';
  const extension = mimeType.split('/')[1]?.split(';')[0]?.replace('jpeg', 'jpg') || 'bin';
  return { bytes, mimeType, filename: `whatsapp-${mediaId}.${extension}` };
}

function inboundBody(message: Row): string {
  const type = text(message.type);
  if (type === 'text') return text(record(message.text).body);
  if (type === 'button') return text(record(message.button).text);
  if (type === 'interactive') {
    const interactive = record(message.interactive);
    return text(record(interactive.button_reply).title) || text(record(interactive.list_reply).title) || '[Интерактивный ответ]';
  }
  const media = record(message[type]);
  return text(media.caption) || `[${type || 'сообщение'}]`;
}

async function upsertLead(env: WabaMessagingEnv, companyId: string, phone: string, name: string, message: Row): Promise<Row> {
  const referral = record(message.referral);
  const sourceId = text(referral.source_id);
  const sourceUrl = text(referral.source_url);
  const headline = text(referral.headline);
  const referralBody = text(referral.body);
  const mediaType = text(referral.media_type);
  const mediaUrl = text(referral.image_url) || text(referral.video_url) || text(referral.thumbnail_url);
  const existing = await db<Row[]>(env, `marketing_leads?company_id=eq.${encodeURIComponent(companyId)}&phone=eq.${encodeURIComponent(phone)}&select=*&order=updated_at.desc&limit=1`);
  const now = new Date().toISOString();
  const patch: Row = {
    company_id: companyId,
    name: name || phone,
    phone,
    source: sourceId ? 'Meta Click-to-WhatsApp' : 'WhatsApp',
    platform: 'Meta',
    stage: existing[0]?.stage || 'Новый',
    first_message: existing[0]?.first_message || inboundBody(message),
    lead_created_at: existing[0]?.lead_created_at || now,
    first_contact_at: existing[0]?.first_contact_at || now,
    utm_source: sourceId ? 'meta' : 'whatsapp',
    utm_medium: sourceId ? 'click_to_whatsapp' : 'organic_message',
    campaign: headline || existing[0]?.campaign || null,
    ad_id: sourceId || existing[0]?.ad_id || null,
    referral_source_url: sourceUrl || existing[0]?.referral_source_url || null,
    referral_source_id: sourceId || existing[0]?.referral_source_id || null,
    referral_source_type: text(referral.source_type) || existing[0]?.referral_source_type || null,
    referral_headline: headline || existing[0]?.referral_headline || null,
    referral_body: referralBody || existing[0]?.referral_body || null,
    referral_media_type: mediaType || existing[0]?.referral_media_type || null,
    referral_media_url: mediaUrl || existing[0]?.referral_media_url || null,
    metadata: { ...record(existing[0]?.metadata), whatsapp_referral: Object.keys(referral).length ? referral : undefined },
    updated_at: now,
  };
  const rows = existing[0]?.id
    ? await db<Row[]>(env, `marketing_leads?id=eq.${encodeURIComponent(text(existing[0].id))}&select=*`, { method: 'PATCH', body: JSON.stringify(patch) })
    : await db<Row[]>(env, 'marketing_leads?select=*', { method: 'POST', body: JSON.stringify({ ...patch, external_id: `waba:${phone}` }) });
  if (!rows[0]) throw new Error('Не удалось создать карточку WhatsApp-лида');
  return rows[0];
}

async function ensureConversation(env: WabaMessagingEnv, companyId: string, lead: Row, phone: string, name: string): Promise<Row> {
  const leadId = text(lead.id);
  const existing = await db<Row[]>(env, `marketing_conversations?company_id=eq.${encodeURIComponent(companyId)}&lead_id=eq.${encodeURIComponent(leadId)}&channel=eq.WHATSAPP&archived_at=is.null&select=*&order=updated_at.desc&limit=1`);
  if (existing[0]) return existing[0];
  const now = new Date().toISOString();
  const rows = await db<Row[]>(env, 'marketing_conversations?select=*', {
    method: 'POST',
    body: JSON.stringify({ company_id: companyId, lead_id: leadId, contact_id: leadId, title: name || phone, phone, channel: 'WHATSAPP', status: 'OPEN', unread_count: 0, last_message_at: now, created_at: now, updated_at: now }),
  });
  if (!rows[0]) throw new Error('Не удалось создать WhatsApp-диалог');
  return rows[0];
}

async function saveInboundMessage(env: WabaMessagingEnv, credential: WabaCredential, conversation: Row, message: Row, senderName: string): Promise<void> {
  const messageId = text(message.id);
  if (!messageId) return;
  const duplicate = await db<Row[]>(env, `marketing_messages?company_id=eq.${encodeURIComponent(credential.companyId)}&external_message_id=eq.${encodeURIComponent(messageId)}&select=id&limit=1`);
  if (duplicate.length) return;
  const type = text(message.type);
  const media = record(message[type]);
  let attachmentPath: string | null = null;
  let attachmentName: string | null = null;
  let attachmentMimeType: string | null = null;
  let attachmentSizeBytes: number | null = null;
  const mediaId = ['image', 'video', 'audio', 'document', 'sticker'].includes(type) ? text(media.id) : '';
  if (mediaId) {
    const downloaded = await downloadMetaMedia(credential, mediaId);
    attachmentName = safeFilename(text(media.filename) || downloaded.filename);
    attachmentMimeType = downloaded.mimeType;
    attachmentSizeBytes = downloaded.bytes.byteLength;
    attachmentPath = `${text(conversation.id)}/${crypto.randomUUID()}-${attachmentName}`;
    await storageUpload(env, attachmentPath, downloaded.bytes, attachmentMimeType);
  }
  const sentAt = new Date(number(message.timestamp) * 1000 || Date.now()).toISOString();
  await db<Row[]>(env, 'marketing_messages?select=id', {
    method: 'POST',
    body: JSON.stringify({
      company_id: credential.companyId,
      conversation_id: text(conversation.id),
      body: inboundBody(message) || (attachmentName ? `Вложение: ${attachmentName}` : '[WhatsApp сообщение]'),
      direction: 'INBOUND',
      sender_name: senderName || null,
      external_message_id: messageId,
      status: 'DELIVERED',
      sent_at: sentAt,
      attachment_path: attachmentPath,
      attachment_name: attachmentName,
      attachment_mime_type: attachmentMimeType,
      attachment_size_bytes: attachmentSizeBytes,
      metadata: { whatsapp: message, referral: message.referral || null },
      created_at: sentAt,
    }),
  });
  await db<Row[]>(env, `marketing_conversations?company_id=eq.${encodeURIComponent(credential.companyId)}&id=eq.${encodeURIComponent(text(conversation.id))}&select=id`, {
    method: 'PATCH',
    body: JSON.stringify({ last_message_at: sentAt, updated_at: sentAt, status: 'OPEN', unread_count: number(conversation.unread_count) + 1 }),
  });
}

async function handleInboundWebhook(request: Request, env: WabaMessagingEnv): Promise<Response> {
  const url = new URL(request.url);
  if (request.method === 'GET') {
    const mode = url.searchParams.get('hub.mode');
    const token = url.searchParams.get('hub.verify_token') || '';
    const challenge = url.searchParams.get('hub.challenge') || '';
    if (mode === 'subscribe' && env.META_WEBHOOK_VERIFY_TOKEN && secureEqual(token, env.META_WEBHOOK_VERIFY_TOKEN)) return new Response(challenge);
    return new Response('Forbidden', { status: 403 });
  }
  const body = await request.text();
  if (env.META_APP_SECRET) {
    const supplied = request.headers.get('x-hub-signature-256') || '';
    const expected = `sha256=${await hmacSha256(env.META_APP_SECRET, body)}`;
    if (!secureEqual(supplied, expected)) return json({ error: 'Invalid Meta signature' }, 401);
  }
  const payload = record(JSON.parse(body || '{}'));
  let processed = 0;
  const entries = Array.isArray(payload.entry) ? payload.entry.map(record) : [];
  for (const entry of entries) {
    const changes = Array.isArray(entry.changes) ? entry.changes.map(record) : [];
    for (const change of changes) {
      const value = record(change.value);
      const metadata = record(value.metadata);
      const phoneNumberId = text(metadata.phone_number_id);
      const credential = await findCredential(env, { phoneNumberId });
      const companyId = credential.companyId;
      const contacts = Array.isArray(value.contacts) ? value.contacts.map(record) : [];
      const contactMap = new Map(contacts.map((contact) => [text(contact.wa_id), text(record(contact.profile).name)]));
      const messages = Array.isArray(value.messages) ? value.messages.map(record) : [];
      for (const message of messages) {
        const phone = text(message.from);
        if (!phone) continue;
        const name = contactMap.get(phone) || phone;
        const lead = await upsertLead(env, companyId, phone, name, message);
        const conversation = await ensureConversation(env, companyId, lead, phone, name);
        await saveInboundMessage(env, credential, conversation, message, name);
        processed += 1;
      }
    }
  }
  return json({ ok: true, processed });
}

async function uploadOutboundMedia(env: WabaMessagingEnv, credential: WabaCredential, attachmentPath: string, filename: string, mimeType: string): Promise<string> {
  const stored = await storageDownload(env, attachmentPath);
  const bytes = await stored.arrayBuffer();
  const form = new FormData();
  form.set('messaging_product', 'whatsapp');
  form.set('file', new File([bytes], filename, { type: mimeType }));
  const result = await graphJson(`https://graph.facebook.com/${credential.graphVersion}/${credential.phoneNumberId}/media`, credential.accessToken, { method: 'POST', body: form });
  const id = text(result.id);
  if (!id) throw new Error('Meta не вернула media ID');
  return id;
}

async function sendOutboundMessage(env: WabaMessagingEnv, request: Request, threadId: string): Promise<Response | null> {
  if (request.method !== 'POST') return null;
  const conversations = await db<Row[]>(env, `marketing_conversations?id=eq.${encodeURIComponent(threadId)}&select=*&limit=1`);
  const conversation = conversations[0];
  if (!conversation || text(conversation.channel) !== 'WHATSAPP') return null;
  const companyId = text(conversation.company_id);
  if (!companyId) return json({ error: 'У WhatsApp-диалога не указан company_id' }, 409);
  const input = record(await request.json().catch(() => ({})));
  const body = text(input.body);
  const attachment = record(input.attachment);
  if (!body && !text(attachment.base64)) return json({ error: 'Сообщение и вложение отсутствуют' }, 400);
  const phone = text(conversation.phone).replace(/\D/g, '');
  if (!phone) return json({ error: 'В WhatsApp-диалоге не указан телефон' }, 400);
  const credential = await findCredential(env, { companyId });
  const sentAt = new Date().toISOString();
  let attachmentPath: string | null = null;
  let attachmentName: string | null = null;
  let attachmentMimeType: string | null = null;
  let attachmentSizeBytes: number | null = null;
  let whatsappType = 'text';
  let whatsappPayload: Row = { messaging_product: 'whatsapp', recipient_type: 'individual', to: phone, type: 'text', text: { body } };
  if (text(attachment.base64)) {
    const bytes = base64ToBytes(text(attachment.base64).replace(/^data:[^;]+;base64,/, ''));
    if (!bytes.byteLength || bytes.byteLength > MAX_MEDIA_BYTES) return json({ error: 'Размер вложения превышает 25 МБ' }, 400);
    attachmentName = safeFilename(text(attachment.name) || 'attachment');
    attachmentMimeType = text(attachment.mimeType) || 'application/octet-stream';
    attachmentSizeBytes = bytes.byteLength;
    attachmentPath = `${threadId}/${crypto.randomUUID()}-${attachmentName}`;
    await storageUpload(env, attachmentPath, bytes.buffer, attachmentMimeType);
    const mediaId = await uploadOutboundMedia(env, credential, attachmentPath, attachmentName, attachmentMimeType);
    whatsappType = attachmentMimeType.startsWith('image/') ? 'image'
      : attachmentMimeType.startsWith('video/') ? 'video'
      : attachmentMimeType.startsWith('audio/') ? 'audio'
      : 'document';
    whatsappPayload = {
      messaging_product: 'whatsapp', recipient_type: 'individual', to: phone, type: whatsappType,
      [whatsappType]: { id: mediaId, ...(body ? { caption: body } : {}), ...(whatsappType === 'document' ? { filename: attachmentName } : {}) },
    };
  }
  const result = await graphJson(`https://graph.facebook.com/${credential.graphVersion}/${credential.phoneNumberId}/messages`, credential.accessToken, {
    method: 'POST', body: JSON.stringify(whatsappPayload),
  });
  const externalMessageId = text(record((Array.isArray(result.messages) ? result.messages[0] : null)).id);
  const rows = await db<Row[]>(env, 'marketing_messages?select=*', {
    method: 'POST',
    body: JSON.stringify({
      company_id: companyId,
      conversation_id: threadId,
      body: body || (attachmentName ? `Вложение: ${attachmentName}` : ''),
      direction: 'OUTBOUND',
      sender_name: text(input.senderName) || 'Оператор',
      external_message_id: externalMessageId || null,
      status: 'SENT',
      sent_at: sentAt,
      read_at: sentAt,
      attachment_path: attachmentPath,
      attachment_name: attachmentName,
      attachment_mime_type: attachmentMimeType,
      attachment_size_bytes: attachmentSizeBytes,
      metadata: { whatsapp: result, whatsapp_type: whatsappType },
      created_at: sentAt,
    }),
  });
  await db<Row[]>(env, `marketing_conversations?company_id=eq.${encodeURIComponent(companyId)}&id=eq.${encodeURIComponent(threadId)}&select=id`, {
    method: 'PATCH', body: JSON.stringify({ last_message_at: sentAt, updated_at: sentAt, status: 'OPEN' }),
  });
  return json(rows[0] || { ok: true }, 201);
}

async function sha256(value: string): Promise<string> {
  const normalized = value.trim().toLowerCase();
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(normalized));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function handleConversions(request: Request, env: WabaMessagingEnv): Promise<Response> {
  const input = record(await request.json().catch(() => ({})));
  const leadId = text(input.leadId);
  const datasetId = text(input.datasetId);
  const eventName = text(input.eventName) || 'Lead';
  if (!leadId || !datasetId) return json({ error: 'Нужны leadId и datasetId' }, 400);
  const leads = await db<Row[]>(env, `marketing_leads?id=eq.${encodeURIComponent(leadId)}&select=*&limit=1`);
  const lead = leads[0];
  if (!lead) return json({ error: 'Лид не найден' }, 404);
  const companyId = text(lead.company_id) || await resolveCompanyId(env);
  const credential = await findCredential(env, { companyId }).catch(() => null);
  const accessToken = text(env.META_ACCESS_TOKEN) || credential?.accessToken || '';
  if (!accessToken) return json({ error: 'Meta access token не настроен' }, 503);
  const eventId = text(input.eventId) || `lead:${leadId}:${eventName}:${Date.now()}`;
  const userData: Row = {};
  const phone = text(lead.phone).replace(/\D/g, '');
  const email = text(lead.email);
  if (phone) userData.ph = [await sha256(phone)];
  if (email) userData.em = [await sha256(email)];
  const customData: Row = {
    lead_event_source: text(lead.source) || 'WhatsApp',
    campaign_id: text(lead.campaign_id) || undefined,
    ad_id: text(lead.ad_id) || text(lead.referral_source_id) || undefined,
  };
  if (input.value != null) customData.value = number(input.value);
  if (text(input.currency)) customData.currency = text(input.currency).toUpperCase();
  const event = {
    event_name: eventName,
    event_time: Math.floor(Date.now() / 1000),
    event_id: eventId,
    action_source: 'business_messaging',
    messaging_channel: 'whatsapp',
    user_data: userData,
    custom_data: customData,
  };
  const inserted = await db<Row[]>(env, 'meta_conversion_events?select=*', {
    method: 'POST',
    body: JSON.stringify({ company_id: companyId, lead_id: leadId, dataset_id: datasetId, event_name: eventName, event_id: eventId, value: input.value ?? null, currency: text(input.currency) || null, status: 'pending' }),
  });
  const rowId = text(inserted[0]?.id);
  try {
    const response = await graphJson(`https://graph.facebook.com/${graphVersion(env.META_GRAPH_VERSION)}/${encodeURIComponent(datasetId)}/events`, accessToken, {
      method: 'POST', body: JSON.stringify({ data: [event], ...(text(input.testEventCode) ? { test_event_code: text(input.testEventCode) } : {}) }),
    });
    if (rowId) await db<Row[]>(env, `meta_conversion_events?id=eq.${encodeURIComponent(rowId)}&select=id`, { method: 'PATCH', body: JSON.stringify({ status: 'sent', response, updated_at: new Date().toISOString() }) });
    return json({ ok: true, eventId, response });
  } catch (error) {
    if (rowId) await db<Row[]>(env, `meta_conversion_events?id=eq.${encodeURIComponent(rowId)}&select=id`, { method: 'PATCH', body: JSON.stringify({ status: 'failed', error: error instanceof Error ? error.message : String(error), updated_at: new Date().toISOString() }) });
    throw error;
  }
}

export async function handleWabaMessagingRequest(request: Request, env: WabaMessagingEnv, url: URL): Promise<Response | null> {
  if (url.pathname === '/api/webhooks/waba' && ['GET', 'POST'].includes(request.method)) return handleInboundWebhook(request, env);
  const messageMatch = url.pathname.match(/^\/api\/callcenter\/threads\/([^/]+)\/messages$/);
  if (messageMatch) return sendOutboundMessage(env, request, decodeURIComponent(messageMatch[1]));
  if (url.pathname === '/api/integrations/meta/conversions' && request.method === 'POST') return handleConversions(request, env);
  return null;
}
