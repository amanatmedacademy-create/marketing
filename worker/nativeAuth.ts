type JsonRecord = Record<string, unknown>;

export type NativeAuthEnv = {
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  IMDS_LOCAL_DB_URL?: string;
  IMDS_LOCAL_SERVICE_ROLE_KEY?: string;
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
  const headers = new Headers({ apikey: key, authorization: `Bearer ${key}`, accept: 'application/json', ...extra });
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

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlToBytes(value: string): Uint8Array {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function randomToken(size = 32): string {
  const bytes = new Uint8Array(size);
  crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

async function sha256Hex(value: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function timingSafeEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) diff |= left[index] ^ right[index];
  return diff === 0;
}

const PASSWORD_ITERATIONS = 600_000;

async function hashPassword(password: string): Promise<string> {
  if (password.length < 10 || password.length > 256) throw new Error('Пароль должен содержать минимум 10 символов');
  const salt = new Uint8Array(24);
  crypto.getRandomValues(salt);
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PASSWORD_ITERATIONS }, key, 256);
  return `pbkdf2_sha256$${PASSWORD_ITERATIONS}$${bytesToBase64Url(salt)}$${bytesToBase64Url(new Uint8Array(bits))}`;
}

async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const parts = encoded.split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2_sha256') return false;
  const iterations = Number(parts[1]);
  if (!Number.isInteger(iterations) || iterations < 100_000 || iterations > 2_000_000) return false;
  let salt: Uint8Array;
  let expected: Uint8Array;
  try { salt = base64UrlToBytes(parts[2]); expected = base64UrlToBytes(parts[3]); } catch { return false; }
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, expected.length * 8);
  return timingSafeEqual(new Uint8Array(bits), expected);
}

function normalizeEmail(value: unknown): string {
  return text(value).toLowerCase();
}

function validEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 254;
}

function slugify(value: string): string {
  const stem = value.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'organization';
  return `${stem}-${randomToken(5).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 7)}`;
}

function appOrigin(request: Request, env: NativeAuthEnv): string {
  const fallback = new URL(request.url).origin;
  try { return env.APP_ORIGIN ? new URL(env.APP_ORIGIN).origin : fallback; } catch { return fallback; }
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

async function marketingUserForAuthId(env: NativeAuthEnv, authUserId: string): Promise<NativeAuthenticatedUser | null> {
  const rows = await db<JsonRecord[]>(env, `/marketing_users?auth_user_id=eq.${encodeURIComponent(authUserId)}&select=id,email,name,full_name,avatar_url,role,status&limit=1`);
  const row = rows[0];
  if (!row) return null;
  return {
    id: text(row.id),
    email: normalizeEmail(row.email),
    name: text(row.full_name) || text(row.name) || normalizeEmail(row.email).split('@')[0] || 'Пользователь',
    avatarUrl: text(row.avatar_url) || null,
    role: text(row.role) || 'viewer',
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
  const users = await db<JsonRecord[]>(env, `/imds_auth_users?id=eq.${encodeURIComponent(authUserId)}&status=eq.active&select=id&limit=1`);
  if (!users[0]) return null;
  return marketingUserForAuthId(env, authUserId);
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
    email?: string; password?: string; displayName?: string; mode?: string; companyName?: string; companyCode?: string; remember?: boolean;
  } | null;
  const email = normalizeEmail(body?.email);
  const displayName = text(body?.displayName);
  const mode = text(body?.mode);
  if (!validEmail(email)) return json({ error: 'Введите корректный email.' }, 400);
  if (displayName.length < 2) return json({ error: 'Укажите имя пользователя.' }, 400);
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
      }),
    });
    const authUserId = text(result?.auth_user_id);
    if (!authUserId) throw new Error('Регистрация не вернула идентификатор пользователя');
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

  const marketing = await db<JsonRecord[]>(env, `/marketing_users?auth_user_id=eq.${encodeURIComponent(authUserId)}&select=id&limit=1`);
  if (!marketing[0]) {
    const byEmail = await db<JsonRecord[]>(env, `/marketing_users?email=eq.${encodeURIComponent(email)}&select=id,auth_user_id&limit=1`);
    if (byEmail[0]) {
      await db(env, `/marketing_users?id=eq.${encodeURIComponent(text(byEmail[0].id))}`, {
        method: 'PATCH', headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ auth_user_id: authUserId, name, full_name: name, avatar_url: avatar, provider: 'google', provider_metadata: profile, last_seen_at: new Date().toISOString(), updated_at: new Date().toISOString() }),
      });
    } else {
      await db(env, '/marketing_users', {
        method: 'POST', headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ auth_user_id: authUserId, name, full_name: name, email, avatar_url: avatar, provider: 'google', provider_metadata: profile, role: 'viewer', status: 'active', last_seen_at: new Date().toISOString() }),
      });
    }
  }
  return authUserId;
}

async function googleStart(request: Request, env: NativeAuthEnv): Promise<Response> {
  const clientId = text(env.GOOGLE_CLIENT_ID);
  if (!clientId) return Response.redirect(`${appOrigin(request, env)}/?error_description=${encodeURIComponent('Google OAuth ещё не настроен')}`, 302);
  const state = randomToken(36);
  const stateHash = await sha256Hex(state);
  const returnTo = appOrigin(request, env);
  await db(env, '/imds_auth_oauth_states', {
    method: 'POST', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ provider: 'google', state_hash: stateHash, return_to: returnTo, expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString() }),
  });
  const callback = `${appOrigin(request, env)}/api/auth/google/callback`;
  const authorize = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authorize.searchParams.set('client_id', clientId);
  authorize.searchParams.set('redirect_uri', callback);
  authorize.searchParams.set('response_type', 'code');
  authorize.searchParams.set('scope', 'openid email profile');
  authorize.searchParams.set('state', state);
  authorize.searchParams.set('prompt', 'select_account');
  return Response.redirect(authorize.toString(), 302);
}

async function googleCallback(request: Request, env: NativeAuthEnv, url: URL): Promise<Response> {
  const code = text(url.searchParams.get('code'));
  const state = text(url.searchParams.get('state'));
  const oauthError = text(url.searchParams.get('error'));
  const origin = appOrigin(request, env);
  if (oauthError) return Response.redirect(`${origin}/?error_description=${encodeURIComponent(oauthError)}`, 302);
  if (!code || !state) return Response.redirect(`${origin}/?error_description=${encodeURIComponent('Google OAuth callback неполный')}`, 302);
  const stateHash = await sha256Hex(state);
  const now = new Date().toISOString();
  const states = await db<JsonRecord[]>(env, `/imds_auth_oauth_states?provider=eq.google&state_hash=eq.${stateHash}&consumed_at=is.null&expires_at=gt.${encodeURIComponent(now)}&select=id,return_to&limit=1`);
  const saved = states[0];
  if (!saved) return Response.redirect(`${origin}/?error_description=${encodeURIComponent('OAuth state истёк или недействителен')}`, 302);
  await db(env, `/imds_auth_oauth_states?id=eq.${encodeURIComponent(text(saved.id))}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ consumed_at: now }) });

  const clientId = text(env.GOOGLE_CLIENT_ID);
  const clientSecret = text(env.GOOGLE_CLIENT_SECRET);
  if (!clientId || !clientSecret) return Response.redirect(`${origin}/?error_description=${encodeURIComponent('Google OAuth не настроен на сервере')}`, 302);
  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: `${origin}/api/auth/google/callback`, grant_type: 'authorization_code' }),
  });
  const tokenPayload = await tokenResponse.json().catch(() => ({})) as JsonRecord;
  const googleAccessToken = text(tokenPayload.access_token);
  if (!tokenResponse.ok || !googleAccessToken) return Response.redirect(`${origin}/?error_description=${encodeURIComponent('Google не выдал access token')}`, 302);
  const profileResponse = await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { authorization: `Bearer ${googleAccessToken}` } });
  const profile = await profileResponse.json().catch(() => ({})) as JsonRecord;
  if (!profileResponse.ok) return Response.redirect(`${origin}/?error_description=${encodeURIComponent('Не удалось получить профиль Google')}`, 302);
  try {
    const authUserId = await ensureGoogleUser(env, profile);
    const session = await issueSession(env, authUserId, request, true);
    return Response.redirect(`${origin}/#access_token=${encodeURIComponent(session.access_token)}&expires_in=${session.expires_in}&token_type=bearer`, 302);
  } catch (error) {
    return Response.redirect(`${origin}/?error_description=${encodeURIComponent(error instanceof Error ? error.message : 'Ошибка входа через Google')}`, 302);
  }
}

export function nativeGoogleConfigured(env: NativeAuthEnv): boolean {
  return Boolean(text(env.GOOGLE_CLIENT_ID) && text(env.GOOGLE_CLIENT_SECRET));
}

export async function handleNativeAuthRequest(request: Request, env: NativeAuthEnv, url: URL): Promise<Response | null> {
  if (url.pathname === '/api/auth/login' && request.method === 'POST') return login(request, env);
  if (url.pathname === '/api/auth/register' && request.method === 'POST') return register(request, env);
  if (url.pathname === '/api/auth/logout' && request.method === 'POST') return logout(request, env);
  if (url.pathname === '/api/auth/google/start' && request.method === 'GET' && text(env.IMDS_LOCAL_DB_URL)) return googleStart(request, env);
  if (url.pathname === '/api/auth/google/callback' && request.method === 'GET' && text(env.IMDS_LOCAL_DB_URL)) return googleCallback(request, env, url);
  return null;
}
