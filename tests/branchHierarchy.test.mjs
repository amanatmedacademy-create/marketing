import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migration = await readFile(new URL('../supabase/migrations/20260818104500_branch_hierarchy.sql', import.meta.url), 'utf8');
const api = await readFile(new URL('../worker/branchManagement.ts', import.meta.url), 'utf8');
const secured = await readFile(new URL('../worker/securedMain.ts', import.meta.url), 'utf8');
const runtime = await readFile(new URL('../server/vpsRuntime.ts', import.meta.url), 'utf8');
const quota = await readFile(new URL('../server/branchQuotaGateway.ts', import.meta.url), 'utf8');
const auth = await readFile(new URL('../src/services/auth.ts', import.meta.url), 'utf8');
const switcher = await readFile(new URL('../src/components/BranchSwitcher.tsx', import.meta.url), 'utf8');
const companySwitcher = await readFile(new URL('../src/components/CompanySwitcher.tsx', import.meta.url), 'utf8');
const panel = await readFile(new URL('../src/components/BranchManagementPanel.tsx', import.meta.url), 'utf8');

test('branches are scoped inside crm_companies rather than replacing tenant identity', () => {
  assert.match(migration, /crm_branches/);
  assert.match(migration, /company_id uuid not null references public\.crm_companies\(id\)/);
  assert.match(migration, /crm_companies remains the tenant boundary/i);
  assert.doesNotMatch(migration, /alter table public\.crm_companies rename/);
});

test('existing clinics receive a compatible primary branch', () => {
  assert.match(migration, /insert into public\.crm_branches/);
  assert.match(migration, /'MAIN', true, 'active'/);
  assert.match(migration, /crm_branches_one_primary_uidx/);
  assert.match(migration, /imds_set_primary_branch/);
});

test('branch management remains tenant scoped and admin controlled', () => {
  assert.match(api, /resolveCompanyId/);
  assert.match(api, /role === 'owner' \|\| role === 'administrator'/);
  assert.match(api, /company_id=eq\./);
  assert.match(api, /Нет доступа к выбранному филиалу/);
  assert.match(secured, /handleBranchManagementRequest/);
});

test('active branch context is attached to API requests and reset on clinic switch', () => {
  assert.match(auth, /x-imds-branch-id/);
  assert.match(auth, /localStorage\.removeItem\(BRANCH_KEY\)/);
  assert.match(switcher, /setActiveBranchId/);
  assert.match(companySwitcher, /<BranchSwitcher/);
});

test('branch management UI supports create primary status and archive actions', () => {
  assert.match(panel, /createBranch/);
  assert.match(panel, /setPrimaryBranch/);
  assert.match(panel, /archiveBranch/);
  assert.match(switcher, /Управление филиалами/);
});

test('branch quota is enforced server-side from Control Plane limits', () => {
  assert.match(quota, /entitlement\?\.limits\?\.branches/);
  assert.match(quota, /key: 'branches'/);
  assert.match(quota, /QUOTA_EXCEEDED/);
  assert.match(runtime, /enforceBranchQuota/);
  assert.match(runtime, /branchQuotaDenied/);
});
