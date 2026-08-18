import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const routing = await readFile(new URL('../worker/integrationBranchRouting.ts', import.meta.url), 'utf8');
const main = await readFile(new URL('../worker/main.ts', import.meta.url), 'utf8');
const migration = await readFile(new URL('../supabase/migrations/20260818124500_integration_branch_routing.sql', import.meta.url), 'utf8');

test('WABA routes inbound messages by phone_number_id and fails closed when ambiguous', () => {
  assert.match(routing, /phone_number_id/);
  assert.match(routing, /phoneNumberId/);
  assert.match(routing, /BRANCH_ROUTE_UNRESOLVED/);
  assert.match(routing, /routeWaba/);
});

test('Zadarma resolves branch from existing call, DID, branch phone or PBX extension', () => {
  assert.match(routing, /pbx_call_id/);
  assert.match(routing, /called_did/);
  assert.match(routing, /branch\.phone/);
  assert.match(routing, /pbxExtension/);
  assert.match(routing, /inboundDids/);
});

test('Bitrix Meta and TikTok route from provider identity instead of primary branch fallback', () => {
  assert.match(routing, /webhookBaseUrl/);
  assert.match(routing, /selectedAdIds/);
  assert.match(routing, /advertiserIds/);
  assert.match(routing, /routeBitrix/);
  assert.match(routing, /routeMeta/);
  assert.match(routing, /routeTikTok/);
});

test('route claims are short lived, service-only and consumed before primary branch fallback', () => {
  assert.match(migration, /imds_integration_route_claims/);
  assert.match(migration, /expires_at > now\(\)/);
  assert.match(migration, /revoke all on public\.imds_integration_route_claims from anon, authenticated/);
  assert.match(migration, /resolved_branch := public\.imds_current_route_claim_branch\(new\.company_id\)/);
  const claim = migration.indexOf('imds_current_route_claim_branch(new.company_id)');
  const primary = migration.indexOf('b.is_primary = true');
  assert.ok(claim >= 0 && primary > claim, 'route claim must be evaluated before primary branch fallback');
});

test('manual sync requires a concrete branch and scheduled sync iterates branch credentials', () => {
  assert.match(routing, /Для синхронизации выберите конкретный филиал/);
  assert.match(routing, /runBranchRoutedScheduledSync/);
  assert.match(routing, /CURRENT_BRANCH_ID: branchId/);
  assert.match(routing, /provider=in\.\(bitrix,meta,tiktok\)/);
});

test('main runtime creates and releases routing leases and exposes diagnostics', () => {
  assert.match(main, /prepareInboundIntegrationRoute/);
  assert.match(main, /prepareManualIntegrationRoute/);
  assert.match(main, /releaseIntegrationRouteLease/);
  assert.match(main, /runBranchRoutedScheduledSync/);
  assert.match(main, /\/api\/integrations\/routing/);
});
