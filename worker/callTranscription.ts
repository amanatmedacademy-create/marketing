import type { Env } from './integrations';
import { requireCompanyId, type TenantScopedEnv } from './tenantScope';
import { analyzeMarketingCall } from './callIntelligence';
import { zadarmaRequest, type ZadarmaTelephonyEnv } from './zadarmaTelephony';

type Row = Record<string, unknown>;
export type CallTranscriptionEnv = Env & TenantScopedEnv & ZadarmaTelephonyEnv & {
  OPENAI_API_KEY?: string;
  OPENAI_TRANSCRIPTION_MODEL?: string;
  OPENAI_CALL_ANALYSIS_MODEL?: string;
};

export type TelephonySettings = {
  company_id: string;
  provider: 'zadarma';
  auto_transcribe: boolean;
  auto_analyze: boolean;
  transcription_model: string;
  recording_delay_seconds: number;
  max_attempts: number;
  retry_after_minutes: number;
  created_at?: string;
  updated_at?: string;
};

const MAX_AUDIO_BYTES = 24 * 1024 * 1024;
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});
const text = (value: unknown): string => typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim();
const role = (request: Request) => text(request.headers.get('x-amanat-auth-role')).toLowerCase();
const canRun = (request: Request) => ['administrator', 'marketer'].includes(role(request));
const isAdmin = (request: Request) => role(request) === 'administrator';
const asBool = (value: unknown, fallback = false) => typeof value === 'boolean' ? value : fallback;
const asInt = (value: unknown, fallback: number, min: number, max: number) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
};

function headers(env: Env, extra: HeadersInit = {}): Headers {
  const next = new Headers(extra);
  next.set('apikey', env.SUPABASE_SERVICE_ROLE_KEY);
  next.set('authorization', `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`);
  next.set('accept', 'application/json');
  if (!next.has('content-type')) next.set('content-type', 'application/json');
  return next;
}

async function db<T>(env: Env, path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/${path}`, {
    ...init,
    headers: headers(env, init.headers),
    cache: 'no-store',
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`Call transcription DB ${response.status}: ${body.slice(0, 1200)}`);
  return (body ? JSON.parse(body) : null) as T;
}

async function patchCall(env: CallTranscriptionEnv, companyId: string, callId: string, patch: Row): Promise<void> {
  await db<Row[]>(env, `marketing_calls?id=eq.${encodeURIComponent(callId)}&company_id=eq.${encodeURIComponent(companyId)}&select=id`, {
    method: 'PATCH',
    body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() }),
  });
}

async function getSettings(env: CallTranscriptionEnv): Promise<TelephonySettings> {
  const companyId = requireCompanyId(env);
  const rows = await db<TelephonySettings[]>(env, `telephony_settings?company_id=eq.${encodeURIComponent(companyId)}&select=*&limit=1`);
  if (rows[0]) return rows[0];
  const created = await db<TelephonySettings[]>(env, 'telephony_settings?on_conflict=company_id', {
    method: 'POST',
    headers: { prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify({ company_id: companyId }),
  });
  return created[0];
}

async function saveSettings(request: Request, env: CallTranscriptionEnv): Promise<Response> {
  if (!isAdmin(request)) return json({ error: 'Настройки телефонии доступны только администратору' }, 403);
  const companyId = requireCompanyId(env);
  let body: Row = {};
  try { body = await request.json() as Row; } catch { return json({ error: 'Некорректный JSON' }, 400); }
  const current = await getSettings(env);
  const autoTranscribe = asBool(body.autoTranscribe, current.auto_transcribe);
  const autoAnalyze = asBool(body.autoAnalyze, current.auto_analyze);
  if (autoAnalyze && !autoTranscribe) return json({ error: 'Авто AI-анализ требует включённой автотранскрипции' }, 400);
  const payload = {
    company_id: companyId,
    provider: 'zadarma',
    auto_transcribe: autoTranscribe,
    auto_analyze: autoAnalyze,
    transcription_model: 'gpt-4o-mini-transcribe',
    recording_delay_seconds: asInt(body.recordingDelaySeconds, current.recording_delay_seconds, 0, 600),
    max_attempts: asInt(body.maxAttempts, current.max_attempts, 1, 10),
    retry_after_minutes: asInt(body.retryAfterMinutes, current.retry_after_minutes, 1, 1440),
    updated_at: new Date().toISOString(),
  };
  const saved = await db<TelephonySettings[]>(env, 'telephony_settings?on_conflict=company_id', {
    method: 'POST',
    headers: { prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify(payload),
  });
  return json({ settings: saved[0] });
}

function validateRecordingUrl(raw: unknown): string {
  const value = text(raw);
  if (!value) return '';
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.hostname !== 'api.zadarma.com') throw new Error('Недопустимый URL записи звонка');
  return url.toString();
}

function recordingLink(payload: Row): string {
  const direct = text(payload.link);
  if (direct) return validateRecordingUrl(direct);
  const links = Array.isArray(payload.links) ? payload.links.map(text).filter(Boolean) : [];
  if (links[0]) return validateRecordingUrl(links[0]);
  return '';
}

function filenameFor(contentType: string, url: string): string {
  const pathName = new URL(url).pathname.toLowerCase();
  const ext = pathName.match(/\.(mp3|wav|m4a|ogg|webm|mp4|mpeg|mpga|flac)$/)?.[1];
  if (ext) return `call.${ext}`;
  if (contentType.includes('wav')) return 'call.wav';
  if (contentType.includes('ogg')) return 'call.ogg';
  if (contentType.includes('webm')) return 'call.webm';
  if (contentType.includes('mp4')) return 'call.mp4';
  if (contentType.includes('flac')) return 'call.flac';
  return 'call.mp3';
}

async function resolveRecordingUrl(env: CallTranscriptionEnv, call: Row): Promise<string> {
  const pbxCallId = text(call.pbx_call_id);
  const externalCallId = text(call.recording_external_id);
  if (pbxCallId || externalCallId) {
    const params: Record<string, string> = pbxCallId
      ? { pbx_call_id: pbxCallId, lifetime: '600' }
      : { call_id: externalCallId, lifetime: '600' };
    const result = await zadarmaRequest(env, '/v1/pbx/record/request/', params);
    const link = recordingLink(result);
    if (link) return link;
  }
  const stored = validateRecordingUrl(call.recording_url);
  if (stored) return stored;
  throw new Error('У звонка нет доступной записи Zadarma');
}

async function downloadAudio(url: string): Promise<{ blob: Blob; filename: string }> {
  const response = await fetch(url, { method: 'GET', headers: { accept: 'audio/*,application/octet-stream' }, redirect: 'follow' });
  if (!response.ok) throw new Error(`Не удалось скачать запись Zadarma: HTTP ${response.status}`);
  const length = Number(response.headers.get('content-length') || 0);
  if (length > MAX_AUDIO_BYTES) throw new Error('Запись звонка слишком большая для безопасной транскрипции');
  const buffer = await response.arrayBuffer();
  if (!buffer.byteLength) throw new Error('Zadarma вернула пустую запись звонка');
  if (buffer.byteLength > MAX_AUDIO_BYTES) throw new Error('Запись звонка слишком большая для безопасной транскрипции');
  const contentType = text(response.headers.get('content-type')) || 'audio/mpeg';
  return { blob: new Blob([buffer], { type: contentType }), filename: filenameFor(contentType, url) };
}

async function transcribeAudio(env: CallTranscriptionEnv, audio: { blob: Blob; filename: string }): Promise<{ transcript: string; model: string }> {
  const apiKey = text(env.OPENAI_API_KEY);
  if (!apiKey) throw new Error('OPENAI_API_KEY не настроен');
  const model = text(env.OPENAI_TRANSCRIPTION_MODEL) || 'gpt-4o-mini-transcribe';
  const form = new FormData();
  form.append('file', audio.blob, audio.filename);
  form.append('model', model);
  form.append('response_format', 'json');
  const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}` },
    body: form,
  });
  const raw = await response.text();
  let payload: Row = {};
  try { payload = raw ? JSON.parse(raw) as Row : {}; } catch { payload = { raw }; }
  if (!response.ok) {
    const error = payload.error && typeof payload.error === 'object' ? payload.error as Row : {};
    throw new Error(text(error.message) || text(payload.message) || `OpenAI transcription HTTP ${response.status}`);
  }
  const transcript = text(payload.text);
  if (!transcript) throw new Error('OpenAI вернул пустую транскрипцию');
  return { transcript, model };
}

async function getCall(env: CallTranscriptionEnv, companyId: string, callId: string): Promise<Row | null> {
  const rows = await db<Row[]>(env, `marketing_calls?id=eq.${encodeURIComponent(callId)}&company_id=eq.${encodeURIComponent(companyId)}&select=*&limit=1`);
  return rows[0] || null;
}

async function proxyRecording(request: Request, env: CallTranscriptionEnv, callId: string): Promise<Response> {
  const companyId = requireCompanyId(env);
  const call = await getCall(env, companyId, callId);
  if (!call) return json({ error: 'Звонок не найден в выбранной клинике' }, 404);
  if (text(call.call_status).toUpperCase() !== 'COMPLETED') return json({ error: 'Запись доступна только для завершённого звонка' }, 409);
  try {
    const url = await resolveRecordingUrl(env, call);
    const upstreamHeaders = new Headers({ accept: 'audio/*,application/octet-stream' });
    const range = request.headers.get('range');
    if (range) upstreamHeaders.set('range', range);
    const upstream = await fetch(url, { method: 'GET', headers: upstreamHeaders, redirect: 'follow' });
    if (!upstream.ok && upstream.status !== 206) return json({ error: `Zadarma recording HTTP ${upstream.status}` }, 502);
    const responseHeaders = new Headers();
    responseHeaders.set('content-type', text(upstream.headers.get('content-type')) || 'audio/mpeg');
    responseHeaders.set('content-disposition', 'inline');
    responseHeaders.set('cache-control', 'private, no-store');
    for (const name of ['content-length', 'content-range', 'accept-ranges']) {
      const value = upstream.headers.get(name);
      if (value) responseHeaders.set(name, value);
    }
    return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 400);
  }
}

export async function processMarketingCallTranscription(
  env: CallTranscriptionEnv,
  callId: string,
  options: { analyze?: boolean } = {},
): Promise<Record<string, unknown>> {
  const companyId = requireCompanyId(env);
  const call = await getCall(env, companyId, callId);
  if (!call) throw new Error('Звонок не найден в выбранной клинике');
  if (text(call.call_status).toUpperCase() !== 'COMPLETED') throw new Error('Транскрибировать можно только завершённый звонок');
  if (text(call.transcription_status) === 'processing') throw new Error('Транскрипция уже выполняется');
  const analyze = options.analyze !== false;

  if (text(call.transcript).length >= 20 && text(call.transcription_status) === 'completed') {
    if (!analyze) return { ok: true, reusedTranscript: true, transcript: text(call.transcript) };
    try {
      const analysis = await analyzeMarketingCall(env, callId);
      return { ok: true, reusedTranscript: true, transcript: text(call.transcript), analysis };
    } catch (error) {
      return { ok: true, reusedTranscript: true, transcript: text(call.transcript), analysisError: error instanceof Error ? error.message : String(error) };
    }
  }

  const now = new Date().toISOString();
  await patchCall(env, companyId, callId, {
    transcription_status: 'processing',
    transcription_error: null,
    transcription_attempts: Number(call.transcription_attempts || 0) + 1,
    last_transcription_attempt_at: now,
  });

  try {
    const url = await resolveRecordingUrl(env, call);
    const audio = await downloadAudio(url);
    const result = await transcribeAudio(env, audio);
    const completedAt = new Date().toISOString();
    await patchCall(env, companyId, callId, {
      transcript: result.transcript,
      transcription_status: 'completed',
      transcription_model: result.model,
      transcribed_at: completedAt,
      transcription_error: null,
    });
    if (!analyze) return { ok: true, transcript: result.transcript };
    if (result.transcript.length < 20) return { ok: true, transcript: result.transcript, analysisSkipped: 'Транскрипция слишком короткая для достоверного AI-анализа' };
    try {
      const analysis = await analyzeMarketingCall(env, callId);
      return { ok: true, transcript: result.transcript, analysis };
    } catch (error) {
      return { ok: true, transcript: result.transcript, analysisError: error instanceof Error ? error.message : String(error) };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await patchCall(env, companyId, callId, {
      transcription_status: 'failed',
      transcription_error: message.slice(0, 1000),
    }).catch(() => undefined);
    throw new Error(message);
  }
}

async function transcribeCall(request: Request, env: CallTranscriptionEnv, callId: string): Promise<Response> {
  if (!canRun(request)) return json({ error: 'Транскрипция звонков доступна администратору и маркетологу' }, 403);
  try {
    return json(await processMarketingCallTranscription(env, callId, { analyze: true }));
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 400);
  }
}

export async function handleCallTranscription(request: Request, env: CallTranscriptionEnv, url: URL): Promise<Response | null> {
  if (url.pathname === '/api/telephony/settings') {
    if (request.method === 'GET') return json({ settings: await getSettings(env) });
    if (request.method === 'PUT') return saveSettings(request, env);
    return json({ error: 'Method not allowed' }, 405);
  }

  const recordingMatch = url.pathname.match(/^\/api\/telephony\/calls\/([^/]+)\/recording$/);
  if (recordingMatch) {
    if (!['GET', 'HEAD'].includes(request.method)) return json({ error: 'Method not allowed' }, 405);
    return proxyRecording(request, env, decodeURIComponent(recordingMatch[1]));
  }

  const transcribeMatch = url.pathname.match(/^\/api\/telephony\/calls\/([^/]+)\/transcribe$/);
  if (!transcribeMatch) return null;
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  return transcribeCall(request, env, decodeURIComponent(transcribeMatch[1]));
}
