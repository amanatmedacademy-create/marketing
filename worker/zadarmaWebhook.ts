import { hydrateIntegrationEnv, type CredentialSecrets } from './credentials';
import type { ZadarmaTelephonyEnv } from './zadarmaTelephony';

type Row = Record<string, unknown>;
type WebhookEnv = ZadarmaTelephonyEnv & CredentialSecrets & {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  DEFAULT_COMPANY_ID?: string;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const text = (value: unknown): string => typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim();
const digits = (value: unknown): string => text(value).replace(/\D/g, '').slice(0, 20);
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });

function normalizedPhone(value: unknown): string {
  let valueDigits = digits(value);
  if (valueDigits.length === 11 && valueDigits.startsWith('8')) valueDigits = `7${valueDigits.slice(1)}`;
  if (valueDigits.length === 10) valueDigits = `7${valueDigits}`;
  return valueDigits ? `+${valueDigits}` : '';
}

function secureEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let result = 0;
  for (let index = 0; index < left.length; index += 1) result |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return result === 0;
}

async function hmacSha1Base64(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const signed = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value)));
  const hex = Array.from(signed, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return btoa(hex);
}

function dbHeaders(env: WebhookEnv, extra: HeadersInit = {}): Headers {
  const headers = new Headers(extra);
  headers.set('apikey', env.SUPABASE_SERVICE_ROLE_KEY);
  headers.set('authorization', `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`);
  headers.set('content-type', 'application/json');
  headers.set('accept', 'application/json');
  return headers;
}

async function db<T>(env: WebhookEnv, path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/${path}`, { ...init, headers: dbHeaders(env, init.headers), cache: 'no-store' });
  const body = await response.text();
  if (!response.ok) throw new Error(`Zadarma webhook DB ${response.status}: ${body.slice(0, 1200)}`);
  return (body ? JSON.parse(body) : null) as T;
}

async function payloadFrom(request: Request): Promise<Row> {
  const contentType = request.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    const value = await request.json().catch(() => ({}));
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {};
  }
  const raw = await request.text();
  const params = new URLSearchParams(raw);
  return Object.fromEntries(params.entries());
}

function signatureInput(event: string, payload: Row): string {
  if (event === 'NOTIFY_RECORD') return `${text(payload.pbx_call_id)}${text(payload.call_id_with_rec)}`;
  if (event === 'NOTIFY_OUT_START' || event === 'NOTIFY_OUT_END') {
    return `${text(payload.internal)}${text(payload.destination)}${text(payload.call_start)}`;
  }
  if (event === 'NOTIFY_START' || event === 'NOTIFY_END') {
    return `${text(payload.caller_id)}${text(payload.called_did)}${text(payload.call_start)}`;
  }
  return '';
}

async function verifySignature(request: Request, env: WebhookEnv, event: string, payload: Row): Promise<boolean> {
  const supplied = text(request.headers.get('signature'));
  const secret = text(env.ZADARMA_API_SECRET);
  const input = signatureInput(event, payload);
  if (!supplied || !secret || !input) return false;
  const expected = await hmacSha1Base64(secret, input);
  return secureEqual(supplied, expected);
}

async function recordWebhookEvent(env: WebhookEnv, companyId: string, event: string, payload: Row): Promise<void> {
  const now = new Date().toISOString();
  await db(env, 'telephony_settings?on_conflict=company_id', {
    method: 'POST',
    headers: { prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({
      company_id: companyId,
      provider: 'zadarma',
      last_webhook_event_at: now,
      last_webhook_event_type: event,
      last_webhook_pbx_call_id: text(payload.pbx_call_id) || null,
      webhook_last_error: null,
      updated_at: now,
    }),
  });
}

async function telephonySettings(env: WebhookEnv, companyId: string): Promise<Row> {
  const rows = await db<Row[]>(env, `telephony_settings?company_id=eq.${encodeURIComponent(companyId)}&select=inbound_capture_enabled,missed_call_tasks_enabled,missed_call_task_delay_minutes&limit=1`);
  return rows[0] || { inbound_capture_enabled: true, missed_call_tasks_enabled: true, missed_call_task_delay_minutes: 0 };
}

async function findCallByPbx(env: WebhookEnv, companyId: string, pbxCallId: string): Promise<Row | null> {
  if (!pbxCallId) return null;
  const rows = await db<Row[]>(env, `marketing_calls?company_id=eq.${encodeURIComponent(companyId)}&pbx_call_id=eq.${encodeURIComponent(pbxCallId)}&select=*&limit=1`);
  return rows[0] || null;
}

async function findCorrelationByPbx(env: WebhookEnv, companyId: string, pbxCallId: string): Promise<Row | null> {
  if (!pbxCallId) return null;
  const rows = await db<Row[]>(env, `telephony_callback_requests?company_id=eq.${encodeURIComponent(companyId)}&pbx_call_id=eq.${encodeURIComponent(pbxCallId)}&select=*&limit=1`);
  return rows[0] || null;
}

async function findOrCreateInboundLead(env: WebhookEnv, companyId: string, phone: string, now: string): Promise<Row | null> {
  if (!phone) return null;
  const bare = phone.replace(/^\+/, '');
  const rows = await db<Row[]>(env, `marketing_leads?company_id=eq.${encodeURIComponent(companyId)}&or=(phone.eq.${encodeURIComponent(phone)},phone.eq.${encodeURIComponent(bare)})&select=id,name,phone,stage,manager,created_at&order=lead_created_at.desc&limit=1`);
  if (rows[0]) return rows[0];

  const created = await db<Row[]>(env, 'marketing_leads?select=id,name,phone,stage,manager,created_at', {
    method: 'POST',
    headers: { prefer: 'return=representation' },
    body: JSON.stringify({
      company_id: companyId,
      name: `Входящий звонок ${phone}`,
      phone,
      source: 'Zadarma',
      platform: 'Phone',
      stage: 'NEW',
      first_message: 'Первичное обращение по входящему звонку',
      direction: 'INBOUND',
      lead_created_at: now,
      metadata: { created_by: 'zadarma_inbound_webhook' },
      created_at: now,
      updated_at: now,
    }),
  });
  return created[0] || null;
}

async function captureInboundStart(env: WebhookEnv, companyId: string, payload: Row): Promise<Row | null> {
  const pbxCallId = text(payload.pbx_call_id);
  const phone = normalizedPhone(payload.caller_id);
  if (!pbxCallId || !phone) return null;
  const existing = await findCallByPbx(env, companyId, pbxCallId);
  if (existing) return existing;

  const settings = await telephonySettings(env, companyId);
  if (settings.inbound_capture_enabled === false) return null;
  const now = new Date().toISOString();
  const lead = await findOrCreateInboundLead(env, companyId, phone, now);
  const startedAt = text(payload.call_start) || now;
  try {
    const calls = await db<Row[]>(env, 'marketing_calls?select=*', {
      method: 'POST',
      headers: { prefer: 'return=representation' },
      body: JSON.stringify({
        company_id: companyId,
        lead_id: text(lead?.id) || null,
        client_name: text(lead?.name) || null,
        client_phone: phone,
        source: 'ZADARMA',
        channel: 'PHONE',
        call_status: 'PENDING',
        call_direction: 'INBOUND',
        called_did: text(payload.called_did) || null,
        pbx_call_id: pbxCallId,
        started_at: startedAt,
        duration_seconds: 0,
        transcription_status: 'idle',
        metadata: {
          provider: 'zadarma',
          direction: 'INBOUND',
          called_did: text(payload.called_did) || null,
          caller_id: phone,
        },
        created_at: now,
        updated_at: now,
      }),
    });
    return calls[0] || null;
  } catch (error) {
    const replay = await findCallByPbx(env, companyId, pbxCallId);
    if (replay) return replay;
    throw error;
  }
}

async function createMissedCallTask(env: WebhookEnv, companyId: string, call: Row, payload: Row, settings: Row): Promise<void> {
  if (settings.missed_call_tasks_enabled === false) return;
  const pbxCallId = text(call.pbx_call_id) || text(payload.pbx_call_id);
  if (!pbxCallId) return;
  const phone = text(call.client_phone) || normalizedPhone(payload.caller_id) || 'номер не определён';
  const delayMinutes = Math.max(0, Math.min(1440, Number(settings.missed_call_task_delay_minutes || 0)));
  const now = new Date();
  await db(env, 'crm_tasks?on_conflict=company_id,external_key&select=id', {
    method: 'POST',
    headers: { prefer: 'resolution=ignore-duplicates,return=representation' },
    body: JSON.stringify({
      company_id: companyId,
      title: `Перезвонить: пропущенный ${phone}`,
      description: `Пропущенный входящий звонок Zadarma. PBX call ID: ${pbxCallId}.`,
      status: 'todo',
      priority: 'high',
      due_at: new Date(now.getTime() + delayMinutes * 60_000).toISOString(),
      source: 'ZADARMA_MISSED_CALL',
      external_key: `zadarma:missed:${pbxCallId}`,
      created_at: now.toISOString(),
      updated_at: now.toISOString(),
    }),
  });
}

async function completeInbound(env: WebhookEnv, companyId: string, payload: Row): Promise<Row | null> {
  const pbxCallId = text(payload.pbx_call_id);
  if (!pbxCallId) return null;
  let call = await findCallByPbx(env, companyId, pbxCallId);
  if (!call) call = await captureInboundStart(env, companyId, payload);
  if (!call) return null;

  const disposition = text(payload.disposition).toLowerCase();
  const answered = disposition === 'answered';
  const duration = Math.max(0, Math.round(Number(payload.duration) || 0));
  const recordingId = text(payload.call_id_with_rec);
  const recorded = ['1', 'true', 'yes'].includes(text(payload.is_recorded).toLowerCase()) || Boolean(recordingId);
  const now = new Date().toISOString();
  const rows = await db<Row[]>(env, `marketing_calls?id=eq.${encodeURIComponent(text(call.id))}&company_id=eq.${encodeURIComponent(companyId)}&select=*`, {
    method: 'PATCH',
    headers: { prefer: 'return=representation' },
    body: JSON.stringify({
      call_status: answered ? 'COMPLETED' : 'CANCELLED',
      duration_seconds: duration,
      answered_at: answered ? now : null,
      recording_external_id: recordingId || text(call.recording_external_id) || null,
      recording_ready_at: recordingId ? now : call.recording_ready_at || null,
      transcription_status: answered && recorded ? 'pending' : 'idle',
      call_result: answered ? null : (disposition || 'Пропущенный входящий звонок'),
      updated_at: now,
    }),
  });
  const updated = rows[0] || call;
  if (!answered) await createMissedCallTask(env, companyId, updated, payload, await telephonySettings(env, companyId));
  return updated;
}

async function matchOutboundStart(env: WebhookEnv, companyId: string, payload: Row): Promise<Row | null> {
  const destination = digits(payload.destination);
  const extension = text(payload.internal);
  const pbxCallId = text(payload.pbx_call_id);
  if (!destination || !extension || !pbxCallId) return null;

  const existing = await findCorrelationByPbx(env, companyId, pbxCallId);
  if (existing) return existing;

  const now = new Date().toISOString();
  const rows = await db<Row[]>(env,
    `telephony_callback_requests?company_id=eq.${encodeURIComponent(companyId)}&provider=eq.zadarma&status=eq.requested&destination=eq.${encodeURIComponent(destination)}&extension=eq.${encodeURIComponent(extension)}&expires_at=gt.${encodeURIComponent(now)}&select=*&order=requested_at.asc&limit=1`,
  );
  const correlation = rows[0];
  if (!correlation) return null;

  const correlationId = text(correlation.id);
  const callId = text(correlation.marketing_call_id);
  const matchedAt = new Date().toISOString();
  const callStartedAt = text(payload.call_start) || matchedAt;
  await Promise.all([
    db(env, `telephony_callback_requests?id=eq.${encodeURIComponent(correlationId)}&company_id=eq.${encodeURIComponent(companyId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'matched', pbx_call_id: pbxCallId, matched_at: matchedAt, updated_at: matchedAt }),
    }),
    db(env, `marketing_calls?id=eq.${encodeURIComponent(callId)}&company_id=eq.${encodeURIComponent(companyId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ pbx_call_id: pbxCallId, call_direction: 'OUTBOUND', started_at: callStartedAt, updated_at: matchedAt }),
    }),
  ]);
  return { ...correlation, pbx_call_id: pbxCallId, status: 'matched' };
}

async function completeOutbound(env: WebhookEnv, companyId: string, payload: Row): Promise<void> {
  const pbxCallId = text(payload.pbx_call_id);
  const correlation = await findCorrelationByPbx(env, companyId, pbxCallId);
  if (!correlation) return;
  const callId = text(correlation.marketing_call_id);
  if (!callId) return;

  const disposition = text(payload.disposition).toLowerCase();
  const answered = disposition === 'answered';
  const duration = Math.max(0, Math.round(Number(payload.duration) || 0));
  const recordingId = text(payload.call_id_with_rec);
  const recorded = ['1', 'true', 'yes'].includes(text(payload.is_recorded).toLowerCase()) || Boolean(recordingId);
  const now = new Date().toISOString();
  await Promise.all([
    db(env, `telephony_callback_requests?id=eq.${encodeURIComponent(text(correlation.id))}&company_id=eq.${encodeURIComponent(companyId)}`, {
      method: 'PATCH',
      body: JSON.stringify({
        status: answered ? 'completed' : 'failed',
        external_recording_id: recordingId || null,
        completed_at: now,
        last_error: answered ? null : (disposition || 'not_answered'),
        updated_at: now,
      }),
    }),
    db(env, `marketing_calls?id=eq.${encodeURIComponent(callId)}&company_id=eq.${encodeURIComponent(companyId)}`, {
      method: 'PATCH',
      body: JSON.stringify({
        call_status: answered ? 'COMPLETED' : 'CANCELLED',
        call_direction: 'OUTBOUND',
        duration_seconds: duration,
        answered_at: answered ? now : null,
        recording_external_id: recordingId || null,
        recording_ready_at: recordingId ? now : null,
        transcription_status: answered && recorded ? 'pending' : 'idle',
        call_result: answered ? null : (disposition || 'Звонок не состоялся'),
        updated_at: now,
      }),
    }),
  ]);
}

async function markRecordingReady(env: WebhookEnv, companyId: string, payload: Row): Promise<void> {
  const pbxCallId = text(payload.pbx_call_id);
  const recordingId = text(payload.call_id_with_rec);
  if (!pbxCallId || !recordingId) return;
  const call = await findCallByPbx(env, companyId, pbxCallId);
  if (!call) return;
  const now = new Date().toISOString();
  const correlation = await findCorrelationByPbx(env, companyId, pbxCallId);
  await Promise.all([
    correlation ? db(env, `telephony_callback_requests?id=eq.${encodeURIComponent(text(correlation.id))}&company_id=eq.${encodeURIComponent(companyId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ external_recording_id: recordingId, updated_at: now }),
    }) : Promise.resolve(null),
    db(env, `marketing_calls?id=eq.${encodeURIComponent(text(call.id))}&company_id=eq.${encodeURIComponent(companyId)}`, {
      method: 'PATCH',
      body: JSON.stringify({
        recording_external_id: recordingId,
        recording_ready_at: now,
        transcription_status: text(call.call_status) === 'COMPLETED' ? 'pending' : text(call.transcription_status) || 'idle',
        transcription_error: null,
        transcription_attempts: 0,
        last_transcription_attempt_at: null,
        updated_at: now,
      }),
    }),
  ]);
}

export async function handleZadarmaWebhook(request: Request, baseEnv: WebhookEnv, url: URL): Promise<Response | null> {
  const match = url.pathname.match(/^\/api\/telephony\/zadarma\/webhook\/([0-9a-f-]{36})$/i);
  if (!match) return null;
  const companyId = match[1];
  if (!UUID_PATTERN.test(companyId)) return json({ error: 'Invalid company id' }, 400);

  const echo = url.searchParams.get('zd_echo');
  if (request.method === 'GET' && echo != null) {
    return new Response(echo, { status: 200, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } });
  }
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const env = await hydrateIntegrationEnv({ ...baseEnv, CURRENT_COMPANY_ID: companyId }) as WebhookEnv;
  const tenantCredential = text(env.ZADARMA_TENANT_CONFIGURED) === 'true';
  const legacyDefault = !tenantCredential && text(env.DEFAULT_COMPANY_ID) === companyId;
  if (!tenantCredential && !legacyDefault) return json({ error: 'Zadarma не настроена для этой клиники' }, 404);

  const payload = await payloadFrom(request);
  const event = text(payload.event).toUpperCase();
  if (!['NOTIFY_START', 'NOTIFY_END', 'NOTIFY_OUT_START', 'NOTIFY_OUT_END', 'NOTIFY_RECORD'].includes(event)) return json({ ok: true, ignored: event || 'unknown' });
  if (!await verifySignature(request, env, event, payload)) return json({ error: 'Invalid Zadarma signature' }, 401);

  await recordWebhookEvent(env, companyId, event, payload).catch(() => undefined);

  if (event === 'NOTIFY_START') {
    const call = await captureInboundStart(env, companyId, payload);
    return json({ ok: true, captured: Boolean(call), callId: text(call?.id) || null, leadId: text(call?.lead_id) || null });
  }
  if (event === 'NOTIFY_END') {
    const call = await completeInbound(env, companyId, payload);
    return json({ ok: true, callId: text(call?.id) || null, status: text(call?.call_status) || null });
  }
  if (event === 'NOTIFY_OUT_START') {
    const correlation = await matchOutboundStart(env, companyId, payload);
    return json({ ok: true, matched: Boolean(correlation) });
  }
  if (event === 'NOTIFY_OUT_END') {
    await completeOutbound(env, companyId, payload);
    return json({ ok: true });
  }
  await markRecordingReady(env, companyId, payload);
  return json({ ok: true });
}
