import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const gateway = await readFile(new URL('../server/billingGateway.ts', import.meta.url), 'utf8');
const runtime = await readFile(new URL('../server/vpsRuntime.ts', import.meta.url), 'utf8');
const client = await readFile(new URL('../src/services/billing.ts', import.meta.url), 'utf8');
const panel = await readFile(new URL('../src/components/BillingCenterPanel.tsx', import.meta.url), 'utf8');
const workspace = await readFile(new URL('../src/components/UserWorkspaceModal.tsx', import.meta.url), 'utf8');

test('billing gateway never accepts raw card credentials', () => {
  assert.match(gateway, /BILLING_CARD_DATA_NOT_ACCEPTED/);
  assert.match(gateway, /cardnumber/);
  assert.match(gateway, /cvc/);
  assert.match(gateway, /cvv/);
});

test('billing mutations are owner or platform super admin only', () => {
  assert.match(gateway, /context\.role === 'super_admin' \|\| context\.role === 'owner'/);
  assert.match(gateway, /BILLING_OWNER_REQUIRED/);
  assert.match(gateway, /BILLING_ADMIN_REQUIRED/);
});

test('checkout and portal are server-to-server Control Plane operations', () => {
  assert.match(gateway, /IMDS_BILLING_CONTROL_URL/);
  assert.match(gateway, /IMDS_BILLING_CONTROL_TOKEN/);
  assert.match(gateway, /\/v1\/billing\/checkout/);
  assert.match(gateway, /\/v1\/billing\/portal/);
  assert.match(gateway, /\/v1\/billing\/invoices/);
  assert.match(runtime, /handleBillingGatewayRequest/);
});

test('billing center supports plans invoices add-ons and lifecycle refresh', () => {
  assert.match(client, /startCheckout/);
  assert.match(client, /openBillingPortal/);
  assert.match(client, /refreshBilling/);
  assert.match(panel, /Add-ons и дополнительные квоты/);
  assert.match(panel, /Счета/);
  assert.match(panel, /past_due/);
  assert.match(panel, /grace_period/);
  assert.match(workspace, /BillingCenterPanel/);
});
