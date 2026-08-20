import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

async function source(path) {
  return readFile(new URL(path, import.meta.url), 'utf8').catch(() => '');
}

const sdkContract = await source('../src/platform/sdkContract.ts');
const client = await source('../src/platform/client.ts');
const platformContext = await source('../src/platform/PlatformContext.tsx');
const context = await source('../src/platform/context.ts');
const main = await source('../src/main.tsx');
const marketing = await source('../src/MarketingPlatform.tsx');

test('canonical SDK compatibility contract preserves platform access scopes and MeContext', () => {
  assert.match(sdkContract, /organization[^\n]+branch[^\n]+product[^\n]+branch_product/);
  assert.match(sdkContract, /export interface MeContext/);
  assert.match(sdkContract, /branches\?: BranchContext\[\]/);
  assert.match(sdkContract, /accessScopes\?: AccessScopeContext\[\]/);
});

test('platform client follows canonical getMeContext bearer contract', () => {
  assert.match(client, /createPlatformClient/);
  assert.match(client, /tokenProvider/);
  assert.match(client, /Authorization/);
  assert.match(client, /Bearer/);
  assert.match(client, /\/api\/platform\/me\/context/);
});

test('canonical context mapping fails closed on tenant and branch mismatch', () => {
  assert.match(context, /buildPlatformFrontendContextFromMeContext/);
  assert.match(context, /tenant\.id/);
  assert.match(context, /activeOrganizationId/);
  assert.match(context, /activeBranchId/);
  assert.match(context, /Tenant context mismatch/);
  assert.match(context, /Branch context mismatch/);
});

test('single PlatformContextProvider owns canonical probe and legacy fallback', () => {
  assert.match(platformContext, /createPlatformClient/);
  assert.match(platformContext, /buildPlatformFrontendContextFromMeContext/);
  assert.match(platformContext, /buildPlatformFrontendContext/);
  assert.match(platformContext, /source:\s*'canonical'\s*\|\s*'legacy'/);
  assert.match(platformContext, /platform:\s*PlatformEntitlements\s*\|\s*null/);
  assert.match(platformContext, /canonicalError/);
  assert.match(main, /PlatformContextProvider/);
  assert.match(main, /<AuthGate><PlatformContextProvider>/);
});

test('MarketingPlatform consumes unified platform context instead of polling entitlements directly', () => {
  assert.match(marketing, /usePlatformContext/);
  assert.doesNotMatch(marketing, /loadPlatformEntitlements/);
  assert.match(marketing, /context\.entitlements/);
  assert.match(marketing, /<MarketingOS platform=\{platform\}/);
});
