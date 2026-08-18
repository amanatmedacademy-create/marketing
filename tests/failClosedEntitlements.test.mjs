import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const stateDir = await mkdtemp(path.join(tmpdir(), 'imds-fail-closed-'));
process.env.IMDS_PLATFORM_STATE_DIR = stateDir;
const platform = await import(`../server/platformControl.ts?failClosed=${Date.now()}`);

const managed = new Set();
let databaseAvailable = true;
const originalFetch = globalThis.fetch;

globalThis.fetch = async (input, init = {}) => {
  const url = String(input);
  if (!databaseAvailable && url.includes('local.test')) throw new Error('db unavailable');
  if (url.includes('/rest/v1/crm_companies?')) {
    const tenant = decodeURIComponent((url.match(/id=eq\.([^&]+)/) || [])[1] || '');
    if ((init.method || 'GET').toUpperCase() === 'PATCH') {
      managed.add(tenant);
      return new Response(null, { status: 204 });
    }
    return new Response(JSON.stringify([{ platform_managed_at: managed.has(tenant) ? '2026-08-18T00:00:00.000Z' : null }]), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }
  if (url.includes('/rest/v1/rpc/imds_marketing_trial_state')) return new Response('null', { status: 200 });
  throw new Error(`unexpected fetch: ${url}`);
};

const env = {
  IMDS_PLATFORM_CONTROL_TOKEN: 'test-control-token',
  IMDS_LOCAL_DB_URL: 'http://local.test',
  IMDS_LOCAL_SERVICE_ROLE_KEY: 'test-service-key',
};

const tenantId = '11111111-1111-4111-8111-111111111111';
const organizationId = '22222222-2222-4222-8222-222222222222';

test.after(async () => {
  globalThis.fetch = originalFetch;
  await rm(stateDir, { recursive: true, force: true });
});

test('managed tenant fails closed when its persisted entitlement disappears', async () => {
  const apply = new Request('http://localhost/internal/platform/entitlements/apply', {
    method: 'POST',
    headers: { authorization: 'Bearer test-control-token', 'content-type': 'application/json' },
    body: JSON.stringify({
      organizationId,
      tenantId,
      revision: 1,
      productEnabled: true,
      modules: { 'marketing.analytics': true },
    }),
  });
  const applied = await platform.handlePlatformInternalRequest(apply, env);
  assert.equal(applied.status, 200);
  assert.equal(managed.has(tenantId), true);

  const analytics = new Request('http://localhost/api/analytics', { headers: { 'x-imds-company-id': tenantId } });
  assert.equal(await platform.enforcePlatformEntitlement(analytics, env), null);

  await unlink(path.join(stateDir, 'entitlements.json'));
  const denied = await platform.enforcePlatformEntitlement(analytics, env);
  assert.equal(denied.status, 503);
  assert.deepEqual(await denied.json(), { error: 'PLATFORM_ENTITLEMENT_UNAVAILABLE', retryable: true });
});

test('unmanaged tenant retains local compatibility path', async () => {
  const tenant = '33333333-3333-4333-8333-333333333333';
  const request = new Request('http://localhost/api/analytics', { headers: { 'x-imds-company-id': tenant } });
  assert.equal(await platform.enforcePlatformEntitlement(request, env), null);
});

test('missing entitlement plus unreadable management state fails closed', async () => {
  databaseAvailable = false;
  try {
    const tenant = '44444444-4444-4444-8444-444444444444';
    const request = new Request('http://localhost/api/analytics', { headers: { 'x-imds-company-id': tenant } });
    const denied = await platform.enforcePlatformEntitlement(request, env);
    assert.equal(denied.status, 503);
    assert.deepEqual(await denied.json(), { error: 'PLATFORM_MANAGEMENT_STATE_UNAVAILABLE', retryable: true });
  } finally {
    databaseAvailable = true;
  }
});
