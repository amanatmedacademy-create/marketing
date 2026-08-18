import { authenticateRequest } from '../worker/auth';
import {
  completeMfaChallenge,
  createMfaChallenge,
  handleAccountSecurityRequest,
  randomSecurityToken,
  recordSecurityEvent,
  securityDb,
  securitySha256,
  verifyEmailToken,
  type AccountSecurityEnv,
} from '../worker/accountSecurity';

type Row = Record<string, unknown>;
const encoder = new TextEncoder();
const text = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });

function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4);
  const binary = atob(padded); const result = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i += 1) result[i] = binary.charCodeAt(i);
  return result;
}
async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const [scheme, iterationText, saltText, digestText] = encoded.split('$');
  if (scheme !== 'pbkdf2_sha256' || !iterationText || !saltText || !digestText) return false;
  const iterations = Number(iterationText); if (!Number.isFinite(iterations) || iterations < 100_000 || iterations > 1_500_000) return false;
  const salt = base64UrlToBytes(saltText); const expected = base64UrlToBytes(digestText);
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const actual = new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, expected.length * 8));
  if (actual.length !== expected.length) return false; let difference = 0;
  for (let i = 0; i < actual.length; i += 1) difference |= actual[i] ^ expected[i];
  return difference === 0;
}
async function issueSession(env: AccountSecurityEnv, authUserId: string, request: Request, remember: boolean) {
  const token = randomSecurityToken(48); const tokenHash = await securitySha256(token); const expiresIn = remember ? 30 * 24 * 60 * 60 : 12 * 60 * 60;
  const ip = text(request.headers.get('cf-connecting-ip')) || text(request.headers.get('x-forwarded-for')).split(',')[0]?.trim() || '';
  await securityDb(env, '/imds_auth_sessions', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ user_id: authUserId, token_hash: tokenHash, remember_me: remember, user_agent: text(request.headers.get('user-agent')).slice(0, 500) || null, ip_hash: ip ? await securitySha256(ip) : null, expires_at: new Date(Date.now() + expiresIn * 1000).toISOString() }) });
  return { access_token: token, expires_in: expiresIn, token_type: 'bearer' };
}

async function passwordLogin(request: Request, env: AccountSecurityEnv): Promise<Response> {
  const body = await request.json().catch(() => null) as { email?: string; password?: string; remember?: boolean } | null;
  const email = text(body?.email).toLowerCase(); const password = typeof body?.password === 'string' ? body.password : '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !password) return json({ error: 'Неверный email или пароль.' }, 400);
  const users = await securityDb<Row[]>(env, `/imds_auth_users?email=eq.${encodeURIComponent(email)}&select=id,status&limit=1`); const user = users[0]; const authUserId = text(user?.id);
  if (!authUserId || text(user.status) !== 'active') return json({ error: 'Неверный email или пароль.' }, 401);
  const credentials = await securityDb<Row[]>(env, `/imds_auth_passwords?user_id=eq.${encodeURIComponent(authUserId)}&select=password_hash&limit=1`); const passwordHash = text(credentials[0]?.password_hash);
  if (!passwordHash || !(await verifyPassword(password, passwordHash))) { await recordSecurityEvent(env, authUserId, 'auth.password_failed', request, 'failed'); return json({ error: 'Неверный email или пароль.' }, 401); }
  const remember = body?.remember !== false; const challenge = await createMfaChallenge(env, authUserId, 'password', remember, request);
  await securityDb(env, `/imds_auth_users?id=eq.${encodeURIComponent(authUserId)}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ last_login_at: new Date().toISOString(), updated_at: new Date().toISOString() }) });
  if (challenge) return json(challenge);
  await recordSecurityEvent(env, authUserId, 'auth.login', request); return json(await issueSession(env, authUserId, request, remember));
}

async function mfaVerify(request: Request, env: AccountSecurityEnv): Promise<Response> {
  const body = await request.json().catch(() => null) as { mfa_token?: string; code?: string } | null; const token = text(body?.mfa_token); const code = text(body?.code).toUpperCase();
  if (!token || !code) return json({ error: 'Введите код MFA' }, 400);
  try { const result = await completeMfaChallenge(env, token, code, request); return json(await issueSession(env, result.authUserId, request, result.remember)); }
  catch (error) { return json({ error: error instanceof Error ? error.message : 'MFA verification failed' }, 401); }
}

export async function handleAccountSecurityGatewayRequest(request: Request, env: AccountSecurityEnv): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname === '/api/auth/login' && request.method === 'POST') return passwordLogin(request, env);
  if (url.pathname === '/api/auth/mfa/verify' && request.method === 'POST') return mfaVerify(request, env);
  if (url.pathname === '/api/auth/verify-email' && request.method === 'GET') return verifyEmailToken(env, text(url.searchParams.get('token')), request);
  if (url.pathname.startsWith('/api/account/security')) {
    const user = await authenticateRequest(request, env as never); if (!user) return json({ error: 'Необходим вход в систему' }, 401); if (user.status !== 'active') return json({ error: 'Пользователь не активен' }, 403);
    return handleAccountSecurityRequest(request, env, url, user.id);
  }
  return null;
}

export async function enforceGoogleMfaRedirect(request: Request, response: Response, env: AccountSecurityEnv): Promise<Response> {
  const url = new URL(request.url); if (url.pathname !== '/api/auth/google/callback' || response.status < 300 || response.status >= 400) return response;
  const location = response.headers.get('location'); if (!location) return response;
  let target: URL; try { target = new URL(location); } catch { return response; }
  const fragment = new URLSearchParams(target.hash.replace(/^#/, '')); const token = text(fragment.get('access_token')); if (!token) return response;
  const tokenHash = await securitySha256(token); const sessions = await securityDb<Row[]>(env, `/imds_auth_sessions?token_hash=eq.${tokenHash}&revoked_at=is.null&select=id,user_id,remember_me&limit=1`); const session = sessions[0]; const authUserId = text(session?.user_id); if (!authUserId) return response;
  const challenge = await createMfaChallenge(env, authUserId, 'google', session.remember_me !== false, request); if (!challenge) return response;
  await securityDb(env, `/imds_auth_sessions?id=eq.${encodeURIComponent(text(session.id))}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ revoked_at: new Date().toISOString() }) });
  target.hash = ''; target.searchParams.set('mfa_token', challenge.mfa_token); target.searchParams.set('mfa_provider', 'google'); return Response.redirect(target.toString(), 302);
}
