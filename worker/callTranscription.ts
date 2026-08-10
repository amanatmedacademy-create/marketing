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

const MAX_AUDIO_BYTES = 24 * 1024 * 1024;
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
  const stored = validateRecordingUrl(call.recording_url);
  if (stored) return stored;

  const pbxCallId = text(call.pbx_call_id);
  const externalCallId = text(call.recording_external_id);
  if (!pbxCallId && !externalCallId) {
    throw new Error('У звонка нет pbx_call_id или call_id записи Zadarma');
  }
  const params = pbxCallId ? { pbx_call_id: pbxCallId, lifetime: '600' } : { call_id: externalCallId, lifetime: '600' };
  const result = await zadarmaRequest(env, '/v1/pbx/record/request/', params);
  const link = recordingLink(result);
  if (!link) throw new Error('Zadarma не вернула ссылку на запись звонка');
  return link;
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

async function transcribeCall(request: Request, env: CallTranscriptionEnv, callId: string): Promise<Response> {
  if (!canRun(request)) return json({ error: 'Транскрипция звонков доступна администратору и маркетологу' }, 403);
  const companyId = requireCompanyId(env);
  const rows = await db<Row[]>(env, `marketing_calls?id=eq.${encodeURIComponent(callId)}&company_id=eq.${encodeURIComponent(companyId)}&select=*&limit=1`);
  const call = rows[0];
  if (!call) return json({ error: 'Звонок не найден в выбранной клинике' }, 404);
  if (text(call.call_status).toUpperCase() !== 'COMPLETED') return json({ error: 'Транскрибировать можно только завершённый звонок' }, 409);
  if (text(call.transcription_status) === 'processing') return json({ error: 'Транскрипция уже выполняется' }, 409);

  if (text(call.transcript).length >= 20 && text(call.transcription_status) === 'completed') {
    try {
      const analysis = await analyzeMarketingCall(env, callId);
      return json({ ok: true, reusedTranscript: true, transcript: text(call.transcript), analysis });
    } catch (error) {
      return json({ ok: true, reusedTranscript: true, transcript: text(call.transcript), analysisError: error instanceof Error ? error.message : String(error) });
    }
  }

  await patchCall(env, companyId, callId, {
    transcription_status: 'processing',
    transcription_error: null,
  });

  try {
    const url = await resolveRecordingUrl(env, call);
    const audio = await downloadAudio(url);
    const result = await transcribeAudio(env, audio);
    const now = new Date().toISOString();
    await patchCall(env, companyId, callId, {
      recording_url: url,
      transcript: result.transcript,
      transcription_status: 'completed',
      transcription_model: result.model,
      transcribed_at: now,
      transcription_error: null,
    });

    if (result.transcript.length < 20) {
      return json({ ok: true, transcript: result.transcript, analysisSkipped: 'Транскрипция слишком короткая для достоверного AI-анализа' });
    }

    try {
      const analysis = await analyzeMarketingCall(env, callId);
      return json({ ok: true, transcript: result.transcript, analysis });
    } catch (error) {
      return json({ ok: true, transcript: result.transcript, analysisError: error instanceof Error ? error.message : String(error) });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await patchCall(env, companyId, callId, {
      transcription_status: 'failed',
      transcription_error: message.slice(0, 1000),
    }).catch(() => undefined);
    return json({ error: message }, 400);
  }
}

export async function handleCallTranscription(request: Request, env: CallTranscriptionEnv, url: URL): Promise<Response | null> {
  const match = url.pathname.match(/^\/api\/telephony\/calls\/([^/]+)\/transcribe$/);
  if (!match) return null;
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  return transcribeCall(request, env, decodeURIComponent(match[1]));
}
