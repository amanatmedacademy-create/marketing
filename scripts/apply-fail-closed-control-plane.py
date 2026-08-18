from pathlib import Path
import json

root = Path('.')
platform = root / 'server/platformControl.ts'
text = platform.read_text()

anchor = "async function listCompanies(env: PlatformEnv): Promise<Array<{ id: string; name: string; slug: string }>> {"
insert = r'''type PlatformManagementStatus = 'managed' | 'unmanaged' | 'unknown';

async function dataPatch(env: PlatformEnv, pathName: string, body: unknown): Promise<void> {
  const config = dataConfig(env);
  if (!config) throw new Error('LOCAL_DATA_NOT_CONFIGURED');
  const response = await fetch(`${config.base}/rest/v1/${pathName.replace(/^\/+/, '')}`, {
    method: 'PATCH',
    headers: { apikey: config.key, authorization: `Bearer ${config.key}`, 'content-type': 'application/json', prefer: 'return=minimal' },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`LOCAL_PATCH_${response.status}:${(await response.text()).slice(0, 300)}`);
}

async function platformManagementStatus(tenantId: string, env: PlatformEnv): Promise<PlatformManagementStatus> {
  try {
    const rows = await dataRows<Array<{ platform_managed_at?: unknown }>>(
      env,
      `crm_companies?id=eq.${encodeURIComponent(tenantId)}&select=platform_managed_at&limit=1`,
    );
    if (!rows.length) return 'unknown';
    return text(rows[0]?.platform_managed_at) ? 'managed' : 'unmanaged';
  } catch {
    return 'unknown';
  }
}

async function markPlatformManagedTenant(tenantId: string, env: PlatformEnv): Promise<void> {
  await dataPatch(env, `crm_companies?id=eq.${encodeURIComponent(tenantId)}`, { platform_managed_at: new Date().toISOString() });
}

'''
if 'type PlatformManagementStatus =' not in text:
    if anchor not in text:
        raise SystemExit('listCompanies anchor missing')
    text = text.replace(anchor, insert + anchor, 1)

old = 'async function applyStandardCommand(command: StandardPlatformCommand): Promise<Response> {'
new = 'async function applyStandardCommand(command: StandardPlatformCommand, env: PlatformEnv): Promise<Response> {'
if old in text:
    text = text.replace(old, new, 1)
elif new not in text:
    raise SystemExit('applyStandardCommand signature missing')

old = "  state.tenants[tenantId] = tenant;\n  await writeState(state);\n  return json({ commandId, status: 'completed', externalTenantId: tenantId, completedAt: new Date().toISOString(), data: { revision: tenant.revision } });"
new = "  await markPlatformManagedTenant(tenantId, env);\n  state.tenants[tenantId] = tenant;\n  await writeState(state);\n  return json({ commandId, status: 'completed', externalTenantId: tenantId, completedAt: new Date().toISOString(), data: { revision: tenant.revision } });"
if old in text:
    text = text.replace(old, new, 1)
elif new not in text:
    raise SystemExit('standard command state write anchor missing')

old = '    return applyStandardCommand(command);'
new = '    return applyStandardCommand(command, env);'
if old in text:
    text = text.replace(old, new, 1)
elif new not in text:
    raise SystemExit('standard command call anchor missing')

old = "    state.tenants[tenantId] = tenant;\n    await writeState(state);\n    return json({ applied: true, tenant });"
new = "    await markPlatformManagedTenant(tenantId, env);\n    state.tenants[tenantId] = tenant;\n    await writeState(state);\n    return json({ applied: true, tenant });"
if old in text:
    text = text.replace(old, new, 1)
elif new not in text:
    raise SystemExit('entitlement apply state write anchor missing')

old = "  const localTrial = await localTrialForTenant(tenantId, env);\n  const localTrialDenied = billingDenied(localTrial || undefined, method);\n  if (localTrialDenied) return localTrialDenied;\n  return null;"
new = "  const managementStatus = await platformManagementStatus(tenantId, env);\n  if (managementStatus === 'managed') {\n    return json({ error: 'PLATFORM_ENTITLEMENT_UNAVAILABLE', retryable: true }, 503);\n  }\n  if (managementStatus === 'unknown') {\n    return json({ error: 'PLATFORM_MANAGEMENT_STATE_UNAVAILABLE', retryable: true }, 503);\n  }\n\n  const localTrial = await localTrialForTenant(tenantId, env);\n  const localTrialDenied = billingDenied(localTrial || undefined, method);\n  if (localTrialDenied) return localTrialDenied;\n  return null;"
if old in text:
    text = text.replace(old, new, 1)
elif new not in text:
    raise SystemExit('fallback enforcement anchor missing')

old = "return json({ product: 'imds-marketing', runtime: 'vps', protocol: 3, pid: process.pid, uptimeSeconds: Math.floor(process.uptime()) });"
new = "return json({ product: 'imds-marketing', runtime: 'vps', protocol: 3, entitlementMode: 'fail-closed-managed', pid: process.pid, uptimeSeconds: Math.floor(process.uptime()) });"
if old in text:
    text = text.replace(old, new, 1)
elif new not in text:
    raise SystemExit('platform info anchor missing')

platform.write_text(text)

migration = root / 'supabase/migrations/20260818093000_fail_closed_control_plane.sql'
migration.write_text("""-- Fail closed for Marketing tenants enrolled in the IMDS Control Plane.\n-- No existing tenant is marked automatically; enrollment occurs only after a real Control Plane apply/command.\n\nalter table public.crm_companies\n  add column if not exists platform_managed_at timestamptz;\n\ncreate index if not exists crm_companies_platform_managed_idx\n  on public.crm_companies (id)\n  where platform_managed_at is not null;\n\ncomment on column public.crm_companies.platform_managed_at is\n  'Set by the IMDS Control Plane adapter after successful tenant enrollment/synchronization. Missing entitlements for marked tenants fail closed.';\n\nnotify pgrst, 'reload schema';\n""")

test_file = root / 'tests/failClosedEntitlements.test.mjs'
test_file.write_text(r'''import test from 'node:test';
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
''')

package_path = root / 'package.json'
package = json.loads(package_path.read_text())
package['scripts']['test:fail-closed'] = 'node --experimental-strip-types --test tests/failClosedEntitlements.test.mjs'
package_path.write_text(json.dumps(package, ensure_ascii=False, indent=2) + '\n')

ci = root / '.github/workflows/ci.yml'
ci_text = ci.read_text()
ci_anchor = "      - name: Billing Center regression tests\n        run: npm run test:billing\n\n"
ci_step = "      - name: Fail-closed entitlement regression tests\n        run: npm run test:fail-closed\n\n"
if ci_step not in ci_text:
    if ci_anchor not in ci_text:
        raise SystemExit('CI anchor missing')
    ci_text = ci_text.replace(ci_anchor, ci_anchor + ci_step, 1)
ci.write_text(ci_text)

install = root / 'deploy/vps/install-release.sh'
install_text = install.read_text()
install_anchor = "cd \"$RELEASE_DIR\"\nnpm install --omit=dev --no-audit --no-fund || npm install --no-audit --no-fund\n\nnginx -t"
install_block = "cd \"$RELEASE_DIR\"\nnpm install --omit=dev --no-audit --no-fund || npm install --no-audit --no-fund\n\nFAIL_CLOSED_MIGRATION=\"$RELEASE_DIR/supabase/migrations/20260818093000_fail_closed_control_plane.sql\"\nif [ -f \"$FAIL_CLOSED_MIGRATION\" ]; then\n  cat \"$FAIL_CLOSED_MIGRATION\" | docker exec -i imds-postgres psql -v ON_ERROR_STOP=1 -U imds_owner -d imds_marketing\nfi\n\nnginx -t"
if 'FAIL_CLOSED_MIGRATION=' not in install_text:
    if install_anchor not in install_text:
        raise SystemExit('install release anchor missing')
    install_text = install_text.replace(install_anchor, install_block, 1)
install.write_text(install_text)

print('fail-closed Control Plane enforcement applied')
