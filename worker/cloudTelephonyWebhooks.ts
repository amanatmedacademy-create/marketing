import type { UniversalTelephonyEnv } from './telephonyGateway';
import { loadTelephonyProviderCredential, markTelephonyProviderStatus, type ConfigurableTelephonyProvider } from './telephonyProviderCredentials';

type Row = Record<string, unknown>;
type CloudProvider = Extract<ConfigurableTelephonyProvider, 'binotel' | 'sipuni'>;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const text = (value: unknown): string => typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim();
const rec = (value: unknown): Row => value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {};
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });

function dbHeaders(env: UniversalTelephonyEnv, extra: HeadersInit = {}): Headers {
  const headers = new Headers(extra);
  headers.set('apikey', env.SUPABASE_SERVICE_ROLE_KEY);
  headers.set('authorization', `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`);
  headers.set('accept', 'application/json');
  if (!headers.has('content-type')) headers.set('content-type', 'application/json');
  return headers;
}
async function db<T>(env: UniversalTelephonyEnv, path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/${path}`, { ...init, headers: dbHeaders(env, init.headers), cache: 'no-store' });
  const raw = await response.text();
  if (!response.ok) throw new Error(`Cloud telephony DB ${response.status}: ${raw.slice(0, 1000)}`);
  return (raw ? JSON.parse(raw) : null) as T;
}

function secureEqual(left: string, right: string): boolean {
  if (!left || left.length !== right.length) return false;
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) diff |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return diff === 0;
}

function normalizedPhone(value: unknown): string {
  let digits = text(value).replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('8')) digits = `7${digits.slice(1)}`;
  if (digits.length === 10) digits = `7${digits}`;
  return digits.length >= 10 ? `+${digits.slice(0, 15)}` : '';
}

function normalizedDate(value: unknown): string | null {
  const raw = text(value);
  if (!raw) return null;
  const numeric = Number(raw);
  const candidate = Number.isFinite(numeric) && numeric > 1_000_000_000 ? new Date(numeric > 10_000_000_000 ? numeric : numeric * 1000) : new Date(raw);
  return Number.isNaN(candidate.getTime()) ? null : candidate.toISOString();
}

async function payloadFrom(request: Request, url: URL): Promise<Row> {
  const result: Row = {};
  url.searchParams.forEach((value, key) => { if (key !== 'token') result[key] = value; });
  if (request.method === 'GET' || request.method === 'HEAD') return result;
  const contentType = request.headers.get('content-type') || '';
  if (contentType.includes('application/json')) return { ...result, ...rec(await request.json().catch(() => ({}))) };
  const body = await request.text();
  const params = new URLSearchParams(body);
  params.forEach((value, key) => { result[key] = value; });
  return result;
}

function sipuniEvent(payload: Row) {
  const event = Number(payload.event || 0);
  const callId = text(payload.call_id);
  const inbound = text(payload.src_type) === '1';
  const phone = normalizedPhone(inbound ? payload.src_num : payload.dst_num || payload.dst_number || payload.to);
  const status = text(payload.status).toUpperCase();
  const answered = event === 3 || status === 'ANSWER';
  const startedAtRaw = Number(payload.call_start_timestamp || 0);
  const answeredAtRaw = Number(payload.call_answer_timestamp || 0);
  const startedAt = startedAtRaw > 0 ? new Date(startedAtRaw * 1000).toISOString() : new Date().toISOString();
  const answeredAt = answeredAtRaw > 0 ? new Date(answeredAtRaw * 1000).toISOString() : null;
  return {
    event: event === 1 ? 'start' : event === 3 ? 'answer' : event === 2 ? 'end' : event === 4 ? 'secondary_end' : 'unknown',
    callId,
    phone,
    direction: inbound ? 'INBOUND' : 'OUTBOUND',
    answered,
    finalStatus: status,
    startedAt,
    answeredAt,
    recordingUrl: text(payload.call_record_link),
    operator: text(payload.short_dst_num || payload.short_src_num || payload.dst_num || payload.src_num),
  } as const;
}

function binotelEvent(payload: Row): ReturnType<typeof sipuniEvent> {
  const callId = text(payload.generalCallID || payload.generalCallId || payload.callID || payload.callId || payload.id);
  const type = text(payload.eventName || payload.event || payload.type || payload.disposition).toLowerCase();
  const directionValue = text(payload.callType || payload.direction).toLowerCase();
  const inbound = directionValue.includes('in') || type.includes('incoming');
  const phone = normalizedPhone(payload.externalNumber || payload.callerNumber || payload.phone || (inbound ? payload.from : payload.to));
  const finalStatus = text(payload.disposition || payload.status || payload.callStatus).toUpperCase();
  const answered = ['ANSWER', 'ANSWERED', 'SUCCESS', 'COMPLETED'].some((value) => finalStatus.includes(value)) || type.includes('answer');
  const isEnd = type.includes('complete') || type.includes('finish') || type.includes('hangup') || type.includes('end');
  const isStart = type.includes('start') || type.includes('incoming') || type.includes('outgoing');
  return {
    event: isEnd ? 'end' : answered ? 'answer' : isStart ? 'start' : 'unknown',
    callId,
    phone,
    direction: inbound ? 'INBOUND' : 'OUTBOUND',
    answered,
    finalStatus,
    startedAt: normalizedDate(payload.startTime || payload.callStart || payload.startedAt) || new Date().toISOString(),
    answeredAt: normalizedDate(payload.answerTime || payload.answeredAt),
    recordingUrl: text(payload.linkToRecord || payload.recordingUrl || payload.recordUrl),
    operator: text(payload.internalNumber || payload.employeeNumber || payload.manager || payload.extension),
  };
}

async function findLead(env: UniversalTelephonyEnv, companyId: string, phone: string): Promise<Row | null> {
  if (!phone) return null;
  const bare = phone.replace(/^\+/, '');
  const rows = await db<Row[]>(env, `marketing_leads?company_id=eq.${encodeURIComponent(companyId)}&or=(phone.eq.${encodeURIComponent(phone)},phone.eq.${encodeURIComponent(bare)})&select=id,name,phone&order=lead_created_at.desc&limit=1`);
  return rows[0] || null;
}

async function createInboundLead(env: UniversalTelephonyEnv, companyId: string, provider: CloudProvider, phone: string): Promise<Row | null> {
  if (!phone) return null;
  const existing = await findLead(env, companyId, phone);
  if (existing) return existing;
  const now = new Date().toISOString();
  const created = await db<Row[]>(env, 'marketing_leads?select=id,name,phone', {
    method: 'POST', headers: { prefer: 'return=representation' },
    body: JSON.stringify({ company_id: companyId, name: `Входящий звонок ${phone}`, phone, source: provider === 'sipuni' ? 'Sipuni' : 'Binotel', platform: 'Phone', stage: 'NEW', first_message: 'Первичное обращение по входящему звонку', direction: 'INBOUND', lead_created_at: now, metadata: { created_by: `${provider}_webhook` }, created_at: now, updated_at: now }),
  });
  return created[0] || null;
}

async function findCall(env: UniversalTelephonyEnv, companyId: string, provider: CloudProvider, callId: string): Promise<Row | null> {
  if (!callId) return null;
  const rows = await db<Row[]>(env, `marketing_calls?company_id=eq.${encodeURIComponent(companyId)}&telephony_provider=eq.${provider}&pbx_call_id=eq.${encodeURIComponent(callId)}&select=*&limit=1`);
  return rows[0] || null;
}

async function createCall(env: UniversalTelephonyEnv, companyId: string, provider: CloudProvider, normalized: ReturnType<typeof sipuniEvent>, raw: Row): Promise<Row> {
  const lead = normalized.direction === 'INBOUND' ? await createInboundLead(env, companyId, provider, normalized.phone) : await findLead(env, companyId, normalized.phone);
  const now = new Date().toISOString();
  const rows = await db<Row[]>(env, 'marketing_calls?select=*', {
    method: 'POST', headers: { prefer: 'return=representation' },
    body: JSON.stringify({
      company_id: companyId, lead_id: text(lead?.id) || null, client_name: text(lead?.name) || null, client_phone: normalized.phone || null,
      source: provider.toUpperCase(), channel: 'PHONE', call_status: normalized.answered ? 'COMPLETED' : 'PENDING', call_direction: normalized.direction,
      pbx_call_id: normalized.callId, started_at: normalized.startedAt, answered_at: normalized.answeredAt, duration_seconds: 0,
      operator_name: normalized.operator || null, telephony_provider: provider, recording_url: normalized.recordingUrl || null,
      recording_ingest_status: normalized.recordingUrl ? 'pending' : 'not_available', transcription_status: normalized.recordingUrl ? 'pending' : 'idle',
      metadata: { provider, direction: normalized.direction, webhook: raw }, created_at: now, updated_at: now,
    }),
  });
  if (!rows[0]) throw new Error('Не удалось сохранить звонок');
  return rows[0];
}

async function patchCall(env: UniversalTelephonyEnv, companyId: string, id: string, patch: Row): Promise<Row | null> {
  const rows = await db<Row[]>(env, `marketing_calls?id=eq.${encodeURIComponent(id)}&company_id=eq.${encodeURIComponent(companyId)}&select=*`, { method: 'PATCH', headers: { prefer: 'return=representation' }, body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() }) });
  return rows[0] || null;
}

async function createMissedTask(env: UniversalTelephonyEnv, companyId: string, provider: CloudProvider, call: Row): Promise<void> {
  if (text(call.call_direction) !== 'INBOUND') return;
  const phone = text(call.client_phone) || 'номер не определён';
  const callId = text(call.pbx_call_id);
  if (!callId) return;
  const now = new Date().toISOString();
  await db(env, 'crm_tasks?on_conflict=company_id,external_key&select=id', {
    method: 'POST', headers: { prefer: 'resolution=ignore-duplicates,return=representation' },
    body: JSON.stringify({ company_id: companyId, title: `Перезвонить: пропущенный ${phone}`, description: `Пропущенный входящий звонок ${provider === 'sipuni' ? 'Sipuni' : 'Binotel'}. Call ID: ${callId}.`, status: 'todo', priority: 'high', due_at: now, source: `${provider.toUpperCase()}_MISSED_CALL`, external_key: `${provider}:missed:${callId}`, created_at: now, updated_at: now }),
  });
}

async function processEvent(env: UniversalTelephonyEnv, companyId: string, provider: CloudProvider, payload: Row): Promise<Row | null> {
  const normalized = provider === 'sipuni' ? sipuniEvent(payload) : binotelEvent(payload);
  if (!normalized.callId || normalized.event === 'unknown' || normalized.event === 'secondary_end') return null;
  let call = await findCall(env, companyId, provider, normalized.callId);
  if (!call) {
    try { call = await createCall(env, companyId, provider, normalized, payload); }
    catch (error) {
      const replay = await findCall(env, companyId, provider, normalized.callId);
      if (!replay) throw error;
      call = replay;
    }
  }

  if (normalized.event === 'answer') {
    return patchCall(env, companyId, text(call.id), { call_status: 'COMPLETED', answered_at: normalized.answeredAt || new Date().toISOString(), operator_name: normalized.operator || call.operator_name || null, recording_url: normalized.recordingUrl || call.recording_url || null, recording_ingest_status: normalized.recordingUrl ? 'pending' : call.recording_ingest_status, transcription_status: normalized.recordingUrl ? 'pending' : call.transcription_status, metadata: { ...rec(call.metadata), webhook: payload } });
  }
  if (normalized.event === 'end') {
    const answered = normalized.answered || text(call.answered_at) !== '';
    const started = new Date(text(call.started_at) || normalized.startedAt).getTime();
    const ended = Date.now();
    const duration = Number.isFinite(started) ? Math.max(0, Math.round((ended - started) / 1000)) : 0;
    const updated = await patchCall(env, companyId, text(call.id), {
      call_status: answered ? 'COMPLETED' : 'CANCELLED', duration_seconds: duration,
      call_result: answered ? null : normalized.finalStatus || 'Пропущенный звонок', operator_name: normalized.operator || call.operator_name || null,
      recording_url: normalized.recordingUrl || call.recording_url || null,
      recording_ready_at: normalized.recordingUrl ? new Date().toISOString() : call.recording_ready_at || null,
      recording_ingest_status: normalized.recordingUrl ? 'pending' : call.recording_ingest_status,
      transcription_status: answered && (normalized.recordingUrl || call.recording_url) ? 'pending' : call.transcription_status,
      metadata: { ...rec(call.metadata), webhook: payload },
    });
    if (updated && !answered) await createMissedTask(env, companyId, provider, updated);
    return updated;
  }
  return call;
}

export async function handleCloudTelephonyWebhook(request: Request, env: UniversalTelephonyEnv, url: URL): Promise<Response | null> {
  const match = url.pathname.match(/^\/api\/telephony\/(binotel|sipuni)\/webhook\/([0-9a-f-]{36})$/i);
  if (!match) return null;
  const provider = match[1].toLowerCase() as CloudProvider;
  const companyId = match[2];
  if (!UUID_PATTERN.test(companyId)) return json({ success: false, error: 'Invalid company' }, 400);
  try {
    const credential = await loadTelephonyProviderCredential(env, provider, companyId);
    if (!credential) return json({ success: false, error: 'Provider is not configured' }, 404);
    const supplied = text(url.searchParams.get('token'));
    const expected = text(credential.payload.webhookSecret);
    if (!secureEqual(supplied, expected)) return json({ success: false, error: 'Invalid webhook token' }, 401);
    const payload = await payloadFrom(request, url);
    const call = await processEvent(env, companyId, provider, payload);
    await markTelephonyProviderStatus(env, companyId, provider, true);
    return json({ success: true, provider, callId: text(call?.id) || null });
  } catch (error) {
    console.error(`${provider} webhook failed`, error);
    await markTelephonyProviderStatus(env, companyId, provider, false, error).catch(() => undefined);
    return json({ success: false, error: error instanceof Error ? error.message : String(error) }, 500);
  }
}
