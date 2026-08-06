type JsonRecord = Record<string, unknown>;

type MessageRow = {
  id?: string;
  attachment_path?: string | null;
  attachment_name?: string | null;
  attachment_mime_type?: string | null;
  attachment_size_bytes?: number | null;
  transcription_text?: string | null;
  transcription_status?: string | null;
};

export interface VoiceTranscriptionEnv {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  OPENAI_API_KEY?: string;
  OPENAI_TRANSCRIPTION_MODEL?: string;
}

const STORAGE_BUCKET = 'marketing-chat-attachments';
const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
const WRITE_ROLES = new Set(['administrator', 'marketer']);
const AUDIO_MIME_PREFIX = 'audio/';

const text = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});

function authHeaders(env: VoiceTranscriptionEnv, extra: HeadersInit = {}): Headers {
  const headers = new Headers(extra);
  headers.set('apikey', env.SUPABASE_SERVICE_ROLE_KEY);
  headers.set('authorization', `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`);
  return headers;
}

async function db<T>(env: VoiceTranscriptionEnv, path: string, init: RequestInit = {}): Promise<T> {
  const headers = authHeaders(env, init.headers);
  headers.set('accept', 'application/json');
  if (init.body != null) headers.set('content-type', 'application/json');
  const response = await fetch(`${env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/${path}`, { ...init, headers });
  const body = await response.text();
  if (!response.ok) throw new Error(`Supabase transcription: ${response.status} ${body}`);
  return (body ? JSON.parse(body) : null) as T;
}

async function patchMessage(env: VoiceTranscriptionEnv, messageId: string, patch: JsonRecord): Promise<void> {
  await db<unknown>(env, `marketing_messages?id=eq.${encodeURIComponent(messageId)}`, {
    method: 'PATCH',
    headers: { prefer: 'return=minimal' },
    body: JSON.stringify(patch),
  });
}

async function loadMessage(env: VoiceTranscriptionEnv, messageId: string): Promise<MessageRow | null> {
  const rows = await db<MessageRow[]>(env,
    `marketing_messages?id=eq.${encodeURIComponent(messageId)}&select=id,attachment_path,attachment_name,attachment_mime_type,attachment_size_bytes,transcription_text,transcription_status&limit=1`,
  );
  return rows[0] || null;
}

async function downloadAudio(env: VoiceTranscriptionEnv, path: string): Promise<ArrayBuffer> {
  const response = await fetch(
    `${env.SUPABASE_URL.replace(/\/$/, '')}/storage/v1/object/${STORAGE_BUCKET}/${path}`,
    { headers: authHeaders(env) },
  );
  if (!response.ok) throw new Error(`Storage audio download: ${response.status} ${await response.text()}`);
  return response.arrayBuffer();
}

async function transcribeAudio(
  env: VoiceTranscriptionEnv,
  bytes: ArrayBuffer,
  filename: string,
  mimeType: string,
): Promise<{ transcript: string; model: string }> {
  const apiKey = text(env.OPENAI_API_KEY);
  if (!apiKey) throw new Error('OPENAI_API_KEY не настроен в Cloudflare');
  const model = text(env.OPENAI_TRANSCRIPTION_MODEL) || 'gpt-4o-mini-transcribe';
  const form = new FormData();
  form.set('model', model);
  form.set('response_format', 'json');
  form.set('file', new File([bytes], filename || 'voice.ogg', { type: mimeType || 'audio/ogg' }));

  const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}` },
    body: form,
  });
  const body = await response.text();
  let parsed: JsonRecord = {};
  try { parsed = body ? JSON.parse(body) as JsonRecord : {}; } catch { parsed = { error: body }; }
  if (!response.ok) {
    const error = parsed.error && typeof parsed.error === 'object' ? parsed.error as JsonRecord : {};
    throw new Error(text(error.message) || text(parsed.error) || `OpenAI transcription: ${response.status}`);
  }
  const transcript = text(parsed.text);
  if (!transcript) throw new Error('Сервис транскрипции вернул пустой текст');
  return { transcript, model };
}

export async function handleVoiceTranscriptionRequest(
  request: Request,
  env: VoiceTranscriptionEnv,
  url: URL,
): Promise<Response | null> {
  const match = url.pathname.match(/^\/api\/callcenter\/messages\/([^/]+)\/transcribe$/);
  if (!match) return null;
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const role = text(request.headers.get('x-amanat-auth-role')).toLowerCase();
  if (!WRITE_ROLES.has(role)) return json({ error: 'Расшифровка доступна администратору и маркетологу' }, 403);

  const messageId = decodeURIComponent(match[1]);
  try {
    const message = await loadMessage(env, messageId);
    if (!message) return json({ error: 'Сообщение не найдено' }, 404);
    const cached = text(message.transcription_text);
    if (cached) return json({ ok: true, cached: true, transcript: cached });

    const path = text(message.attachment_path);
    const mimeType = text(message.attachment_mime_type).toLowerCase();
    if (!path || !mimeType.startsWith(AUDIO_MIME_PREFIX)) {
      return json({ error: 'У сообщения нет голосового или аудиофайла' }, 400);
    }
    const declaredSize = Number(message.attachment_size_bytes || 0);
    if (declaredSize > MAX_AUDIO_BYTES) return json({ error: 'Аудиофайл превышает лимит 25 МБ' }, 413);
    if (message.transcription_status === 'processing') return json({ error: 'Расшифровка уже выполняется' }, 409);

    await patchMessage(env, messageId, {
      transcription_status: 'processing',
      transcription_error: null,
      updated_at: new Date().toISOString(),
    });

    const audio = await downloadAudio(env, path);
    if (!audio.byteLength || audio.byteLength > MAX_AUDIO_BYTES) throw new Error('Размер аудиофайла должен быть от 1 байта до 25 МБ');
    const result = await transcribeAudio(env, audio, text(message.attachment_name) || 'voice.ogg', mimeType);
    const transcribedAt = new Date().toISOString();
    await patchMessage(env, messageId, {
      transcription_text: result.transcript,
      transcription_status: 'completed',
      transcription_model: result.model,
      transcription_error: null,
      transcribed_at: transcribedAt,
      updated_at: transcribedAt,
    });
    return json({ ok: true, cached: false, transcript: result.transcript, model: result.model, transcribedAt });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await patchMessage(env, messageId, {
      transcription_status: 'failed',
      transcription_error: message.slice(0, 1000),
      updated_at: new Date().toISOString(),
    }).catch(() => undefined);
    console.error('Voice transcription failed', { messageId, error: message });
    return json({ error: message }, 502);
  }
}
