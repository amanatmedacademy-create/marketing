import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const gateway = await readFile(new URL('../server/billingGateway.ts', import.meta.url), 'utf8');
const runtime = await readFile(new URL('../server/vpsRuntime.ts', import.meta.url), 'utf8');
const scheduler = await readFile(new URL('../server/vpsScheduler.ts', import.meta.url), 'utf8');
const service = await readFile(new URL('../deploy/vps/imds-marketing.service', import.meta.url), 'utf8');
const legacyControl = await readFile(new URL('../server/billingControlPlane.ts', import.meta.url), 'utf8');
const client = await readFile(new URL('../src/services/billing.ts', import.meta.url), 'utf8');
const panel = await readFile(new URL('../src/components/BillingCenterPanel.tsx', import.meta.url), 'utf8');
const statusLayer = await readFile(new URL('../src/components/SubscriptionStatusLayer.tsx', import.meta.url), 'utf8');
const workspace = await readFile(new URL('../src/components/UserWorkspaceModal.tsx', import.meta.url), 'utf8');
const platform = await readFile(new URL('../src/MarketingPlatform.tsx', import.meta.url), 'utf8');

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

test('Marketing delegates billing to IMDS Control Center', () => {
  assert.match(gateway, /IMDS_BILLING_CONTROL_URL/);
  assert.match(gateway, /IMDS_BILLING_CONTROL_TOKEN/);
  assert.match(gateway, /\/v1\/billing\/checkout/);
  assert.match(gateway, /\/v1\/billing\/invoices/);
  assert.match(gateway, /billingPeriodMonths/);
  assert.match(runtime, /handleBillingGatewayRequest/);
  assert.doesNotMatch(runtime, /handleBillingControlPlaneRequest/);
  assert.doesNotMatch(scheduler, /runBillingLifecycleTick/);
  assert.match(service, /IMDS_BILLING_CONTROL_URL=http:\/\/127\.0\.0\.1:8788/);
  assert.doesNotMatch(service, /imds-cloudpayments\.env/);
});

test('billing center supports plans invoices limits and lifecycle recovery', () => {
  assert.match(client, /startCheckout/);
  assert.match(client, /billingPeriodMonths/);
  assert.match(client, /refreshBilling/);
  assert.match(panel, /Тариф и оплата/);
  assert.match(panel, /Лимиты текущего тарифа/);
  assert.match(panel, /<h4>Add-ons<\/h4>/);
  assert.match(panel, /Счета/);
  assert.match(panel, /past_due/);
  assert.match(panel, /read_only/);
  assert.match(panel, /grace/);
  assert.match(workspace, /BillingCenterPanel/);
  assert.match(platform, /to: '\/billing'/);
  assert.match(platform, /location\.pathname !== '\/billing'/);
});

test('subscription UI accepts Control Center canonical and legacy status aliases', () => {
  assert.match(statusLayer, /pending_payment/);
  assert.match(statusLayer, /read_only/);
  assert.match(statusLayer, /canceled/);
  assert.match(statusLayer, /cancelled/);
  assert.match(statusLayer, /grace_period/);
  assert.match(statusLayer, /status === 'grace'/);
  assert.match(statusLayer, /free/);
  assert.match(statusLayer, /beta/);
});

test('legacy local billing implementation remains inert and credential-free at runtime', () => {
  assert.match(legacyControl, /CLOUDPAYMENTS_PUBLIC_ID/);
  assert.match(legacyControl, /CLOUDPAYMENTS_API_SECRET/);
  assert.doesNotMatch(runtime, /billingControlPlane/);
  assert.doesNotMatch(scheduler, /billingControlPlane/);
  assert.doesNotMatch(service, /CLOUDPAYMENTS_PUBLIC_ID|CLOUDPAYMENTS_API_SECRET/);
});
