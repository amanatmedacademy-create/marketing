import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('company switcher remains interactive with one clinic and exposes create/join actions', () => {
  const source = read('src/components/CompanySwitcher.tsx');
  assert.doesNotMatch(source, /companies\.length\s*<=\s*1/);
  assert.match(source, /Добавить клинику/);
  assert.match(source, /Присоединиться по коду/);
  assert.match(source, /createClinic/);
  assert.match(source, /joinClinic/);
});

test('platform super admin clinic access is not implemented through fake memberships', () => {
  const source = read('worker/companyContext.ts');
  assert.match(source, /platformRoleForMarketingUser/);
  assert.match(source, /platform_role/);
  assert.match(source, /role === 'super_admin'/);
  assert.match(source, /listPlatformCompanies/);
  assert.match(source, /Пользователь не состоит в текущей компании/);
});

test('clinic creation remains additive and keeps crm_companies as tenant', () => {
  const foundation = read('supabase/migrations/20260818033500_account_organization_clinic_foundation.sql');
  const runtime = read('supabase/migrations/20260818035000_account_clinic_runtime_flows.sql');
  assert.match(foundation, /crm_companies remains the canonical Marketing tenant table/);
  assert.match(foundation, /organization_id uuid references public\.imds_organizations/);
  assert.match(runtime, /imds_create_clinic/);
  assert.match(runtime, /imds_join_clinic/);
  assert.match(runtime, /'owner', 'active'/);
  assert.doesNotMatch(runtime, /drop table.*crm_companies/is);
});

test('account self service supports profile password and session lifecycle', () => {
  const source = read('worker/accountSelfService.ts');
  assert.match(source, /\/api\/account\/profile/);
  assert.match(source, /\/api\/account\/password/);
  assert.match(source, /\/api\/account\/sessions/);
  assert.match(source, /PBKDF2/);
  assert.match(source, /600_000/);
  assert.match(source, /revoked_at/);
});

test('personal account is separated from organization administration', () => {
  const source = read('src/components/UserWorkspaceModal.tsx');
  assert.match(source, /type PersonalTab = 'profile' \| 'clinics' \| 'security' \| 'preferences' \| 'access'/);
  assert.match(source, /type OrgTab = 'clinic' \| 'users' \| 'matrix' \| 'subscription'/);
  assert.match(source, /Активные сессии/);
  assert.match(source, /BillingCenterPanel/);
  assert.match(source, /label: 'Billing'/);
  assert.doesNotMatch(source, /Пароли в IMDS не хранятся/);
});

test('clinic timezone is organization scoped and owner manageable', () => {
  const api = read('worker/companySettings.ts');
  const panel = read('src/components/ClinicSettingsPanel.tsx');
  assert.match(api, /\/api\/company\/settings/);
  assert.match(api, /requireCompanyId/);
  assert.match(api, /role === 'owner'/);
  assert.match(api, /Intl\.DateTimeFormat/);
  assert.match(panel, /saveClinicSettings/);
  assert.match(panel, /Часовой пояс/);
  assert.match(panel, /Это настройка клиники, а не личный часовой пояс пользователя/);
});

test('analytics data quality diagnostics remain tenant scoped', () => {
  const api = read('worker/analyticsQuality.ts');
  const panel = read('src/components/AnalyticsDataQualityPanel.tsx');
  assert.match(api, /\/api\/analytics\/quality/);
  assert.match(api, /requireCompanyId/);
  assert.match(api, /company_id=eq\./);
  assert.match(api, /integration_runs/);
  assert.match(api, /integration_credentials/);
  assert.match(panel, /Качество данных/);
  assert.match(panel, /Неатрибутировано/);
  assert.match(panel, /Покрытие валют/);
});

test('expired subscription allows reads but blocks mutations', () => {
  const source = read('server/platformControl.ts');
  assert.match(source, /readOnlyRequest = method === 'GET' \|\| method === 'HEAD' \|\| method === 'OPTIONS'/);
  assert.match(source, /if \(!locked \|\| readOnlyRequest\) return null/);
  assert.match(source, /SUBSCRIPTION_READ_ONLY/);
  assert.match(source, /status === 'past_due'\) return null/);
  assert.match(source, /url\.pathname\.startsWith\('\/api\/account\/'\)/);
});

test('subscription UI describes read-only retention instead of replacing the whole app', () => {
  const source = read('src/components/SubscriptionStatusLayer.tsx');
  assert.match(source, /Режим только для чтения/);
  assert.match(source, /Данные сохранены/);
  assert.match(source, /\{children\}/);
  assert.doesNotMatch(source, /minHeight:\s*'100vh'/);
});
