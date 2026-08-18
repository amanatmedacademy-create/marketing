import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const gateway = await readFile(new URL('../server/billingGateway.ts', import.meta.url), 'utf8');
const control = await readFile(new URL('../server/billingControlPlane.ts', import.meta.url), 'utf8');
const runtime = await readFile(new URL('../server/vpsRuntime.ts', import.meta.url), 'utf8');
const scheduler = await readFile(new URL('../server/vpsScheduler.ts', import.meta.url), 'utf8');
const service = await readFile(new URL('../deploy/vps/imds-marketing.service', import.meta.url), 'utf8');
const migration = await readFile(new URL('../supabase/migrations/20260818063500_billing_control_plane.sql', import.meta.url), 'utf8');
const client = await readFile(new URL('../src/services/billing.ts', import.meta.url), 'utf8');
const panel = await readFile(new URL('../src/components/BillingCenterPanel.tsx', import.meta.url), 'utf8');
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

test('checkout is a server-to-server Control Center operation', () => {
  assert.match(gateway, /IMDS_BILLING_CONTROL_URL/);
  assert.match(gateway, /IMDS_BILLING_CONTROL_TOKEN/);
  assert.match(gateway, /\/v1\/billing\/checkout/);
  assert.match(gateway, /\/v1\/billing\/invoices/);
  assert.match(gateway, /billingPeriodMonths/);
  assert.match(runtime, /handleBillingGatewayRequest/);
  assert.match(runtime, /handleBillingControlPlaneRequest/);
  assert.match(service, /IMDS_BILLING_CONTROL_URL=http:\/\/127\.0\.0\.1:8788/);
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

test('billing control plane persists catalog orders subscriptions and grants', () => {
  assert.match(migration, /create table if not exists public\.imds_billing_plans/);
  assert.match(migration, /create table if not exists public\.imds_billing_orders/);
  assert.match(migration, /create table if not exists public\.imds_billing_subscriptions/);
  assert.match(migration, /create table if not exists public\.imds_billing_addon_grants/);
  assert.match(migration, /'start','marketing','BELES Start'.*49900/s);
  assert.match(migration, /'pro','marketing','BELES Pro'.*99900/s);
  assert.match(migration, /'business','marketing','BELES Business'.*249900/s);
});

test('CloudPayments checkout and webhooks validate provider state before granting entitlements', () => {
  assert.match(control, /https:\/\/api\.cloudpayments\.ru\/orders\/create/);
  assert.match(control, /createHmac\('sha256'/);
  assert.match(control, /timingSafeEqual/);
  assert.match(control, /params\.AccountId/);
  assert.match(control, /params\.Amount/);
  assert.match(control, /params\.Currency/);
  assert.match(control, /\/api\\\/webhooks\\\/cloudpayments\\\/\(check\|pay\|fail\|refund\)/);
  assert.match(control, /syncEntitlements/);
  assert.match(control, /billing-sync:/);
});

test('legacy payment lifecycle remains fail-safe and scheduled', () => {
  assert.match(control, /status: 'past_due'/);
  assert.match(control, /status: 'grace_period'/);
  assert.match(control, /status: 'suspended'/);
  assert.match(control, /status: 'expired'/);
  assert.match(scheduler, /runBillingLifecycleTick/);
  assert.match(scheduler, /cron === '15 \* \* \* \*'/);
});

test('payment credentials remain outside the application repository', () => {
  assert.match(control, /CLOUDPAYMENTS_PUBLIC_ID/);
  assert.match(control, /CLOUDPAYMENTS_API_SECRET/);
  assert.match(service, /EnvironmentFile=-\/etc\/imds-cloudpayments\.env/);
  assert.doesNotMatch(control, /CLOUDPAYMENTS_API_SECRET\s*=\s*['"][^'"]+['"]/);
});