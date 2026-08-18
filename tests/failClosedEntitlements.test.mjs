import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const stateDir = await mkdtemp(path.join(tmpdir(), 'imds-fail-closed-'));
process.env.IMDS_PLATFORM_STATE_DIR = stateDir;
const platform = await import(`../server/platformControl.ts?failClosed=${Date.now()}`);

const tenantId = '11111111-1111-4111-8111-111111111111';
const siblingTenantId = '55555555-5555-4555-8555-555555555555';
const localOrganizationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const organizationId = '22222222-2222-4222-8222-222222222222';
const unmanagedTenantId = '33333333-3333-4333-8333-333333333333';
const unknownTenantId = '44444444-4444-4444-8444-444444444444';
const companies = new Map([
  [tenantId, { id: tenantId, organization_id: localOrganizationId, platform_managed_at: null }],
  [siblingTenantId, { id: siblingTenantId, organization_id: localOrganizationId, platform_managed_at: null }],
  [unmanagedTenantId, { id: unmanagedTenantId, organization_id: unmanagedTenantId, platform_managed_at: null }],
  [unknownTenantId, { id: unknownTenantId, organization_id: unknownTenantId, platform_managed_at: null }],
]);
let databaseAvailable = true;
const originalFetch = globalThis.fetch;

function queryValue(url, key) {
  const match = url.match(new RegExp(`${key}=eq\\.([^&]+)`));
  return match ? decodeURIComponent(match[1]) : '';
}

globalThis.fetch = async (input, init = {}) => {
  const url = String(input);
  if (!databaseAvailable && url.includes('local.test')) throw new Error('db unavailable');
  if (url.includes('/rest/v1/crm_companies?')) {
    const method = (init.method || 'GET').toUpperCase();
    const tenant = queryValue(url, 'id');
    const organization = queryValue(url, 'organization_id');
    if (method === 'PATCH') {
      const payload = JSON.parse(String(init.body || '{}'));
      for (const company of companies.values()) {
        if ((tenant && company.id === tenant) || (organization && company.organization_id === organization)) {
          company.platform_managed_at = payload.platform_managed_at || company.platform_managed_at;
        }
      }
      return new Response(null, { status: 204 });
    }
    if (organization) {
      let rows = [...companies.values()].filter((company) => company.organization_id === organization);
      if (url.includes('platform_managed_at=not.is.null')) rows = rows.filter((company) => company.platform_managed_at);
      return new Response(JSON.stringify(rows.map((company) => ({
        id: company.id,
        organization_id: company.organization_id,
        platform_managed_at: company.platform_managed_at,
      }))), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    const company = companies.get(tenant);
    return new Response(JSON.stringify(company ? [{
      id: company.id,
      organization_id: company.organization_id,
      platform_managed_at: company.platform_managed_at,
    }] : []), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  if (url.includes('/rest/v1/rpc/imds_marketing_trial_state')) return new Response('null', { status: 200 });
  throw new Error(`unexpected fetch: ${url}`);
};

const env = {
  IMDS_PLATFORM_CONTROL_TOKEN: 'test-control-token',
  IMDS_LOCAL_DB_URL: 'http://local.test',
  IMDS_LOCAL_SERVICE_ROLE_KEY: 'test-service-key',
};

test.after(async () => {
  globalThis.fetch = originalFetch;
  await rm(stateDir, { recursive: true, force: true });
});

test('Control Center entitlement is inherited by every clinic in the same Marketing organization', async () => {
  const apply = new Request('http://localhost/internal/platform/entitlements/apply', {
    method: 'POST',
    headers: { authorization: 'Bearer test-control-token', 'content-type': 'application/json' },
    body: JSON.stringify({
      organizationId,
      tenantId,
      revision: 1,
      productEnabled: true,
      modules: { 'marketing.analytics': true },
      limits: { clinics: 5 },
      billing: { subscriptionStatus: 'active', currency: 'KZT', paymentMethods: [] },
    }),
  });
  const applied = await platform.handlePlatformInternalRequest(apply, env);
  assert.equal(applied.status, 200);
  const payload = await applied.json();
  assert.deepEqual(new Set(payload.tenantIds), new Set([tenantId, siblingTenantId]));
  assert.ok(companies.get(tenantId).platform_managed_at);
  assert.ok(companies.get(siblingTenantId).platform_managed_at);

  const siblingEntitlement = await platform.platformEntitlementForTenant(siblingTenantId, env);
  assert.equal(siblingEntitlement.organizationId, organizationId);
  assert.equal(siblingEntitlement.tenantId, siblingTenantId);
  assert.equal(siblingEntitlement.modules['marketing.analytics'], true);

  const siblingAnalytics = new Request('http://localhost/api/analytics', { headers: { 'x-imds-company-id': siblingTenantId } });
  assert.equal(await platform.enforcePlatformEntitlement(siblingAnalytics, env), null);
});

test('managed organization fails closed for sibling clinics when persisted entitlement disappears', async () => {
  await unlink(path.join(stateDir, 'entitlements.json'));
  const analytics = new Request('http://localhost/api/analytics', { headers: { 'x-imds-company-id': siblingTenantId } });
  const denied = await platform.enforcePlatformEntitlement(analytics, env);
  assert.equal(denied.status, 503);
  assert.deepEqual(await denied.json(), { error: 'PLATFORM_ENTITLEMENT_UNAVAILABLE', retryable: true });
});

test('unmanaged tenant retains local compatibility path', async () => {
  const request = new Request('http://localhost/api/analytics', { headers: { 'x-imds-company-id': unmanagedTenantId } });
  assert.equal(await platform.enforcePlatformEntitlement(request, env), null);
});

test('missing entitlement plus unreadable management state fails closed', async () => {
  databaseAvailable = false;
  try {
    const request = new Request('http://localhost/api/analytics', { headers: { 'x-imds-company-id': unknownTenantId } });
    const denied = await platform.enforcePlatformEntitlement(request, env);
    assert.equal(denied.status, 503);
    assert.deepEqual(await denied.json(), { error: 'PLATFORM_MANAGEMENT_STATE_UNAVAILABLE', retryable: true });
  } finally {
    databaseAvailable = true;
  }
});
