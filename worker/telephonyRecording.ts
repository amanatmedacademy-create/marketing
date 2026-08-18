import type { Env } from './integrations';
import { requireCompanyId, type TenantScopedEnv } from './tenantScope';
import { zadarmaRequest, type ZadarmaTelephonyEnv } from './zadarmaTelephony';

type Row = Record<string, unknown>;
export type TelephonyProvider = 'zadarma' | 'asterisk' | 'freepbx' | 'twilio' | 'voximplant' | 'sip' | 'binotel' | 'sipuni';
export type TelephonyRecordingEnv = Env & TenantScopedEnv & ZadarmaTelephonyEnv;

const BUCKET = 'telephony-recordings';
const MAX_TRANSCRIPTION_BYTES = 24 * 1024 * 1024;
const MAX_ARCHIVE_BYTES = 256 * 1024 * 1024;
const PROVIDERS: TelephonyProvider[] = ['zadarma', 'asterisk', 'freepbx', 'twilio', 'voximplant', 'sip', 'binotel', 'sipuni'];
const text = (value: unknown): string => typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim();

function serviceHeaders(env: TelephonyRecordingEnv, extra: HeadersInit = {}): Headers {
  const headers = new Headers(extra);
  headers.set('apikey', env.SUPABASE_SERVICE_ROLE_KEY);
  headers.set('authorization', `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`);
  return headers;
}

async function db<T>(env: TelephonyRecordingEnv, path: string, init: RequestInit = {}): Promise<T> {
  const headers = serviceHeaders(env, init.headers);
  if (!headers.has('content-type')) headers.set('content-type', 'application/json');
  headers.set('accept', 'application/json');
  const response = await fetch(`${env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/${path}`, { ...init, headers, cache: 'no-store' });
  const raw = await response.text();
  if (!response.ok) throw new Error(`Telephony recording DB ${response.status}: ${raw.slice(0, 1200)}`);
  return (raw ? JSON.parse(raw) : null) as T;
}

async function patchCall(env: TelephonyRecordingEnv, companyId: string, callId: string, patch: Row): Promise<void> {
  await db<Row[]>(env, `marketing_calls?id=eq.${encodeURIComponent(callId)}&company_id=eq.${encodeURIComponent(companyId)}&select=id`, {
    method: 'PATCH',
    body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() }),
  });
}

function providerFor(call: Row): TelephonyProvider {
  const explicit = text(call.telephony_provider).toLowerCase();
  if (PROVIDERS.includes(explicit as TelephonyProvider)) return explicit as TelephonyProvider;
  const metadata = call.metadata && typeof call.metadata === 'object' && !Array.isArray(call.metadata) ? call.metadata as Row : {};
  const fromMetadata = text(metadata.provider).toLowerCase();
  if (PROVIDERS.includes(fromMetadata as TelephonyProvider)) return fromMetadata as TelephonyProvider;
  if (text(call.source).toUpperCase() === 'ZADARMA') return 'zadarma';
  return 'sip';
}

function extensionFor(contentType: string, url = ''): string {
  const path = url.toLowerCase();
  const explicit = path.match(/\.(mp3|wav|m4a|ogg|webm|mp4|mpeg|mpga|flac)(?:$|\?)/)?.[1];
  if (explicit) return explicit;
  if (contentType.includes('wav')) return 'wav';
  if (contentType.includes('ogg')) return 'ogg';
  if (contentType.includes('webm')) return 'webm';
  if (contentType.includes('mp4')) return 'mp4';
  if (contentType.includes('flac')) return 'flac';
  return 'mp3';
}

function privateHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return true;
  if (host === '::1' || host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80:')) return true;
  const parts = host.split('.').map(Number);
  if (parts.length === 4 && parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)) {
    const [a, b] = parts;
    return a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a === 0;
  }
  return false;
}

function safeHttpsRecordingUrl(raw: unknown, provider: TelephonyProvider): string {
  const value = text(raw);
  if (!value) return '';
  const url = new URL(value);
  if (url.protocol !== 'https:') throw new Error('Recording URL must use HTTPS');
  if (url.username || url.password || privateHostname(url.hostname)) throw new Error('Недопустимый URL записи телефонии');
  if (provider === 'zadarma' && url.hostname !== 'api.zadarma.com') throw new Error('Недопустимый URL записи Zadarma');
  return url.toString();
}

function zadarmaRecordingLink(payload: Row): string {
  const direct = text(payload.link);
  if (direct) return safeHttpsRecordingUrl(direct, 'zadarma');
  const links = Array.isArray(payload.links) ? payload.links.map(text).filter(Boolean) : [];
  if (links[0]) return safeHttpsRecordingUrl(links[0], 'zadarma');
  return '';
}

async function resolveProviderRecordingUrl(env: TelephonyRecordingEnv, call: Row): Promise<string> {
  const provider = providerFor(call);
  if (provider === 'zadarma') {
    const pbxCallId = text(call.pbx_call_id);
    const externalCallId = text(call.recording_external_id);
    if (pbxCallId || externalCallId) {
      const params: Record<string, string> = pbxCallId
        ? { pbx_call_id: pbxCallId, lifetime: '600' }
        : { call_id: externalCallId, lifetime: '600' };
      const result = await zadarmaRequest(env, '/v1/pbx/record/request/', params);
      const link = zadarmaRecordingLink(result);
      if (link) return link;
    }
  }

  const storedProviderUrl = text(call.recording_url);
  if (storedProviderUrl) return safeHttpsRecordingUrl(storedProviderUrl, provider);
  throw new Error(`У звонка нет доступной записи провайдера ${provider}`);
}

function storageObjectUrl(env: TelephonyRecordingEnv, path: string, authenticated = false): string {
  const base = env.SUPABASE_URL.replace(/\/$/, '');
  const encodedPath = path.split('/').map(encodeURIComponent).join('/');
  return `${base}/storage/v1/object/${authenticated ? 'authenticated/' : ''}${BUCKET}/${encodedPath}`;
}

function archivedPath(companyId: string, call: Row, contentType: string, sourceUrl: string): string {
  const startedAt = new Date(text(call.started_at) || Date.now());
  const year = Number.isFinite(startedAt.getTime()) ? startedAt.getUTCFullYear() : new Date().getUTCFullYear();
  const month = String((Number.isFinite(startedAt.getTime()) ? startedAt.getUTCMonth() : new Date().getUTCMonth()) + 1).padStart(2, '0');
  return `${companyId}/${year}/${month}/${text(call.id)}.${extensionFor(contentType, sourceUrl)}`;
}

export async function ensureArchivedRecording(env: TelephonyRecordingEnv, call: Row): Promise<Row> {
  const companyId = requireCompanyId(env);
  const callId = text(call.id);
  if (!callId) throw new Error('У звонка отсутствует ID');
  if (text(call.recording_storage_path)) return call;

  await patchCall(env, companyId, callId, { recording_ingest_status: 'processing', recording_ingest_error: null });
  try {
    const sourceUrl = await resolveProviderRecordingUrl(env, call);
    const upstream = await fetch(sourceUrl, { headers: { accept: 'audio/*,video/*,application/octet-stream' }, redirect: 'follow' });
    if (!upstream.ok) throw new Error(`Recording provider HTTP ${upstream.status}`);
    const length = Number(upstream.headers.get('content-length') || 0);
    if (length > MAX_ARCHIVE_BYTES) throw new Error('Запись превышает лимит архива IMDS 256 MB');
    const contentType = text(upstream.headers.get('content-type')) || 'audio/mpeg';
    const path = archivedPath(companyId, call, contentType, sourceUrl);
    const uploadHeaders = serviceHeaders(env, {
      'content-type': contentType,
      'cache-control': 'private, max-age=0',
      'x-upsert': 'false',
    });
    const uploaded = await fetch(storageObjectUrl(env, path), {
      method: 'POST',
      headers: uploadHeaders,
      body: upstream.body,
    });
    const uploadBody = await uploaded.text();
    if (!uploaded.ok && uploaded.status !== 409 && !/already exists/i.test(uploadBody)) {
      throw new Error(`IMDS Storage ${uploaded.status}: ${uploadBody.slice(0, 500)}`);
    }
    const archivedAt = new Date().toISOString();
    await patchCall(env, companyId, callId, {
      telephony_provider: providerFor(call),
      recording_ingest_status: 'stored',
      recording_storage_bucket: BUCKET,
      recording_storage_path: path,
      recording_content_type: contentType,
      recording_size_bytes: length || null,
      recording_archived_at: archivedAt,
      recording_ingest_error: null,
    });
    return {
      ...call,
      telephony_provider: providerFor(call),
      recording_ingest_status: 'stored',
      recording_storage_bucket: BUCKET,
      recording_storage_path: path,
      recording_content_type: contentType,
      recording_size_bytes: length || null,
      recording_archived_at: archivedAt,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await patchCall(env, companyId, callId, { recording_ingest_status: 'failed', recording_ingest_error: message.slice(0, 1000) }).catch(() => undefined);
    throw new Error(message);
  }
}

export async function loadArchivedRecording(env: TelephonyRecordingEnv, call: Row): Promise<{ blob: Blob; filename: string; contentType: string }> {
  const path = text(call.recording_storage_path);
  if (!path) throw new Error('Запись ещё не сохранена в IMDS Storage');
  const response = await fetch(storageObjectUrl(env, path, true), {
    headers: serviceHeaders(env, { accept: 'audio/*,video/*,application/octet-stream' }),
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`IMDS Storage download HTTP ${response.status}`);
  const length = Number(response.headers.get('content-length') || call.recording_size_bytes || 0);
  if (length > MAX_TRANSCRIPTION_BYTES) throw new Error('Запись слишком большая для автоматической транскрипции (24 MB)');
  const buffer = await response.arrayBuffer();
  if (!buffer.byteLength) throw new Error('Архивная запись пуста');
  if (buffer.byteLength > MAX_TRANSCRIPTION_BYTES) throw new Error('Запись слишком большая для автоматической транскрипции (24 MB)');
  const contentType = text(response.headers.get('content-type')) || text(call.recording_content_type) || 'audio/mpeg';
  return { blob: new Blob([buffer], { type: contentType }), filename: `call.${extensionFor(contentType, path)}`, contentType };
}

export async function proxyArchivedRecording(request: Request, env: TelephonyRecordingEnv, call: Row): Promise<Response> {
  const archived = text(call.recording_storage_path) ? call : await ensureArchivedRecording(env, call);
  const path = text(archived.recording_storage_path);
  const headers = serviceHeaders(env, { accept: 'audio/*,video/*,application/octet-stream' });
  const range = request.headers.get('range');
  if (range) headers.set('range', range);
  const upstream = await fetch(storageObjectUrl(env, path, true), { method: 'GET', headers, cache: 'no-store' });
  if (!upstream.ok && upstream.status !== 206) throw new Error(`IMDS Storage recording HTTP ${upstream.status}`);
  const responseHeaders = new Headers({
    'content-type': text(upstream.headers.get('content-type')) || text(archived.recording_content_type) || 'audio/mpeg',
    'content-disposition': 'inline',
    'cache-control': 'private, no-store',
  });
  for (const name of ['content-length', 'content-range', 'accept-ranges']) {
    const value = upstream.headers.get(name);
    if (value) responseHeaders.set(name, value);
  }
  return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
}

export function hasRecordingReference(call: Row): boolean {
  return Boolean(text(call.recording_storage_path) || text(call.recording_external_id) || text(call.recording_url) || text(call.pbx_call_id));
}
