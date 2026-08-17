type JsonRecord = Record<string, unknown>;

export type NativeAuthEnv = {
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  IMDS_LOCAL_DB_URL?: string;
  IMDS_LOCAL_SERVICE_ROLE_KEY?: string;
  IMDS_PLATFORM_CONTROL_TOKEN?: string;
  IMDS_SUPER_ADMIN_INTERNAL_URL?: string;
  APP_ORIGIN?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
};

export interface NativeAuthenticatedUser {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  role: string;
  platformRole: 'user' | 'super_admin';
  status: string;
}

const encoder = new TextEncoder();
const text = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
const json = (data: unknown, status = 200, headers: HeadersInit = {}) => new Response(JSON.stringify(data), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
});

function dbUrl(env: NativeAuthEnv): string {
  const value = text(env.IMDS_LOCAL_DB_URL) || text(env.SUPABASE_URL);
  if (!value) throw new Error('IMDS database URL is missing');
  return value.replace(/\/$/, '').replace(/\/rest\/v1$/, '');
}

function serviceKey(env: NativeAuthEnv): string {
  const value = text(env.IMDS_LOCAL_SERVICE_ROLE_KEY) || text(env.SUPABASE_SERVICE_ROLE_KEY);
  if (!value) throw new Error('IMDS database service key is missing');
  return value;
}

function dbHeaders(env: NativeAuthEnv, extra: HeadersInit = {}): Headers {
  const key = serviceKey(env);
  const headers = new Headers({ apikey: key, authorization: `Bearer ${key}`, accept: 'application/json' });
  new Headers(extra).forEach((value, name) => headers.set(name, value));
  return headers;
}

async function db<T>(env: NativeAuthEnv, path: string, init: RequestInit = {}): Promise<T> {
  const base = dbUrl(env);
  const normalized = path.startsWith('/') ? path : `/${path}`;
  const headers = dbHeaders(env, init.headers);
  if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
  const response = await fetch(`${base}/rest/v1${normalized}`, { ...init, headers });
  const raw = await response.text();
  if (!response.ok) {
    let message = raw;
    try {
      const parsed = JSON.parse(raw) as { message?: string; details?: string };
      message = parsed.message || parsed.details || raw;
    } catch { /* keep raw response */ }
    throw new Error(message || `Database HTTP ${response.status}`);
  }
  if (!raw) return undefined as T;
  return JSON.parse(raw) as T;
}

function bearer(request: Request): string {
  const value = request.headers.get('authorization') || '';
  return value.toLowerCase().startsWith('bearer ') ? value.slice(7).trim() : '';
}

function normalizeEmail(value: unknown): string { return text(value).toLowerCase(); }
function validEmail(value: string): boolean { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value); }
function normalizePhone(value: unknown): string {
  const digits = text(value).replace(/\D/g, '');
  return digits.length >= 10 && digits.length <= 15 ? `+${digits}` : '';
}
function slugify(value: string): string {
  return value.toLowerCase().normalize('NFKD').replace(/[^a-z0-9\s-]/g, '').trim().replace(/\s+/g, '-').replace(/-+/g, '-').slice(0, 80) || `company-${crypto.randomUUID().slice(0, 8)}`;
}
function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4);
  const binary = atob(padded);
  const result = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i += 1) result[i] = binary.charCodeAt(i);
  return result;
}
function randomToken(bytes = 32): string { return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(bytes))); }
async function sha256Hex(value: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
  return [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

const PASSWORD_ITERATIONS = 600_000;
async function hashPassword(password: string): Promise<string> {
  if (password.length < 10) throw new Error('Пароль должен содержать минимум 10 символов.');
  if (password.length > 256) throw new Error('Пароль слишком длинный.');
  const salt = crypto.getRandomValues(new Uint8Array(24));
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PASSWORD_ITERATIONS }, key, 256);
  return `pbkdf2_sha256$${PASSWORD_ITERATIONS}$${bytesToBase64Url(salt)}$${bytesToBase64Url(new Uint8Array(bits))}`;
}
async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const [scheme, iterationText, saltText, digestText] = encoded.split('$');
  if (scheme !== 'pbkdf2_sha256' || !iterationText || !saltText || !digestText) return false;
  const iterations = Number(iterationText);
  if (!Number.isFinite(iterations) || iterations < 100_000 || iterations > 1_500_000) return false;
  const salt = base64UrlToBytes(saltText);
  const expected = base64UrlToBytes(digestText);
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const actual = new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, expected.length * 8));
  if (actual.length !== expected.length) return false;
  let difference = 0;
  for (let i = 0; i < actual.length; i += 1) difference |= actual[i] ^ expected[i];
  return difference === 0;
}

function appOrigin(request: Request, env: NativeAuthEnv): string {
  const configured = text(env.APP_ORIGIN);
  if (configured) {
    try { return new URL(configured).origin; } catch { /* use request origin */ }
  }
  return new URL(request.url).origin;
}
export function nativeGoogleConfigured(env: NativeAuthEnv): boolean {
  return Boolean(text(env.GOOGLE_CLIENT_ID) && text(env.GOOGLE_CLIENT_SECRET));
}
function googleRedirectUri(request: Request, env: NativeAuthEnv): string {
  return `${appOrigin(request, env)}/api/auth/google/callback`;
}

async function deliverRegistrationEvent(env: NativeAuthEnv, eventId?: string): Promise<void> {
  const token = text(env.IMDS_PLATFORM_CONTROL_TOKEN);
  if (!token) return;
  const endpoint = (text(env.IMDS_SUPER_ADMIN_INTERNAL_URL) || 'http://127.0.0.1:8788').replace(/\/$/, '');
  const filter = eventId ? `&id=eq.${encodeURIComponent(eventId)}` : '';
  const pending = await db<JsonRecord[]>(env, `/imds_platform_event_outbox?status=eq.pending${filter}&select=id,payload,attempts&order=created_at.asc&limit=20`).catch(() => []);
  for (const row of pending) {
    const id = text(row.id);
    if (!id) continue;
    try {
      const response = await fetch(`${endpoint}/internal/platform/events/registration`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify(row.payload || {}),
        signal: AbortSignal.timeout(5000),
      });
      const responseText = await response.text();
      if (!response.ok) throw new Error(`Super Admin ${response.status}: ${responseText.slice(0, 300)}`);
      await db(env, `/imds_platform_event_outbox?id=eq.${encodeURIComponent(id)}`, {
        method: 'PATCH', headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ status: 'delivered', attempts: Number(row.attempts || 0) + 1, last_error: null, delivered_at: new Date().toISOString(), updated_at: new Date().toISOString() }),
      });
    } catch (error) {
      await db(env, `/imds_platform_event_outbox?id=eq.${encodeURIComponent(id)}`, {
        method: 'PATCH', headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ attempts: Number(row.attempts || 0) + 1, last_error: error instanceof Error ? error.message.slice(0, 1000) : String(error).slice(0, 1000), updated_at: new Date().toISOString() }),
      }).catch(() => undefined);
    }
  }
}

let outboxRetryStarted = false;
function ensureOutboxRetry(env: NativeAuthEnv) {
  if (outboxRetryStarted || !text(env.IMDS_PLATFORM_CONTROL_TOKEN)) return;
  outboxRetryStarted = true;
  const timer = globalThis.setInterval(() => { void deliverRegistrationEvent(env); }, 60_000);
  if (typeof timer === 'object' && timer && 'unref' in timer && typeof (timer as { unref?: unknown }).unref === 'function') {
    (timer as unknown as { unref: () => void }).unref();
  }
}

async function issueSession(env: NativeAuthEnv, authUserId: string, request: Request, remember: boolean): Promise<{ access_token: string; expires_in: number; token_type: string }> {
  const token = randomToken(48);
  const tokenHash = await sha256Hex(token);
  const expiresIn = remember ? 30 * 24 * 60 * 60 : 12 * 60 * 60;
  const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();
  const userAgent = (request.headers.get('user-agent') || '').slice(0, 500) || null;
  const ip = request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || '';
  const ipHash = ip ? await sha256Hex(ip) : null;
  await db<JsonRecord[]>(env, '/imds_auth_sessions', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ user_id: authUserId, token_hash: tokenHash, remember_me: remember, user_agent: userAgent, ip_hash: ipHash, expires_at: expiresAt }),
  });
  return { access_token: token, expires_in: expiresIn, token_type: 'bearer' };
}

async function marketingUserForAuthId(env: NativeAuthEnv, authUserId: string, platformRole: 'user' | 'super_admin' = 'user'): Promise<NativeAuthenticatedUser | null> {
  const rows = await db<JsonRecord[]>(env, `/marketing_users?auth_user_id=eq.${encodeURIComponent(authUserId)}&select=id,email,name,full_name,avatar_url,role,status&limit=1`);
  const row = rows[0];
  if (!row) return null;
  return {
    id: text(row.id),
    email: normalizeEmail(row.email),
    name: text(row.full_name) || text(row.name) || normalizeEmail(row.email).split('@')[0] || 'Пользователь',
    avatarUrl: text(row.avatar_url) || null,
    role: text(row.role) || 'viewer',
    platformRole,
    status: text(row.status) || 'active',
  };
}

export async function authenticateNativeRequest(request: Request, env: NativeAuthEnv): Promise<NativeAuthenticatedUser | null> {
  const token = bearer(request);
  if (!token) return null;
  const tokenHash = await sha256Hex(token);
  const now = new Date().toISOString();
  const sessions = await db<JsonRecord[]>(env, `/imds_auth_sessions?token_hash=eq.${tokenHash}&revoked_at=is.null&expires_at=gt.${encodeURIComponent(now)}&select=id,user_id&limit=1`);
  const session = sessions[0];
  const authUserId = text(session?.user_id);
  if (!authUserId) return null;
  const users = await db<JsonRecord[]>(env, `/imds_auth_users?id=eq.${encodeURIComponent(authUserId)}&status=eq.active&select=id,platform_role&limit=1`);
  if (!users[0]) return null;
  const platformRole = text(users[0].platform_role) === 'super_admin' ? 'super_admin' : 'user';
  return marketingUserForAuthId(env, authUserId, platformRole);
}

async function login(request: Request, env: NativeAuthEnv): Promise<Response> {
  const body = await request.json().catch(() => null) as { email?: string; password?: string; remember?: boolean } | null;
  const email = normalizeEmail(body?.email);
  const password = typeof body?.password === 'string' ? body.password : '';
  if (!validEmail(email) || !password) return json({ error: 'Неверный email или пароль.' }, 400);
  const users = await db<JsonRecord[]>(env, `/imds_auth_users?email=eq.${encodeURIComponent(email)}&select=id,status&limit=1`);
  const user = users[0];
  const authUserId = text(user?.id);
  if (!authUserId || text(user.status) !== 'active') return json({ error: 'Неверный email или пароль.' }, 401);
  const credentials = await db<JsonRecord[]>(env, `/imds_auth_passwords?user_id=eq.${encodeURIComponent(authUserId)}&select=password_hash&limit=1`);
  const passwordHash = text(credentials[0]?.password_hash);
  if (!passwordHash || !(await verifyPassword(password, passwordHash))) return json({ error: 'Неверный email или пароль.' }, 401);
  await db(env, `/imds_auth_users?id=eq.${encodeURIComponent(authUserId)}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ last_login_at: new Date().toISOString(), updated_at: new Date().toISOString() }) });
  return json(await issueSession(env, authUserId, request, body?.remember !== false));
}

async function register(request: Request, env: NativeAuthEnv): Promise<Response> {
  const body = await request.json().catch(() => null) as {
    email?: string; password?: string; displayName?: string; phone?: string; mode?: string; companyName?: string; companyCode?: string; remember?: boolean;
  } | null;
  const email = normalizeEmail(body?.email);
  const displayName = text(body?.displayName);
  const phone = normalizePhone(body?.phone);
  const mode = text(body?.mode);
  if (!validEmail(email)) return json({ error: 'Введите корректный email.' }, 400);
  if (displayName.length < 2) return json({ error: 'Укажите имя пользователя.' }, 400);
  if (!phone) return json({ error: 'Введите корректный номер телефона.' }, 400);
  if (mode !== 'new_company' && mode !== 'join_company') return json({ error: 'Выберите способ регистрации организации.' }, 400);
  const password = typeof body?.password === 'string' ? body.password : '';
  let passwordHash: string;
  try { passwordHash = await hashPassword(password); } catch (error) { return json({ error: error instanceof Error ? error.message : 'Пароль не соответствует требованиям.' }, 400); }
  const companyName = text(body?.companyName);
  const companyCode = text(body?.companyCode).toUpperCase().replace(/\s+/g, '');
  if (mode === 'new_company' && companyName.length < 2) return json({ error: 'Укажите название организации.' }, 400);
  if (mode === 'join_company' && companyCode.length < 6) return json({ error: 'Введите код организации.' }, 400);
  const codeHash = mode === 'join_company' ? await sha256Hex(companyCode) : null;
  try {
    const result = await db<JsonRecord>(env, '/rpc/imds_native_register_account', {
      method: 'POST',
      body: JSON.stringify({
        p_email: email,
        p_display_name: displayName,
        p_password_hash: passwordHash,
        p_mode: mode,
        p_company_name: mode === 'new_company' ? companyName : null,
        p_company_slug: mode === 'new_company' ? slugify(companyName) : null,
        p_company_code_hash: codeHash,
        p_phone: phone,
      }),
    });
    const authUserId = text(result?.auth_user_id);
    if (!authUserId) throw new Error('Регистрация не вернула идентификатор пользователя');
    const registrationEventId = text(result?.registration_event_id);
    if (registrationEventId) void deliverRegistrationEvent(env, registrationEventId);
    return json(await issueSession(env, authUserId, request, body?.remember !== false), 201);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Не удалось создать аккаунт';
    if (message.toLowerCase().includes('already') || message.toLowerCase().includes('уже зарегистрирован')) return json({ error: 'Пользователь с таким email уже зарегистрирован.' }, 409);
    return json({ error: message }, 400);
  }
}

async function logout(request: Request, env: NativeAuthEnv): Promise<Response> {
  const token = bearer(request);
  if (token) {
    const tokenHash = await sha256Hex(token);
    await db(env, `/imds_auth_sessions?token_hash=eq.${tokenHash}&revoked_at=is.null`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ revoked_at: new Date().toISOString() }),
    }).catch(() => undefined);
  }
  return json({ ok: true });
}

async function ensureGoogleUser(env: NativeAuthEnv, profile: JsonRecord): Promise<string> {
  const subject = text(profile.sub);
  const email = normalizeEmail(profile.email);
  const verified = profile.email_verified === true || profile.verified_email === true;
  const name = text(profile.name) || email.split('@')[0] || 'Пользователь';
  const avatar = text(profile.picture) || null;
  if (!subject || !validEmail(email) || !verified) throw new Error('Google не вернул подтверждённый email');

  const identities = await db<JsonRecord[]>(env, `/imds_auth_identities?provider=eq.google&provider_subject=eq.${encodeURIComponent(subject)}&select=user_id&limit=1`);
  let authUserId = text(identities[0]?.user_id);
  if (!authUserId) {
    const existingUsers = await db<JsonRecord[]>(env, `/imds_auth_users?email=eq.${encodeURIComponent(email)}&select=id&limit=1`);
    authUserId = text(existingUsers[0]?.id) || crypto.randomUUID();
    if (!existingUsers[0]) {
      await db(env, '/imds_auth_users', {
        method: 'POST', headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ id: authUserId, email, display_name: name, status: 'active', email_verified: true, last_login_at: new Date().toISOString() }),
      });
    } else {
      await db(env, `/imds_auth_users?id=eq.${encodeURIComponent(authUserId)}`, {
        method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ display_name: name, email_verified: true, last_login_at: new Date().toISOString(), updated_at: new Date().toISOString() }),
      });
    }
    await db(env, '/imds_auth_identities', {
      method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' },
      body: JSON.stringify({ user_id: authUserId, provider: 'google', provider_subject: subject, email, metadata: profile }),
    });
  }

  const marketingUsers = await db<JsonRecord[]>(env, `/marketing_users?auth_user_id=eq.${encodeURIComponent(authUserId)}&select=id&limit=1`);
  if (!marketingUsers[0]) {
    const firstUsers = await db<JsonRecord[]>(env, '/marketing_users?select=id&limit=1');
    await db(env, '/marketing_users', {
      method: 'POST', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        auth_user_id: authUserId, name, full_name: name, email, avatar_url: avatar,
        role: firstUsers.length ? 'viewer' : 'administrator', status: 'active', provider: 'google', provider_metadata: profile, last_seen_at: new Date().toISOString(),
      }),
    });
  }
  return authUserId;
}

async function googleStart(request: Request, env: NativeAuthEnv): Promise<Response> {
  const clientId = text(env.GOOGLE_CLIENT_ID);
  if (!clientId || !text(env.GOOGLE_CLIENT_SECRET)) return json({ error: 'Google OAuth не настроен.' }, 503);
  const state = randomToken(32);
  const stateHash = await sha256Hex(state);
  const redirectUri = googleRedirectUri(request, env);
  await db(env, '/imds_auth_oauth_states', {
    method: 'POST', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ provider: 'google', state_hash: stateHash, redirect_uri: redirectUri, expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString() }),
  });
  const target = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  target.searchParams.set('client_id', clientId);
  target.searchParams.set('redirect_uri', redirectUri);
  target.searchParams.set('response_type', 'code');
  target.searchParams.set('scope', 'openid email profile');
  target.searchParams.set('state', state);
  target.searchParams.set('access_type', 'online');
  target.searchParams.set('prompt', 'select_account');
  return Response.redirect(target.toString(), 302);
}

async function googleCallback(request: Request, env: NativeAuthEnv, url: URL): Promise<Response> {
  try {
    const state = text(url.searchParams.get('state'));
    const code = text(url.searchParams.get('code'));
    const oauthError = text(url.searchParams.get('error'));
    if (oauthError) throw new Error(oauthError);
    if (!state || !code) throw new Error('Google OAuth callback неполный');
    const stateHash = await sha256Hex(state);
    const states = await db<JsonRecord[]>(env, `/imds_auth_oauth_states?provider=eq.google&state_hash=eq.${stateHash}&consumed_at=is.null&expires_at=gt.${encodeURIComponent(new Date().toISOString())}&select=id,redirect_uri&limit=1`);
    const saved = states[0];
    if (!saved?.id) throw new Error('Google OAuth state недействителен или истёк');
    const clientId = text(env.GOOGLE_CLIENT_ID);
    const clientSecret = text(env.GOOGLE_CLIENT_SECRET);
    if (!clientId || !clientSecret) throw new Error('Google OAuth не настроен');
    const redirectUri = text(saved.redirect_uri) || googleRedirectUri(request, env);
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: 'authorization_code' }),
    });
    const tokens = await tokenResponse.json().catch(() => ({})) as JsonRecord;
    if (!tokenResponse.ok || !text(tokens.access_token)) throw new Error(text(asObject(tokens.error)?.message) || text(tokens.error_description) || `Google token exchange ${tokenResponse.status}`);
    const profileResponse = await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { authorization: `Bearer ${text(tokens.access_token)}` } });
    const profile = await profileResponse.json().catch(() => ({})) as JsonRecord;
    if (!profileResponse.ok) throw new Error(`Google profile ${profileResponse.status}`);
    const authUserId = await ensureGoogleUser(env, profile);
    await db(env, `/imds_auth_oauth_states?id=eq.${encodeURIComponent(text(saved.id))}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ consumed_at: new Date().toISOString() }) });
    const session = await issueSession(env, authUserId, request, true);
    const fragment = new URLSearchParams({ access_token: session.access_token, token_type: session.token_type, expires_in: String(session.expires_in), provider: 'google' });
    return Response.redirect(`${appOrigin(request, env)}/#${fragment.toString()}`, 302);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Ошибка Google OAuth';
    return Response.redirect(`${appOrigin(request, env)}/?error_description=${encodeURIComponent(message)}`, 302);
  }
}

function asObject(value: unknown): JsonRecord | null { return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : null; }

export async function handleNativeAuthRequest(request: Request, env: NativeAuthEnv, url: URL): Promise<Response | null> {
  ensureOutboxRetry(env);
  if (url.pathname === '/api/auth/login' && request.method === 'POST') return login(request, env);
  if (url.pathname === '/api/auth/register' && request.method === 'POST') return register(request, env);
  if (url.pathname === '/api/auth/logout' && request.method === 'POST') return logout(request, env);
  if (url.pathname === '/api/auth/google/start' && request.method === 'GET') return googleStart(request, env);
  if (url.pathname === '/api/auth/google/callback' && request.method === 'GET') return googleCallback(request, env, url);
  return null;
}