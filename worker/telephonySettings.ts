import type { Env } from './integrations';
import { requireCompanyId, type TenantScopedEnv } from './tenantScope';

type Row = Record<string, unknown>;
type TelephonySettingsEnv = Env & TenantScopedEnv;

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});
const text = (value: unknown): string => typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim();
const role = (request: Request) => text(request.headers.get('x-amanat-auth-role')).toLowerCase();
const isAdmin = (request: Request) => role(request) === 'administrator';
const asBool = (value: unknown, fallback: boolean) => typeof value === 'boolean' ? value : fallback;
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
  if (!response.ok) throw new Error(`Telephony settings DB ${response.status}: ${body.slice(0, 1200)}`);
  return (body ? JSON.parse(body) : null) as T;
}

async function getSettings(env: TelephonySettingsEnv): Promise<Row> {
  const companyId = requireCompanyId(env);
  const rows = await db<Row[]>(env, `telephony_settings?company_id=eq.${encodeURIComponent(companyId)}&select=*&limit=1`);
  if (rows[0]) return rows[0];
  const created = await db<Row[]>(env, 'telephony_settings?on_conflict=company_id', {
    method: 'POST',
    headers: { prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify({ company_id: companyId, provider: 'zadarma' }),
  });
  return created[0] || {};
}

async function saveSettings(request: Request, env: TelephonySettingsEnv): Promise<Response> {
  if (!isAdmin(request)) return json({ error: 'Настройки телефонии доступны только администратору' }, 403);
  const companyId = requireCompanyId(env);
  const body = await request.json().catch(() => null) as Row | null;
  if (!body) return json({ error: 'Некорректный JSON' }, 400);
  const current = await getSettings(env);
  const autoTranscribe = asBool(body.autoTranscribe, Boolean(current.auto_transcribe));
  const autoAnalyze = asBool(body.autoAnalyze, Boolean(current.auto_analyze));
  if (autoAnalyze && !autoTranscribe) return json({ error: 'Авто AI-анализ требует включённой автотранскрипции' }, 400);

  const payload = {
    company_id: companyId,
    provider: 'zadarma',
    auto_transcribe: autoTranscribe,
    auto_analyze: autoAnalyze,
    transcription_model: 'gpt-4o-mini-transcribe',
    recording_delay_seconds: asInt(body.recordingDelaySeconds, Number(current.recording_delay_seconds || 45), 0, 600),
    max_attempts: asInt(body.maxAttempts, Number(current.max_attempts || 3), 1, 10),
    retry_after_minutes: asInt(body.retryAfterMinutes, Number(current.retry_after_minutes || 15), 1, 1440),
    inbound_capture_enabled: asBool(body.inboundCaptureEnabled, current.inbound_capture_enabled !== false),
    missed_call_tasks_enabled: asBool(body.missedCallTasksEnabled, current.missed_call_tasks_enabled !== false),
    missed_call_task_delay_minutes: asInt(body.missedCallTaskDelayMinutes, Number(current.missed_call_task_delay_minutes || 0), 0, 1440),
    updated_at: new Date().toISOString(),
  };
  const saved = await db<Row[]>(env, 'telephony_settings?on_conflict=company_id', {
    method: 'POST',
    headers: { prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify(payload),
  });
  return json({ settings: saved[0] || payload });
}

export async function handleTelephonySettings(request: Request, env: TelephonySettingsEnv, url: URL): Promise<Response | null> {
  if (!['/api/telephony/settings', '/api/integrations/zadarma/telephony-settings'].includes(url.pathname)) return null;
  if (request.method === 'GET') return json({ settings: await getSettings(env) });
  if (request.method === 'PUT') return saveSettings(request, env);
  return json({ error: 'Method not allowed' }, 405);
}
