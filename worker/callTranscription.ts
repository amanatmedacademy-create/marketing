import type { Env } from './integrations';
import { requireCompanyId, type TenantScopedEnv } from './tenantScope';
import { analyzeMarketingCall } from './callIntelligence';
import {
  ensureArchivedRecording,
  loadArchivedRecording,
  proxyArchivedRecording,
  type TelephonyRecordingEnv,
} from './telephonyRecording';

type Row = Record<string, unknown>;
export type CallTranscriptionEnv = Env & TenantScopedEnv & TelephonyRecordingEnv & {
  OPENAI_API_KEY?: string;
  OPENAI_TRANSCRIPTION_MODEL?: string;
  OPENAI_CALL_ANALYSIS_MODEL?: string;
};

export type TelephonySettings = {
  company_id: string;
  provider: 'zadarma' | 'asterisk' | 'freepbx' | 'twilio' | 'voximplant' | 'sip';
  auto_transcribe: boolean;
  auto_analyze: boolean;
  archive_recordings?: boolean;
  recording_retention_days?: number;
  transcription_model: string;
  recording_delay_seconds: number;
  max_attempts: number;
  retry_after_minutes: number;
  created_at?: string;
  updated_at?: string;
};

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});
const text = (value: unknown): string => typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim();
const role = (request: Request) => text(request.headers.get('x-amanat-auth-role')).toLowerCase();
const canRun = (request: Request) => ['administrator', 'marketer'].includes(role(request));

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

async function getCall(env: CallTranscriptionEnv, companyId: string, callId: string): Promise<Row | null> {
  const rows = await db<Row[]>(env, `marketing_calls?id=eq.${encodeURIComponent(callId)}&company_id=eq.${encodeURIComponent(companyId)}&select=*&limit=1`);
  return rows[0] || null;
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

  await patchCall(env, companyId, callId, {
    transcription_status: 'processing',
    transcription_error: null,
    transcription_attempts: Number(call.transcription_attempts || 0) + 1,
    last_transcription_attempt_at: new Date().toISOString(),
  });

  try {
    const archivedCall = await ensureArchivedRecording(env, call);
    const audio = await loadArchivedRecording(env, archivedCall);
    const result = await transcribeAudio(env, audio);
    const completedAt = new Date().toISOString();
    await patchCall(env, companyId, callId, {
      transcript: result.transcript,
      transcription_status: 'completed',
      transcription_model: result.model,
      transcribed_at: completedAt,
      transcription_error: null,
    });
    if (!analyze) return { ok: true, transcript: result.transcript, archived: true };
    if (result.transcript.length < 20) return { ok: true, transcript: result.transcript, archived: true, analysisSkipped: 'Транскрипция слишком короткая для достоверного AI-анализа' };
    try {
      const analysis = await analyzeMarketingCall(env, callId);
      return { ok: true, transcript: result.transcript, archived: true, analysis };
    } catch (error) {
      return { ok: true, transcript: result.transcript, archived: true, analysisError: error instanceof Error ? error.message : String(error) };
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

async function recordingResponse(request: Request, env: CallTranscriptionEnv, callId: string): Promise<Response> {
  const companyId = requireCompanyId(env);
  const call = await getCall(env, companyId, callId);
  if (!call) return json({ error: 'Звонок не найден в выбранной клинике' }, 404);
  if (text(call.call_status).toUpperCase() !== 'COMPLETED') return json({ error: 'Запись доступна только для завершённого звонка' }, 409);
  try {
    return await proxyArchivedRecording(request, env, call);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 400);
  }
}

export async function handleCallTranscription(request: Request, env: CallTranscriptionEnv, url: URL): Promise<Response | null> {
  const recordingMatch = url.pathname.match(/^\/api\/telephony\/calls\/([^/]+)\/recording$/);
  if (recordingMatch) {
    if (!['GET', 'HEAD'].includes(request.method)) return json({ error: 'Method not allowed' }, 405);
    return recordingResponse(request, env, decodeURIComponent(recordingMatch[1]));
  }

  const transcribeMatch = url.pathname.match(/^\/api\/telephony\/calls\/([^/]+)\/transcribe$/);
  if (!transcribeMatch) return null;
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  return transcribeCall(request, env, decodeURIComponent(transcribeMatch[1]));
}
