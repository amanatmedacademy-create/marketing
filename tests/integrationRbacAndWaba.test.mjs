import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('secured API normalizes platform super admin to administrator', () => {
  const source = read('worker/securedMain.ts');
  assert.match(source, /platformRole === 'super_admin' \? 'administrator' : user\.role/);
  assert.match(source, /authorizeApplicationRequest\(cleanRequest, env, \{ \.\.\.user, role \}\)/);
});

test('client exposes and normalizes platformRole', () => {
  const source = read('src/services/auth.ts');
  assert.match(source, /platformRole\?: 'user' \| 'super_admin'/);
  assert.match(source, /user\.platformRole === 'super_admin'/);
});

test('telephony accepts administrator and super admin', () => {
  const source = read('worker/telephonySettings.ts');
  assert.match(source, /\['administrator', 'super_admin'\]\.includes\(role\(request\)\)/);
});

test('WABA credentials are stored per phone number instead of overwriting the newest provider row', () => {
  const source = read('worker/wabaEmbeddedSignup.ts');
  assert.match(source, /rowPhoneNumberId/);
  assert.match(source, /find\(\(item\) => rowPhoneNumberId\(item as JsonRecord\) === phoneNumberId\)/);
  assert.match(source, /connections: connections\.map/);
  assert.doesNotMatch(source, /provider=eq\.waba&select=id&order=updated_at\.desc&limit=1/);
});

test('WABA migration keeps singleton providers but keys WABA by phoneNumberId', () => {
  const migration = read('supabase/migrations/20260818030500_waba_multichannel_credentials.sql');
  assert.match(migration, /provider <> 'waba'/);
  assert.match(migration, /phoneNumberId/);
  assert.match(migration, /provider = 'waba'/);
});

test('operational cards no longer mount through a DOM querySelector portal', () => {
  const source = read('src/components/OperationalIntegrationCards.tsx');
  assert.doesNotMatch(source, /createPortal/);
  assert.doesNotMatch(source, /querySelector/);
  assert.match(source, /iv2-grid/);
});

test('platform OAuth credentials deploy as one protected environment bundle', () => {
  const workflow = read('.github/workflows/deploy-vps.yml');
  const runtime = read('deploy/vps/imds-marketing.service');
  const scheduler = read('deploy/vps/imds-marketing-scheduler.service');
  assert.match(workflow, /IMDS_OAUTH_ENV: \$\{\{ secrets\.IMDS_OAUTH_ENV \}\}/);
  assert.match(workflow, /Configure unified OAuth secrets/);
  assert.match(workflow, /\/etc\/imds-oauth\.env/);
  assert.match(workflow, /META_APP_ID\|META_APP_SECRET\|META_WABA_CONFIG_ID/);
  assert.match(workflow, /GOOGLE_CLIENT_ID\|GOOGLE_CLIENT_SECRET/);
  assert.match(runtime, /EnvironmentFile=-\/etc\/imds-oauth\.env/);
  assert.match(scheduler, /EnvironmentFile=-\/etc\/imds-oauth\.env/);
});

test('tenant OAuth tokens remain outside the platform OAuth secret bundle', () => {
  const docs = read('docs/OAUTH_PLATFORM_SECRETS.md');
  assert.match(docs, /Meta access token/);
  assert.match(docs, /Google refresh token/);
  assert.match(docs, /Tenant credentials сохраняются зашифрованно/);
});
