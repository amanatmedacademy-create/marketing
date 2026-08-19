import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migration = await readFile(new URL('../supabase/migrations/20260818104500_branch_hierarchy.sql', import.meta.url), 'utf8');
const bootstrapHardening = await readFile(new URL('../supabase/migrations/20260819234500_branch_bootstrap_hardening.sql', import.meta.url), 'utf8').catch(() => '');
const operational = await readFile(new URL('../supabase/migrations/20260818115500_branch_operational_scope.sql', import.meta.url), 'utf8');
const integrationKeys = await readFile(new URL('../supabase/migrations/20260818115600_branch_integration_keys.sql', import.meta.url), 'utf8');
const api = await readFile(new URL('../worker/branchManagement.ts', import.meta.url), 'utf8');
const scope = await readFile(new URL('../worker/tenantScope.ts', import.meta.url), 'utf8');
const operationalGuard = await readFile(new URL('../worker/branchOperationalScope.ts', import.meta.url), 'utf8');
const secured = await readFile(new URL('../worker/securedMain.ts', import.meta.url), 'utf8');
const mainWorker = await readFile(new URL('../worker/main.ts', import.meta.url), 'utf8');
const tenantData = await readFile(new URL('../worker/tenantDataApi.ts', import.meta.url), 'utf8');
const credentials = await readFile(new URL('../worker/credentials.ts', import.meta.url), 'utf8');
const runtime = await readFile(new URL('../server/vpsRuntime.ts', import.meta.url), 'utf8');
const quota = await readFile(new URL('../server/branchQuotaGateway.ts', import.meta.url), 'utf8');
const auth = await readFile(new URL('../src/services/auth.ts', import.meta.url), 'utf8');
const switcher = await readFile(new URL('../src/components/BranchSwitcher.tsx', import.meta.url), 'utf8');
const companySwitcher = await readFile(new URL('../src/components/CompanySwitcher.tsx', import.meta.url), 'utf8');
const panel = await readFile(new URL('../src/components/BranchManagementPanel.tsx', import.meta.url), 'utf8');
const branchWorkflow = await readFile(new URL('../.github/workflows/apply-branch-hierarchy-vps.yml', import.meta.url), 'utf8');

 test('branches are scoped inside crm_companies rather than replacing tenant identity', () => {
  assert.match(migration, /crm_branches/); assert.match(migration, /company_id uuid not null references public\.crm_companies\(id\)/); assert.match(migration, /crm_companies remains the tenant boundary/i); assert.doesNotMatch(migration, /alter table public\.crm_companies rename/);
});
test('existing clinics receive a compatible primary branch', () => {
  assert.match(migration, /insert into public\.crm_branches/); assert.match(migration, /'MAIN', true, 'active'/); assert.match(migration, /crm_branches_one_primary_uidx/); assert.match(migration, /imds_set_primary_branch/);
});
test('branch management remains tenant scoped and admin controlled', () => {
  assert.match(api, /resolveCompanyId/); assert.match(api, /role === 'owner' \|\| role === 'administrator'/); assert.match(api, /company_id=eq\./); assert.match(api, /Нет доступа к выбранному филиалу/); assert.match(secured, /handleBranchManagementRequest/);
});
test('active branch context is normalized server-side and attached to API requests', () => {
  assert.match(auth, /x-imds-branch-id/); assert.match(auth, /localStorage\.removeItem\(BRANCH_KEY\)/); assert.match(secured, /resolveRequestedBranchId/); assert.match(secured, /CURRENT_BRANCH_ID/); assert.match(scope, /branchScope/); assert.match(switcher, /setActiveBranchId/); assert.match(companySwitcher, /<BranchSwitcher/);
});
test('all branches mode is admin only and exposed in the switcher', () => {
  assert.match(api, /Режим «Все филиалы» доступен только владельцу или администратору/); assert.match(api, /allAvailable/); assert.match(switcher, /Все филиалы/); assert.match(switcher, /choose\('all'\)/);
});
test('operational tables backfill and validate branch ownership', () => {
  for (const table of ['marketing_leads','crm_tasks','integration_credentials','marketing_calls','marketing_conversations','marketing_messages','marketing_daily_metrics','marketing_ads']) assert.match(operational, new RegExp(table));
  assert.match(operational, /imds_assign_validate_branch/); assert.match(operational, /Branch does not belong to company/); assert.match(operational, /b\.is_primary = true/);
});
test('crm telephony and analytics apply branch filters', () => {
  assert.match(tenantData, /branchEq/); assert.match(tenantData, /branchWriteFields/); assert.match(tenantData, /marketing_leads/); assert.match(tenantData, /marketing_calls/); assert.match(tenantData, /marketing_daily_metrics/); assert.match(tenantData, /marketing_ads/); assert.match(tenantData, /callAnalytics/);
});
test('task and inbox handlers are guarded before data leaves the server', () => {
  assert.match(operationalGuard, /guardTaskBranch/); assert.match(operationalGuard, /finalizeTaskBranchResponse/); assert.match(operationalGuard, /guardInboxBranch/); assert.match(operationalGuard, /finalizeInboxBranchResponse/); assert.match(secured, /guardTaskBranch/); assert.match(secured, /finalizeInboxBranchResponse/);
});
test('integration credentials are isolated per branch', () => {
  assert.match(integrationKeys, /company_id, branch_id, provider/); assert.match(integrationKeys, /company_id,\s*branch_id,[\s\S]*phoneNumberId/); assert.match(credentials, /branch_id=eq\./); assert.match(credentials, /branch_id:branchId/); assert.match(credentials, /Для изменения интеграции выберите конкретный филиал/);
});
test('branch management UI supports mutations and comparative analytics', () => {
  assert.match(panel, /createBranch/); assert.match(panel, /setPrimaryBranch/); assert.match(panel, /archiveBranch/); assert.match(panel, /loadBranchAnalytics/); assert.match(panel, /Сравнение филиалов/); assert.match(switcher, /Управление филиалами/);
});
test('branch quota is enforced server-side from Control Plane limits', () => {
  assert.match(quota, /entitlement\?\.limits\?\.branches/); assert.match(quota, /key: 'branches'/); assert.match(quota, /QUOTA_EXCEEDED/); assert.match(runtime, /enforceBranchQuota/); assert.match(runtime, /branchQuotaDenied/);
});

test('trusted forwarding does not consume the branch mutation request body', () => {
  assert.match(secured, /forwardedRequest\s*=\s*trustedRequest\(cleanRequest\.clone\(\),\s*role,\s*user\.id,\s*branchId\)/);
  assert.match(secured, /handleBranchManagementRequest\(cleanRequest,\s*requestEnv,\s*url,\s*user\.id,\s*user\.platformRole\)/);
});

test('first manually created branch becomes primary when the clinic has no branches', () => {
  assert.match(api, /existingBranches\s*=\s*await localDataJson<[^>]+>\(scopedEnv,\s*`crm_branches\?company_id=eq\.\$\{encodeURIComponent\(companyId\)\}&status=neq\.archived&select=id&limit=1`/);
  assert.match(api, /is_primary:\s*existingBranches\.length\s*===\s*0/);
});

test('read-only call center workspace does not require integration credential hydration', () => {
  assert.match(mainWorker, /const skipIntegrationHydration\s*=\s*url\.pathname\s*===\s*'\/api\/callcenter\/workspace'\s*&&\s*request\.method\s*===\s*'GET'/);
  assert.match(mainWorker, /const runtimeEnv\s*=\s*skipIntegrationHydration\s*\?\s*requestEnv\s*:\s*await hydrateIntegrationEnv\(requestEnv\)/);
});

test('branch bootstrap hardening backfills missing branches and protects future clinic creation', () => {
  assert.match(bootstrapHardening, /insert into public\.crm_branches/i);
  assert.match(bootstrapHardening, /where not exists\s*\(\s*select 1\s*from public\.crm_branches/i);
  assert.match(bootstrapHardening, /create or replace function public\.imds_bootstrap_company_primary_branch\(\)/i);
  assert.match(bootstrapHardening, /after insert on public\.crm_companies/i);
  assert.match(bootstrapHardening, /for each row execute function public\.imds_bootstrap_company_primary_branch\(\)/i);
});

test('branch schema workflow deploys bootstrap hardening migration', () => {
  assert.match(branchWorkflow, /20260819234500_branch_bootstrap_hardening\.sql/);
  assert.match(branchWorkflow, /missing_primary/);
});
