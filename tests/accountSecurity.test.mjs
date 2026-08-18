import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const security = await readFile(new URL('../worker/accountSecurity.ts', import.meta.url), 'utf8');
const gateway = await readFile(new URL('../server/accountSecurityGateway.ts', import.meta.url), 'utf8');
const runtime = await readFile(new URL('../server/vpsRuntime.ts', import.meta.url), 'utf8');
const auth = await readFile(new URL('../src/services/auth.ts', import.meta.url), 'utf8');
const panel = await readFile(new URL('../src/components/AccountSecurityPanel.tsx', import.meta.url), 'utf8');
const migration = await readFile(new URL('../supabase/migrations/20260818101500_account_security_mfa_email.sql', import.meta.url), 'utf8');

test('MFA secrets are encrypted and recovery codes are hash-only', () => {
  assert.match(security, /AES-GCM/);
  assert.match(security, /INTEGRATION_ENCRYPTION_KEY/);
  assert.match(migration, /code_hash text not null/);
  assert.doesNotMatch(migration, /recovery_code text/);
  assert.match(migration, /secret_ciphertext text not null/);
});

test('TOTP challenge is enforced before issuing password and Google sessions', () => {
  assert.match(gateway, /createMfaChallenge\(env, authUserId, 'password'/);
  assert.match(gateway, /enforceGoogleMfaRedirect/);
  assert.match(gateway, /revoked_at/);
  assert.match(runtime, /handleAccountSecurityGatewayRequest/);
  assert.match(runtime, /enforceGoogleMfaRedirect/);
});

test('MFA uses anti-replay and bounded challenge attempts', () => {
  assert.match(security, /last_used_step/);
  assert.match(security, /step <= lastUsedStep/);
  assert.match(security, /Number\(challenge\.attempts \|\| 0\) >= 6/);
  assert.match(migration, /attempts integer not null default 0/);
});

test('email verification tokens are hashed and delivery is server-side only', () => {
  assert.match(migration, /imds_auth_email_verifications/);
  assert.match(migration, /token_hash text not null unique/);
  assert.match(security, /RESEND_API_KEY/);
  assert.match(security, /https:\/\/api\.resend\.com\/emails/);
  assert.doesNotMatch(panel, /RESEND_API_KEY/);
});

test('frontend supports MFA challenge, setup, recovery codes and email verification', () => {
  assert.match(auth, /verifyMfaChallenge/);
  assert.match(auth, /mfaRequired/);
  assert.match(panel, /recoveryCodes/);
  assert.match(panel, /Подтвердить email/);
  assert.match(panel, /Двухфакторная аутентификация/);
});
