import type { NativeAuthEnv } from './nativeAuth';

type Row = Record<string, unknown>;
export type AccountSecurityEnv = NativeAuthEnv & {
  INTEGRATION_ENCRYPTION_KEY?: string;
  RESEND_API_KEY?: string;
  RESEND_FROM_EMAIL?: string;
};
const encoder = new TextEncoder();
const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });

function dbBase(env: AccountSecurityEnv) {
  const value = text(env.IMDS_LOCAL_DB_URL) || text(env.SUPABASE_URL);
  if (!value) throw new Error('IMDS database URL is missing');
  return value.replace(/\/$/, '').replace(/\/rest\/v1$/, '');
}
function dbKey(env: AccountSecurityEnv) {
  const value = text(env.IMDS_LOCAL_SERVICE_ROLE_KEY) || text(env.SUPABASE_SERVICE_ROLE_KEY);
  if (!value) throw new Error('IMDS database service key is missing');
  return value;
}
export async function securityDb<T>(env: AccountSecurityEnv, path: string, init: RequestInit = {}): Promise<T> {
  const key = dbKey(env);
  const headers = new Headers({ apikey: key, authorization: `Bearer ${key}`, accept: 'application/json' });
  new Headers(init.headers).forEach((v, k) => headers.set(k, v));
  if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
  const response = await fetch(`${dbBase(env)}/rest/v1${path.startsWith('/') ? path : `/${path}`}`, { ...init, headers });
  const raw = await response.text();
  if (!response.ok) throw new Error(raw || `Database HTTP ${response.status}`);
  return (raw ? JSON.parse(raw) : undefined) as T;
}

function bytesToBase64(bytes: Uint8Array): string { let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte); return btoa(binary); }
function base64ToBytes(value: string): Uint8Array<ArrayBuffer> { const raw = atob(value); const bytes = new Uint8Array(new ArrayBuffer(raw.length)); for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i); return bytes; }
function bytesToBase32(bytes: Uint8Array): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; let bits = 0; let value = 0; let output = '';
  for (const byte of bytes) { value = (value << 8) | byte; bits += 8; while (bits >= 5) { output += alphabet[(value >>> (bits - 5)) & 31]; bits -= 5; } }
  if (bits > 0) output += alphabet[(value << (5 - bits)) & 31]; return output;
}
function base32ToBytes(input: string): Uint8Array<ArrayBuffer> {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; const clean = input.toUpperCase().replace(/[^A-Z2-7]/g, ''); let bits = 0; let value = 0; const out: number[] = [];
  for (const char of clean) { const index = alphabet.indexOf(char); if (index < 0) continue; value = (value << 5) | index; bits += 5; if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; } }
  return new Uint8Array(out);
}
export function randomSecurityToken(bytes = 32): string { return bytesToBase64(crypto.getRandomValues(new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, ''); }
export async function securitySha256(value: string): Promise<string> { const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value))); return [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join(''); }
async function encryptionKey(env: AccountSecurityEnv): Promise<CryptoKey> {
  const secret = text(env.INTEGRATION_ENCRYPTION_KEY); if (!secret) throw new Error('INTEGRATION_ENCRYPTION_KEY is required for MFA');
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(secret)); return crypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}
async function encryptSecret(env: AccountSecurityEnv, secret: string) { const iv = crypto.getRandomValues(new Uint8Array(12)); const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await encryptionKey(env), encoder.encode(secret)); return { ciphertext: bytesToBase64(new Uint8Array(encrypted)), iv: bytesToBase64(iv) }; }
async function decryptSecret(env: AccountSecurityEnv, ciphertext: string, iv: string) { const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: base64ToBytes(iv) }, await encryptionKey(env), base64ToBytes(ciphertext)); return new TextDecoder().decode(decrypted); }
async function ipHash(request: Request) { const ip = text(request.headers.get('cf-connecting-ip')) || text(request.headers.get('x-forwarded-for')).split(',')[0]?.trim() || ''; return ip ? securitySha256(ip) : null; }
export async function recordSecurityEvent(env: AccountSecurityEnv, userId: string, type: string, request: Request, result = 'success', metadata: Row = {}) {
  await securityDb(env, '/imds_auth_security_events', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ user_id: userId, event_type: type, result, ip_hash: await ipHash(request), user_agent: text(request.headers.get('user-agent')).slice(0, 300) || null, metadata }) }).catch(() => undefined);
}

async function hotp(secret: string, counter: number): Promise<string> {
  const key = await crypto.subtle.importKey('raw', base32ToBytes(secret), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const buffer = new ArrayBuffer(8); const view = new DataView(buffer); view.setUint32(0, Math.floor(counter / 0x100000000)); view.setUint32(4, counter >>> 0);
  const signed = new Uint8Array(await crypto.subtle.sign('HMAC', key, buffer)); const offset = signed[signed.length - 1] & 0x0f;
  const binary = ((signed[offset] & 0x7f) << 24) | ((signed[offset + 1] & 0xff) << 16) | ((signed[offset + 2] & 0xff) << 8) | (signed[offset + 3] & 0xff);
  return String(binary % 1_000_000).padStart(6, '0');
}
async function verifyTotp(secret: string, code: string, lastUsedStep?: number | null): Promise<number | null> {
  if (!/^\d{6}$/.test(code)) return null; const current = Math.floor(Date.now() / 30_000);
  for (const delta of [-1, 0, 1]) { const step = current + delta; if (lastUsedStep != null && step <= lastUsedStep) continue; if (await hotp(secret, step) === code) return step; }
  return null;
}
async function authUserIdForMarketingUser(env: AccountSecurityEnv, marketingUserId: string) { const rows = await securityDb<Row[]>(env, `/marketing_users?id=eq.${encodeURIComponent(marketingUserId)}&select=auth_user_id&limit=1`); const id = text(rows[0]?.auth_user_id); if (!id) throw new Error('IMDS Account link missing'); return id; }

export async function createMfaChallenge(env: AccountSecurityEnv, authUserId: string, provider: 'password' | 'google', remember: boolean, request: Request): Promise<{ mfa_required: true; mfa_token: string; expires_in: number } | null> {
  const users = await securityDb<Row[]>(env, `/imds_auth_users?id=eq.${encodeURIComponent(authUserId)}&select=mfa_enabled&limit=1`); if (users[0]?.mfa_enabled !== true) return null;
  const token = randomSecurityToken(40); const expiresIn = 10 * 60;
  await securityDb(env, '/imds_auth_mfa_challenges', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ user_id: authUserId, token_hash: await securitySha256(token), provider, remember_me: remember, expires_at: new Date(Date.now() + expiresIn * 1000).toISOString(), user_agent: text(request.headers.get('user-agent')).slice(0, 300) || null, ip_hash: await ipHash(request) }) });
  await recordSecurityEvent(env, authUserId, 'mfa.challenge_created', request, 'info', { provider }); return { mfa_required: true, mfa_token: token, expires_in: expiresIn };
}

export async function completeMfaChallenge(env: AccountSecurityEnv, token: string, code: string, request: Request): Promise<{ authUserId: string; remember: boolean }> {
  const tokenHash = await securitySha256(token); const rows = await securityDb<Row[]>(env, `/imds_auth_mfa_challenges?token_hash=eq.${tokenHash}&consumed_at=is.null&expires_at=gt.${encodeURIComponent(new Date().toISOString())}&select=*&limit=1`);
  const challenge = rows[0]; const authUserId = text(challenge?.user_id); if (!authUserId) throw new Error('MFA challenge expired'); if (Number(challenge.attempts || 0) >= 6) throw new Error('MFA challenge blocked');
  const factors = await securityDb<Row[]>(env, `/imds_auth_mfa_factors?user_id=eq.${encodeURIComponent(authUserId)}&status=eq.verified&select=*&limit=1`); const factor = factors[0]; let valid = false; let usedStep: number | null = null;
  if (factor) { const secret = await decryptSecret(env, text(factor.secret_ciphertext), text(factor.iv)); usedStep = await verifyTotp(secret, code, factor.last_used_step == null ? null : Number(factor.last_used_step)); valid = usedStep != null; }
  if (!valid) { const hash = await securitySha256(code.trim().toUpperCase()); const recovery = await securityDb<Row[]>(env, `/imds_auth_mfa_recovery_codes?user_id=eq.${encodeURIComponent(authUserId)}&code_hash=eq.${hash}&used_at=is.null&select=id&limit=1`); if (recovery[0]) { valid = true; await securityDb(env, `/imds_auth_mfa_recovery_codes?id=eq.${encodeURIComponent(text(recovery[0].id))}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ used_at: new Date().toISOString() }) }); } }
  if (!valid) { await securityDb(env, `/imds_auth_mfa_challenges?id=eq.${encodeURIComponent(text(challenge.id))}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ attempts: Number(challenge.attempts || 0) + 1 }) }); await recordSecurityEvent(env, authUserId, 'mfa.challenge_failed', request, 'failed'); throw new Error('Неверный код MFA'); }
  if (factor && usedStep != null) await securityDb(env, `/imds_auth_mfa_factors?id=eq.${encodeURIComponent(text(factor.id))}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ last_used_step: usedStep, updated_at: new Date().toISOString() }) });
  await securityDb(env, `/imds_auth_mfa_challenges?id=eq.${encodeURIComponent(text(challenge.id))}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ consumed_at: new Date().toISOString() }) }); await recordSecurityEvent(env, authUserId, 'mfa.challenge_completed', request); return { authUserId, remember: challenge.remember_me !== false };
}

async function sendVerificationMail(env: AccountSecurityEnv, email: string, token: string): Promise<boolean> {
  const apiKey = text(env.RESEND_API_KEY); const from = text(env.RESEND_FROM_EMAIL); if (!apiKey || !from) return false;
  const origin = (text(env.APP_ORIGIN) || 'http://localhost').replace(/\/$/, ''); const link = `${origin}/api/auth/verify-email?token=${encodeURIComponent(token)}`;
  const response = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' }, body: JSON.stringify({ from, to: [email], subject: 'Подтверждение email BELES', html: `<p>Подтвердите email для IMDS Account:</p><p><a href="${link}">Подтвердить email</a></p><p>Ссылка действует 30 минут.</p>` }) });
  return response.ok;
}

export async function verifyEmailToken(env: AccountSecurityEnv, token: string, request: Request): Promise<Response> {
  const rows = await securityDb<Row[]>(env, `/imds_auth_email_verifications?token_hash=eq.${await securitySha256(token)}&consumed_at=is.null&expires_at=gt.${encodeURIComponent(new Date().toISOString())}&select=*&limit=1`); const row = rows[0]; const userId = text(row?.user_id);
  if (!userId) return json({ error: 'Ссылка подтверждения недействительна или истекла' }, 400);
  await securityDb(env, `/imds_auth_users?id=eq.${encodeURIComponent(userId)}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ email_verified: true, email_verified_at: new Date().toISOString(), updated_at: new Date().toISOString() }) });
  await securityDb(env, `/imds_auth_email_verifications?id=eq.${encodeURIComponent(text(row.id))}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ consumed_at: new Date().toISOString() }) }); await recordSecurityEvent(env, userId, 'email.verified', request);
  return Response.redirect(`${(text(env.APP_ORIGIN) || new URL(request.url).origin).replace(/\/$/, '')}/?email_verified=1`, 302);
}

export async function handleAccountSecurityRequest(request: Request, env: AccountSecurityEnv, url: URL, marketingUserId: string): Promise<Response | null> {
  if (!url.pathname.startsWith('/api/account/security')) return null;
  try {
    const authUserId = await authUserIdForMarketingUser(env, marketingUserId);
    if (url.pathname === '/api/account/security' && request.method === 'GET') {
      const [users, recovery, events] = await Promise.all([securityDb<Row[]>(env, `/imds_auth_users?id=eq.${encodeURIComponent(authUserId)}&select=email,email_verified,mfa_enabled&limit=1`), securityDb<Row[]>(env, `/imds_auth_mfa_recovery_codes?user_id=eq.${encodeURIComponent(authUserId)}&used_at=is.null&select=id`), securityDb<Row[]>(env, `/imds_auth_security_events?user_id=eq.${encodeURIComponent(authUserId)}&select=id,event_type,result,user_agent,metadata,created_at&order=created_at.desc&limit=20`)]);
      return json({ email: text(users[0]?.email), emailVerified: users[0]?.email_verified === true, mfaEnabled: users[0]?.mfa_enabled === true, recoveryCodesRemaining: recovery.length, emailDeliveryConfigured: Boolean(text(env.RESEND_API_KEY) && text(env.RESEND_FROM_EMAIL)), events: events.map((e) => ({ id: text(e.id), type: text(e.event_type), result: text(e.result), userAgent: text(e.user_agent) || null, metadata: e.metadata || {}, createdAt: text(e.created_at) })) });
    }
    if (url.pathname === '/api/account/security/email/send' && request.method === 'POST') {
      const users = await securityDb<Row[]>(env, `/imds_auth_users?id=eq.${encodeURIComponent(authUserId)}&select=email,email_verified&limit=1`); if (users[0]?.email_verified === true) return json({ ok: true, alreadyVerified: true }); const email = text(users[0]?.email); const token = randomSecurityToken(40);
      await securityDb(env, `/imds_auth_email_verifications?user_id=eq.${encodeURIComponent(authUserId)}&consumed_at=is.null`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } }).catch(() => undefined);
      await securityDb(env, '/imds_auth_email_verifications', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ user_id: authUserId, email, token_hash: await securitySha256(token), expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(), sent_at: new Date().toISOString() }) }); const delivered = await sendVerificationMail(env, email, token); await recordSecurityEvent(env, authUserId, 'email.verification_sent', request, delivered ? 'success' : 'blocked', { delivered }); return delivered ? json({ ok: true }) : json({ error: 'Email delivery is not configured' }, 503);
    }
    if (url.pathname === '/api/account/security/mfa/setup' && request.method === 'POST') {
      const secret = bytesToBase32(crypto.getRandomValues(new Uint8Array(20))); const encrypted = await encryptSecret(env, secret); await securityDb(env, `/imds_auth_mfa_factors?user_id=eq.${encodeURIComponent(authUserId)}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } }).catch(() => undefined);
      await securityDb(env, '/imds_auth_mfa_factors', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ user_id: authUserId, secret_ciphertext: encrypted.ciphertext, iv: encrypted.iv, status: 'pending' }) }); const users = await securityDb<Row[]>(env, `/imds_auth_users?id=eq.${encodeURIComponent(authUserId)}&select=email&limit=1`); const account = encodeURIComponent(text(users[0]?.email)); const issuer = encodeURIComponent('BELES by IMDS TECH'); await recordSecurityEvent(env, authUserId, 'mfa.setup_started', request, 'info'); return json({ secret, otpauthUri: `otpauth://totp/${issuer}:${account}?secret=${secret}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30` });
    }
    if (url.pathname === '/api/account/security/mfa/enable' && request.method === 'POST') {
      const body = await request.json().catch(() => ({})) as { code?: string }; const factors = await securityDb<Row[]>(env, `/imds_auth_mfa_factors?user_id=eq.${encodeURIComponent(authUserId)}&status=eq.pending&select=*&limit=1`); const factor = factors[0]; if (!factor) return json({ error: 'MFA setup not started' }, 400); const secret = await decryptSecret(env, text(factor.secret_ciphertext), text(factor.iv)); const step = await verifyTotp(secret, text(body.code)); if (step == null) return json({ error: 'Неверный код authenticator' }, 400);
      const codes = Array.from({ length: 10 }, () => `${randomSecurityToken(6).slice(0, 4).toUpperCase()}-${randomSecurityToken(6).slice(0, 4).toUpperCase()}`); await securityDb(env, `/imds_auth_mfa_recovery_codes?user_id=eq.${encodeURIComponent(authUserId)}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } }).catch(() => undefined); for (const code of codes) await securityDb(env, '/imds_auth_mfa_recovery_codes', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ user_id: authUserId, code_hash: await securitySha256(code) }) });
      await securityDb(env, `/imds_auth_mfa_factors?id=eq.${encodeURIComponent(text(factor.id))}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ status: 'verified', verified_at: new Date().toISOString(), last_used_step: step, updated_at: new Date().toISOString() }) }); await securityDb(env, `/imds_auth_users?id=eq.${encodeURIComponent(authUserId)}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ mfa_enabled: true, updated_at: new Date().toISOString() }) }); await recordSecurityEvent(env, authUserId, 'mfa.enabled', request); return json({ ok: true, recoveryCodes: codes });
    }
    if (url.pathname === '/api/account/security/mfa/disable' && request.method === 'POST') {
      const body = await request.json().catch(() => ({})) as { code?: string }; const code = text(body.code); const factors = await securityDb<Row[]>(env, `/imds_auth_mfa_factors?user_id=eq.${encodeURIComponent(authUserId)}&status=eq.verified&select=*&limit=1`); const factor = factors[0]; if (!factor) return json({ error: 'MFA is not enabled' }, 400); const secret = await decryptSecret(env, text(factor.secret_ciphertext), text(factor.iv)); const step = await verifyTotp(secret, code, factor.last_used_step == null ? null : Number(factor.last_used_step)); if (step == null) return json({ error: 'Неверный код authenticator' }, 400);
      await securityDb(env, `/imds_auth_users?id=eq.${encodeURIComponent(authUserId)}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ mfa_enabled: false, updated_at: new Date().toISOString() }) }); await securityDb(env, `/imds_auth_mfa_factors?id=eq.${encodeURIComponent(text(factor.id))}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ status: 'disabled', disabled_at: new Date().toISOString(), updated_at: new Date().toISOString() }) }); await securityDb(env, `/imds_auth_mfa_recovery_codes?user_id=eq.${encodeURIComponent(authUserId)}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } }); await recordSecurityEvent(env, authUserId, 'mfa.disabled', request); return json({ ok: true });
    }
    return json({ error: 'Not found' }, 404);
  } catch (error) { return json({ error: error instanceof Error ? error.message : String(error) }, 400); }
}
