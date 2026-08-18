import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const gateway = await readFile(new URL('../server/billingGateway.ts', import.meta.url), 'utf8');
const runtime = await readFile(new URL('../server/vpsRuntime.ts', import.meta.url), 'utf8');
const scheduler = await readFile(new URL('../server/vpsScheduler.ts', import.meta.url), 'utf8');
const service = await readFile(new URL('../deploy/vps/imds-marketing.service', import.meta.url), 'utf8');
const statusLayer = await readFile(new URL('../src/components/SubscriptionStatusLayer.tsx', import.meta.url), 'utf8');

test('billing gateway keeps card data out of Marketing and delegates to Control Center', () => {
  assert.match(gateway, /BILLING_CARD_DATA_NOT_ACCEPTED/);
  assert.match(gateway, /IMDS_BILLING_CONTROL_URL/);
  assert.match(gateway, /IMDS_BILLING_CONTROL_TOKEN/);
  assert.match(gateway, /\/v1\/billing\/checkout/);
  assert.match(gateway, /\/v1\/billing\/invoices/);
  assert.match(gateway, /billingPeriodMonths/);
});

test('billing mutations remain owner or platform super admin only', () => {
  assert.match(gateway, /context\.role === 'super_admin' \|\| context\.role === 'owner'/);
  assert.match(gateway, /BILLING_OWNER_REQUIRED/);
  assert.match(gateway, /BILLING_ADMIN_REQUIRED/);
});

test('Marketing VPS has no active local billing authority', () => {
  assert.match(runtime, /handleBillingGatewayRequest/);
  assert.doesNotMatch(runtime, /handleBillingControlPlaneRequest/);
  assert.doesNotMatch(runtime, /billingControlPlane/);
  assert.doesNotMatch(scheduler, /runBillingLifecycleTick/);
  assert.doesNotMatch(scheduler, /billingControlPlane/);
  assert.match(service, /IMDS_BILLING_CONTROL_URL=http:\/\/127\.0\.0\.1:8788/);
  assert.doesNotMatch(service, /imds-cloudpayments\.env/);
});

test('subscription UI accepts Control Center status vocabulary and old aliases', () => {
  for (const status of ['pending_payment', 'read_only', 'canceled', 'cancelled', 'grace_period', 'free', 'beta']) {
    assert.ok(statusLayer.includes(status), `missing subscription status: ${status}`);
  }
});
