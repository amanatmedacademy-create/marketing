import type { NativeAuthEnv } from './nativeAuth';

type JsonRecord = Record<string, unknown>;
type AccountUser = { id: string; platformRole?: string };

const encoder = new TextEncoder();
const text = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });

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
  const headers = dbHeaders(env, init.headers);
  if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
  const response = await fetch(`${dbUrl(env)}/rest/v1${path.startsWith('/') ? path : `/${path}`}`, { ...init, headers });
  const raw = await response.text();
  if (!response.ok) {
    let message = raw;
    try { const parsed = JSON.parse(raw) as { message?: string; details?: string }; message = parsed.message || parsed.details || raw; } catch {}
    throw new Error(message || `Database HTTP ${response.status}`);
  }
  return raw ? JSON.parse(raw) as T : undefined as T;
}
function bearer(request: Request): string {
  const value = request.headers.get('authorization') || '';
  return value.toLowerCase().startsWith('bearer ') ? value.slice(7).trim() : '';
}
function normalizePhone(value: unknown): string {
  const digits = text(value).replace(/\D/g, '');
  return digits.length >= 10 && digits.length <= 15 ? `+${digits}` : '';
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
  for (let index = 0; index < binary.length; index += 1) result[index] = binary.charCodeAt(index);
  return result;
}
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
  for (let index = 0; index < actual.length; index += 1) difference |= actual[index] ^ expected[index];
  return difference === 0;
}

async function authUserId(env: NativeAuthEnv, marketingUserId: string): Promise<string> {
  const rows = await db<JsonRecord[]>(env, `/marketing_users?id=eq.${encodeURIComponent(marketingUserId)}&select=auth_user_id&limit=1`);
  const id = text(rows[0]?.auth_user_id);
  if (!id) throw new Error('Профиль пользователя не связан с IMDS Account');
  return id;
}

async function profile(env: NativeAuthEnv, user: AccountUser): Promise<Response> {
  const authId = await authUserId(env, user.id);
  const [authRows, marketingRows, identities] = await Promise.all([
    db<JsonRecord[]>(env, `/imds_auth_users?id=eq.${encodeURIComponent(authId)}&select=id,email,display_name,phone,email_verified,locale,timezone,default_company_id,platform_role&limit=1`),
    db<JsonRecord[]>(env, `/marketing_users?id=eq.${encodeURIComponent(user.id)}&select=id,name,full_name,email,avatar_url,role,status&limit=1`),
    db<JsonRecord[]>(env, `/imds_auth_identities?user_id=eq.${encodeURIComponent(authId)}&select=provider&order=provider.asc`),
  ]);
  const auth = authRows[0] || {};
  const marketing = marketingRows[0] || {};
  return json({
    profile: {
      id: user.id,
      name: text(marketing.full_name) || text(marketing.name) || text(auth.display_name),
      email: text(auth.email) || text(marketing.email),
      phone: text(auth.phone) || null,
      emailVerified: auth.email_verified === true,
      avatarUrl: text(marketing.avatar_url) || null,
      role: text(marketing.role),
      platformRole: text(auth.platform_role) || user.platformRole || 'user',
      locale: text(auth.locale) || 'ru',
      timezone: text(auth.timezone) || 'Asia/Almaty',
      defaultCompanyId: text(auth.default_company_id) || null,
      providers: [...new Set(identities.map((row) => text(row.provider)).filter(Boolean))],
    },
  });
}

async function updateProfile(request: Request, env: NativeAuthEnv, user: AccountUser): Promise<Response> {
  const body = await request.json().catch(() => null) as { name?: string; phone?: string; locale?: string; timezone?: string } | null;
  const name = text(body?.name);
  if (name.length < 2 || name.length > 160) return json({ error: 'Укажите корректное имя' }, 400);
  const phone = body?.phone === undefined ? undefined : normalizePhone(body.phone);
  if (body?.phone !== undefined && !phone) return json({ error: 'Введите корректный номер телефона' }, 400);
  const locale = text(body?.locale) || 'ru';
  if (!['ru', 'kk', 'en'].includes(locale)) return json({ error: 'Неподдерживаемый язык' }, 400);
  const timezone = text(body?.timezone) || 'Asia/Almaty';
  if (timezone.length > 80) return json({ error: 'Некорректный часовой пояс' }, 400);
  const authId = await authUserId(env, user.id);
  const now = new Date().toISOString();
  await Promise.all([
    db(env, `/imds_auth_users?id=eq.${encodeURIComponent(authId)}`, {
      method: 'PATCH', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ display_name: name, ...(phone !== undefined ? { phone } : {}), locale, timezone, updated_at: now }),
    }),
    db(env, `/marketing_users?id=eq.${encodeURIComponent(user.id)}`, {
      method: 'PATCH', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ name, full_name: name, updated_at: now }),
    }),
  ]);
  return profile(env, user);
}

async function listSessions(request: Request, env: NativeAuthEnv, user: AccountUser): Promise<Response> {
  const authId = await authUserId(env, user.id);
  const currentHash = bearer(request) ? await sha256Hex(bearer(request)) : '';
  const rows = await db<JsonRecord[]>(env, `/imds_auth_sessions?user_id=eq.${encodeURIComponent(authId)}&revoked_at=is.null&expires_at=gt.${encodeURIComponent(new Date().toISOString())}&select=id,token_hash,remember_me,user_agent,created_at,last_seen_at,expires_at&order=last_seen_at.desc&limit=50`);
  return json({ sessions: rows.map((row) => ({
    id: text(row.id),
    current: currentHash !== '' && text(row.token_hash) === currentHash,
    rememberMe: row.remember_me === true,
    userAgent: text(row.user_agent) || 'Неизвестное устройство',
    createdAt: text(row.created_at),
    lastSeenAt: text(row.last_seen_at),
    expiresAt: text(row.expires_at),
  })) });
}

async function revokeSession(request: Request, env: NativeAuthEnv, user: AccountUser, sessionId: string): Promise<Response> {
  const authId = await authUserId(env, user.id);
  const currentHash = bearer(request) ? await sha256Hex(bearer(request)) : '';
  const rows = await db<JsonRecord[]>(env, `/imds_auth_sessions?id=eq.${encodeURIComponent(sessionId)}&user_id=eq.${encodeURIComponent(authId)}&revoked_at=is.null&select=id,token_hash&limit=1`);
  const row = rows[0];
  if (!row) return json({ error: 'Сессия не найдена' }, 404);
  if (currentHash && text(row.token_hash) === currentHash) return json({ error: 'Текущую сессию завершайте через «Выйти»' }, 400);
  await db(env, `/imds_auth_sessions?id=eq.${encodeURIComponent(sessionId)}&user_id=eq.${encodeURIComponent(authId)}`, {
    method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ revoked_at: new Date().toISOString() }),
  });
  return json({ ok: true });
}

async function revokeOtherSessions(request: Request, env: NativeAuthEnv, user: AccountUser): Promise<Response> {
  const authId = await authUserId(env, user.id);
  const currentHash = bearer(request) ? await sha256Hex(bearer(request)) : '';
  const rows = await db<JsonRecord[]>(env, `/imds_auth_sessions?user_id=eq.${encodeURIComponent(authId)}&revoked_at=is.null&select=id,token_hash`);
  const ids = rows.filter((row) => !currentHash || text(row.token_hash) !== currentHash).map((row) => text(row.id)).filter(Boolean);
  if (ids.length) {
    await db(env, `/imds_auth_sessions?id=in.(${ids.map(encodeURIComponent).join(',')})&user_id=eq.${encodeURIComponent(authId)}`, {
      method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ revoked_at: new Date().toISOString() }),
    });
  }
  return json({ ok: true, revoked: ids.length });
}

async function changePassword(request: Request, env: NativeAuthEnv, user: AccountUser): Promise<Response> {
  const body = await request.json().catch(() => null) as { currentPassword?: string; newPassword?: string; revokeOtherSessions?: boolean } | null;
  const currentPassword = typeof body?.currentPassword === 'string' ? body.currentPassword : '';
  const newPassword = typeof body?.newPassword === 'string' ? body.newPassword : '';
  if (!currentPassword || !newPassword) return json({ error: 'Введите текущий и новый пароль' }, 400);
  const authId = await authUserId(env, user.id);
  const rows = await db<JsonRecord[]>(env, `/imds_auth_passwords?user_id=eq.${encodeURIComponent(authId)}&select=password_hash&limit=1`);
  const currentHash = text(rows[0]?.password_hash);
  if (!currentHash) return json({ error: 'Для аккаунта не настроен вход по паролю' }, 400);
  if (!(await verifyPassword(currentPassword, currentHash))) return json({ error: 'Текущий пароль указан неверно' }, 403);
  const passwordHash = await hashPassword(newPassword);
  await db(env, `/imds_auth_passwords?user_id=eq.${encodeURIComponent(authId)}`, {
    method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ password_hash: passwordHash, updated_at: new Date().toISOString() }),
  });
  if (body?.revokeOtherSessions !== false) await revokeOtherSessions(request, env, user);
  return json({ ok: true });
}

export async function handleAccountSelfServiceRequest(
  request: Request,
  env: NativeAuthEnv,
  url: URL,
  user: AccountUser,
): Promise<Response | null> {
  if (!url.pathname.startsWith('/api/account/')) return null;
  try {
    if (url.pathname === '/api/account/profile' && request.method === 'GET') return profile(env, user);
    if (url.pathname === '/api/account/profile' && request.method === 'PATCH') return updateProfile(request, env, user);
    if (url.pathname === '/api/account/sessions' && request.method === 'GET') return listSessions(request, env, user);
    if (url.pathname === '/api/account/sessions/revoke-others' && request.method === 'POST') return revokeOtherSessions(request, env, user);
    if (url.pathname.startsWith('/api/account/sessions/') && request.method === 'DELETE') {
      const id = decodeURIComponent(url.pathname.slice('/api/account/sessions/'.length));
      return id ? revokeSession(request, env, user, id) : json({ error: 'Сессия не указана' }, 400);
    }
    if (url.pathname === '/api/account/password' && request.method === 'POST') return changePassword(request, env, user);
    return json({ error: 'Not found' }, 404);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 400);
  }
}
