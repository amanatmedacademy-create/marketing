import { zadarmaRequest, type ZadarmaTelephonyEnv } from './zadarmaTelephony';

type Row = Record<string, unknown>;

type Env = ZadarmaTelephonyEnv & {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
};

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});
const text = (value: unknown): string => typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim();
const isAdmin = (request: Request) => text(request.headers.get('x-amanat-auth-role')).toLowerCase() === 'administrator';

function dbHeaders(env: Env, extra: HeadersInit = {}): Headers {
  const headers = new Headers(extra);
  headers.set('apikey', env.SUPABASE_SERVICE_ROLE_KEY);
  headers.set('authorization', `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`);
  headers.set('content-type', 'application/json');
  headers.set('accept', 'application/json');
  return headers;
}

async function db<T>(env: Env, path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/${path}`, {
    ...init,
    headers: dbHeaders(env, init.headers),
    cache: 'no-store',
  });
  const raw = await response.text();
  if (!response.ok) throw new Error(`Zadarma webhook setup DB ${response.status}: ${raw.slice(0, 1200)}`);
  return (raw ? JSON.parse(raw) : null) as T;
}

function companyId(env: Env): string {
  const value = text(env.CURRENT_COMPANY_ID);
  if (!value) throw new Error('Не выбрана текущая клиника');
  return value;
}

function expectedWebhookUrl(request: Request, env: Env): string {
  return `${new URL(request.url).origin}/api/telephony/zadarma/webhook/${companyId(env)}`;
}

function notificationFlag(remote: Row, key: string): boolean {
  const notifications = remote.notifications && typeof remote.notifications === 'object' ? remote.notifications as Row : {};
  return text(notifications[key]).toLowerCase() === 'true';
}

async function localHealth(env: Env, id: string): Promise<{ settings: Row | null; callback: Row | null; call: Row | null }> {
  const [settingsRows, callbackRows, callRows] = await Promise.all([
    db<Row[]>(env, `telephony_settings?company_id=eq.${encodeURIComponent(id)}&select=*&limit=1`),
    db<Row[]>(env, `telephony_callback_requests?company_id=eq.${encodeURIComponent(id)}&select=id,status,pbx_call_id,requested_at,matched_at,completed_at,last_error&order=requested_at.desc&limit=1`),
    db<Row[]>(env, `marketing_calls?company_id=eq.${encodeURIComponent(id)}&source=eq.ZADARMA&select=id,call_status,pbx_call_id,recording_external_id,transcription_status,started_at,updated_at&order=started_at.desc&limit=1`),
  ]);
  return { settings: settingsRows[0] || null, callback: callbackRows[0] || null, call: callRows[0] || null };
}

async function saveCheck(env: Env, id: string, patch: Row): Promise<void> {
  await db(env, 'telephony_settings?on_conflict=company_id', {
    method: 'POST',
    headers: { prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ company_id: id, provider: 'zadarma', ...patch, updated_at: new Date().toISOString() }),
  });
}

async function readRemote(request: Request, env: Env): Promise<Response> {
  const id = companyId(env);
  const expectedUrl = expectedWebhookUrl(request, env);
  const checkedAt = new Date().toISOString();
  try {
    const remote = await zadarmaRequest(env, '/v1/pbx/callinfo/');
    const configuredUrl = text(remote.url);
    const outStart = notificationFlag(remote, 'notify_out_start');
    const outEnd = notificationFlag(remote, 'notify_out_end');
    const healthy = configuredUrl === expectedUrl && outStart && outEnd;
    await saveCheck(env, id, {
      webhook_last_checked_at: checkedAt,
      webhook_last_error: healthy ? null : 'Zadarma webhook URL или обязательные outgoing notifications не совпадают с IMDS',
      webhook_configured_at: healthy ? checkedAt : null,
    });
    const local = await localHealth(env, id);
    return json({
      ok: true,
      healthy,
      expectedUrl,
      configuredUrl,
      notifications: remote.notifications || {},
      required: { notify_out_start: true, notify_out_end: true },
      checkedAt,
      local,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await saveCheck(env, id, { webhook_last_checked_at: checkedAt, webhook_last_error: message.slice(0, 1000) }).catch(() => undefined);
    return json({ error: message, expectedUrl, checkedAt }, 400);
  }
}

async function setup(request: Request, env: Env): Promise<Response> {
  if (!isAdmin(request)) return json({ error: 'Настройка Zadarma webhook доступна только администратору' }, 403);
  const id = companyId(env);
  const webhookUrl = expectedWebhookUrl(request, env);
  const checkedAt = new Date().toISOString();
  try {
    await zadarmaRequest(env, '/v1/pbx/callinfo/url/', { url: webhookUrl }, 'POST');
    await zadarmaRequest(env, '/v1/pbx/callinfo/notifications/', {
      notify_out_start: 'true',
      notify_out_end: 'true',
    }, 'POST');

    const remote = await zadarmaRequest(env, '/v1/pbx/callinfo/');
    const configuredUrl = text(remote.url);
    const outStart = notificationFlag(remote, 'notify_out_start');
    const outEnd = notificationFlag(remote, 'notify_out_end');
    if (configuredUrl !== webhookUrl || !outStart || !outEnd) {
      throw new Error('Zadarma приняла запрос, но повторная проверка webhook settings не подтвердила нужную конфигурацию');
    }

    await saveCheck(env, id, {
      webhook_configured_at: checkedAt,
      webhook_last_checked_at: checkedAt,
      webhook_last_error: null,
    });
    const local = await localHealth(env, id);
    return json({
      ok: true,
      healthy: true,
      expectedUrl: webhookUrl,
      configuredUrl,
      notifications: remote.notifications || {},
      checkedAt,
      local,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await saveCheck(env, id, { webhook_last_checked_at: checkedAt, webhook_last_error: message.slice(0, 1000) }).catch(() => undefined);
    return json({ error: message, expectedUrl: webhookUrl, checkedAt }, 400);
  }
}

export async function handleZadarmaWebhookSetup(request: Request, env: Env, url: URL): Promise<Response | null> {
  if (url.pathname === '/api/integrations/zadarma/webhook-status' && request.method === 'GET') {
    return readRemote(request, env);
  }
  if (url.pathname === '/api/integrations/zadarma/webhook-setup' && request.method === 'POST') {
    return setup(request, env);
  }
  return null;
}
