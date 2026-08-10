type JsonRecord = Record<string, unknown>;

export type ZadarmaTelephonyEnv = {
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  ZADARMA_API_KEY?: string;
  ZADARMA_API_SECRET?: string;
  ZADARMA_PBX_EXTENSION?: string;
  ZADARMA_TENANT_CONFIGURED?: string;
  CURRENT_COMPANY_ID?: string;
  DEFAULT_COMPANY_ID?: string;
};

const ZADARMA_API_BASE = 'https://api.zadarma.com';

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim();
}

function cleanPhone(value: unknown): string {
  const raw = asString(value);
  let digits = raw.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('8')) digits = `7${digits.slice(1)}`;
  if (digits.length === 10) digits = `7${digits}`;
  return digits.slice(0, 15);
}

function rotateLeft(value: number, shift: number): number {
  return (value << shift) | (value >>> (32 - shift));
}

function add32(a: number, b: number): number {
  return (a + b) | 0;
}

function md5Cycle(state: number[], block: number[]): void {
  let [a, b, c, d] = state;
  const ff = (x: number, y: number, z: number) => (x & y) | (~x & z);
  const gg = (x: number, y: number, z: number) => (x & z) | (y & ~z);
  const hh = (x: number, y: number, z: number) => x ^ y ^ z;
  const ii = (x: number, y: number, z: number) => y ^ (x | ~z);
  const step = (fn: (x: number, y: number, z: number) => number, w: number, x: number, y: number, z: number, data: number, shift: number, constant: number) =>
    add32(rotateLeft(add32(add32(w, fn(x, y, z)), add32(data, constant)), shift), x);

  const s1 = [7, 12, 17, 22];
  const s2 = [5, 9, 14, 20];
  const s3 = [4, 11, 16, 23];
  const s4 = [6, 10, 15, 21];
  const k = Array.from({ length: 64 }, (_, index) => Math.floor(Math.abs(Math.sin(index + 1)) * 0x100000000) | 0);

  for (let index = 0; index < 64; index += 1) {
    let f: (x: number, y: number, z: number) => number;
    let g: number;
    let shift: number;
    if (index < 16) {
      f = ff;
      g = index;
      shift = s1[index % 4];
    } else if (index < 32) {
      f = gg;
      g = (5 * index + 1) % 16;
      shift = s2[index % 4];
    } else if (index < 48) {
      f = hh;
      g = (3 * index + 5) % 16;
      shift = s3[index % 4];
    } else {
      f = ii;
      g = (7 * index) % 16;
      shift = s4[index % 4];
    }
    const nextD = d;
    d = c;
    c = b;
    b = step(f, a, b, c, d, block[g], shift, k[index]);
    a = nextD;
  }

  state[0] = add32(state[0], a);
  state[1] = add32(state[1], b);
  state[2] = add32(state[2], c);
  state[3] = add32(state[3], d);
}

function md5Hex(value: string): string {
  const bytes = new TextEncoder().encode(value);
  const bitLength = bytes.length * 8;
  const paddedLength = ((bytes.length + 9 + 63) >> 6) << 6;
  const buffer = new Uint8Array(paddedLength);
  buffer.set(bytes);
  buffer[bytes.length] = 0x80;
  const view = new DataView(buffer.buffer);
  view.setUint32(paddedLength - 8, bitLength >>> 0, true);
  view.setUint32(paddedLength - 4, Math.floor(bitLength / 0x100000000), true);

  const state = [0x67452301, -0x10325477, -0x67452302, 0x10325476];
  for (let offset = 0; offset < paddedLength; offset += 64) {
    const block = Array.from({ length: 16 }, (_, index) => view.getInt32(offset + index * 4, true));
    md5Cycle(state, block);
  }

  return state.map((part) => {
    const bytesPart = [part & 0xff, (part >>> 8) & 0xff, (part >>> 16) & 0xff, (part >>> 24) & 0xff];
    return bytesPart.map((byte) => byte.toString(16).padStart(2, '0')).join('');
  }).join('');
}

function base64(bytes: ArrayBuffer): string {
  let binary = '';
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function hmacSha1Base64(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign'],
  );
  return base64(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value)));
}

function sortedQuery(params: Record<string, string>): string {
  const search = new URLSearchParams();
  for (const key of Object.keys(params).sort()) search.set(key, params[key]);
  return search.toString();
}

async function signature(secret: string, path: string, params: Record<string, string>): Promise<string> {
  const query = sortedQuery(params);
  return hmacSha1Base64(secret, `${path}${query}${md5Hex(query)}`);
}

export async function zadarmaRequest(
  env: ZadarmaTelephonyEnv,
  path: string,
  params: Record<string, string> = {},
): Promise<JsonRecord> {
  const key = asString(env.ZADARMA_API_KEY);
  const secret = asString(env.ZADARMA_API_SECRET);
  if (!key || !secret) throw new Error('Zadarma API key/secret не настроены');

  const query = sortedQuery(params);
  const authSignature = await signature(secret, path, params);
  const response = await fetch(`${ZADARMA_API_BASE}${path}${query ? `?${query}` : ''}`, {
    method: 'GET',
    headers: {
      accept: 'application/json',
      authorization: `${key}: ${authSignature}`,
    },
  });
  const body = await response.text();
  let payload: JsonRecord = {};
  try {
    payload = body ? JSON.parse(body) as JsonRecord : {};
  } catch {
    throw new Error(`Zadarma ${response.status}: ${body || 'invalid JSON'}`);
  }
  if (!response.ok || payload.status === 'error') {
    const message = asString(payload.message || payload.error || body) || `HTTP ${response.status}`;
    throw new Error(`Zadarma: ${message}`);
  }
  return payload;
}

function tenantAllowed(env: ZadarmaTelephonyEnv): boolean {
  const current = asString(env.CURRENT_COMPANY_ID);
  const fallbackCompany = asString(env.DEFAULT_COMPANY_ID);
  if (asString(env.ZADARMA_TENANT_CONFIGURED) === 'true') return true;
  return Boolean(current && fallbackCompany && current === fallbackCompany);
}

function configured(env: ZadarmaTelephonyEnv): boolean {
  return tenantAllowed(env)
    && Boolean(asString(env.ZADARMA_API_KEY) && asString(env.ZADARMA_API_SECRET) && asString(env.ZADARMA_PBX_EXTENSION));
}

function dbHeaders(env: ZadarmaTelephonyEnv, extra: HeadersInit = {}): Headers {
  const serviceRole = asString(env.SUPABASE_SERVICE_ROLE_KEY);
  const next = new Headers(extra);
  next.set('apikey', serviceRole);
  next.set('authorization', `Bearer ${serviceRole}`);
  next.set('content-type', 'application/json');
  next.set('accept', 'application/json');
  return next;
}

async function db<T>(env: ZadarmaTelephonyEnv, path: string, init: RequestInit = {}): Promise<T> {
  const base = asString(env.SUPABASE_URL).replace(/\/$/, '');
  if (!base || !asString(env.SUPABASE_SERVICE_ROLE_KEY)) throw new Error('Supabase service role не настроен');
  const response = await fetch(`${base}/rest/v1/${path}`, { ...init, headers: dbHeaders(env, init.headers), cache: 'no-store' });
  const raw = await response.text();
  if (!response.ok) throw new Error(`Telephony DB ${response.status}: ${raw.slice(0, 1000)}`);
  return (raw ? JSON.parse(raw) : null) as T;
}

async function createCallRequest(request: Request, env: ZadarmaTelephonyEnv, phone: string, extension: string): Promise<{ callId: string; requestId: string }> {
  const companyId = asString(env.CURRENT_COMPANY_ID);
  if (!companyId) throw new Error('Не выбрана текущая клиника');
  const userId = asString(request.headers.get('x-amanat-auth-user'));
  const now = new Date();
  const calls = await db<JsonRecord[]>(env, 'marketing_calls?select=id', {
    method: 'POST',
    headers: { prefer: 'return=representation' },
    body: JSON.stringify({
      company_id: companyId,
      operator_user_id: /^[0-9a-f-]{36}$/i.test(userId) ? userId : null,
      client_phone: `+${phone}`,
      source: 'ZADARMA',
      channel: 'PHONE',
      call_status: 'PENDING',
      started_at: now.toISOString(),
      duration_seconds: 0,
      transcription_status: 'idle',
      metadata: { provider: 'zadarma', direction: 'OUTBOUND', extension },
    }),
  });
  const callId = asString(calls[0]?.id);
  if (!callId) throw new Error('Не удалось создать карточку исходящего звонка');

  try {
    const callbacks = await db<JsonRecord[]>(env, 'telephony_callback_requests?select=id', {
      method: 'POST',
      headers: { prefer: 'return=representation' },
      body: JSON.stringify({
        company_id: companyId,
        marketing_call_id: callId,
        extension,
        destination: phone,
        status: 'requested',
        requested_at: now.toISOString(),
        expires_at: new Date(now.getTime() + 10 * 60 * 1000).toISOString(),
      }),
    });
    const requestId = asString(callbacks[0]?.id);
    if (!requestId) throw new Error('Не удалось создать correlation request');
    return { callId, requestId };
  } catch (error) {
    await db(env, `marketing_calls?id=eq.${encodeURIComponent(callId)}&company_id=eq.${encodeURIComponent(companyId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ call_status: 'CANCELLED', call_result: 'Ошибка подготовки Zadarma callback', updated_at: new Date().toISOString() }),
    }).catch(() => undefined);
    throw error;
  }
}

async function markRequestFailed(env: ZadarmaTelephonyEnv, ids: { callId: string; requestId: string }, error: unknown): Promise<void> {
  const companyId = asString(env.CURRENT_COMPANY_ID);
  const message = error instanceof Error ? error.message : String(error);
  const now = new Date().toISOString();
  await Promise.all([
    db(env, `telephony_callback_requests?id=eq.${encodeURIComponent(ids.requestId)}&company_id=eq.${encodeURIComponent(companyId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'failed', last_error: message.slice(0, 1000), completed_at: now, updated_at: now }),
    }).catch(() => undefined),
    db(env, `marketing_calls?id=eq.${encodeURIComponent(ids.callId)}&company_id=eq.${encodeURIComponent(companyId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ call_status: 'CANCELLED', call_result: message.slice(0, 500), updated_at: now }),
    }).catch(() => undefined),
  ]);
}

export async function handleZadarmaTelephony(
  request: Request,
  env: ZadarmaTelephonyEnv,
  url: URL,
): Promise<Response | null> {
  if (!url.pathname.startsWith('/api/telephony/')) return null;

  const extension = asString(env.ZADARMA_PBX_EXTENSION);
  const tenantConfigured = asString(env.ZADARMA_TENANT_CONFIGURED) === 'true';
  const usingLegacyDefaultFallback = !tenantConfigured && tenantAllowed(env);

  if (url.pathname === '/api/telephony/status' && request.method === 'GET') {
    return json({
      provider: 'zadarma',
      configured: configured(env),
      extension: configured(env) ? extension || null : null,
      mode: 'callback',
      credentialScope: tenantConfigured ? 'clinic' : usingLegacyDefaultFallback ? 'default-clinic-fallback' : 'unconfigured',
      capabilities: ['outbound_callback', 'webrtc_key', 'recording_pull', 'transcription', 'signed_webhook'],
    });
  }

  if (!tenantAllowed(env)) {
    return json({ error: 'Zadarma не настроена для выбранной клиники. Добавьте отдельные credentials этой клиники.' }, 409);
  }

  if (url.pathname === '/api/telephony/test' && request.method === 'POST') {
    if (!configured(env)) return json({ error: 'Zadarma не настроена' }, 400);
    try {
      const result = await zadarmaRequest(env, '/v1/info/balance/');
      return json({ ok: true, provider: 'zadarma', balance: result });
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  }

  if (url.pathname === '/api/telephony/webrtc-key' && request.method === 'GET') {
    if (!configured(env)) return json({ error: 'Zadarma не настроена' }, 400);
    try {
      const result = await zadarmaRequest(env, '/v1/webrtc/get_key/', { sip: extension });
      return json({ provider: 'zadarma', sip: extension, key: result.key || null });
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  }

  if (url.pathname === '/api/telephony/calls' && request.method === 'POST') {
    if (!configured(env)) return json({ error: 'Zadarma не настроена. Добавьте API key, API secret и внутренний номер АТС.' }, 400);
    const payload = await request.json().catch(() => ({})) as JsonRecord;
    const phone = cleanPhone(payload.phone);
    if (phone.length < 10) return json({ error: 'Некорректный номер телефона' }, 400);

    let ids: { callId: string; requestId: string } | null = null;
    try {
      ids = await createCallRequest(request, env, phone, extension);
      const result = await zadarmaRequest(env, '/v1/request/callback/', {
        from: extension,
        to: phone,
        sip: extension,
      });
      return json({
        ok: true,
        provider: 'zadarma',
        mode: 'callback',
        extension,
        phone: `+${phone}`,
        marketingCallId: ids.callId,
        correlationRequestId: ids.requestId,
        result,
      });
    } catch (error) {
      if (ids) await markRequestFailed(env, ids, error);
      return json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  }

  return json({ error: 'Telephony route not found' }, 404);
}
