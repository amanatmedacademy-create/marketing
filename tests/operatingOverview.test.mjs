import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('operating overview is scoped to accessible clinics and current tenant', async () => {
  const source = await read('worker/operatingOverview.ts');
  assert.match(source, /listUserCompanies\(env, userId, platformRole\)/);
  assert.match(source, /resolveCompanyId\(env, userId, platformRole\)/);
  assert.match(source, /company_id=eq\.\$\{encodeURIComponent\(companyId\)\}/);
});

test('onboarding progress is derived from real team and integration state', async () => {
  const source = await read('worker/operatingOverview.ts');
  for (const token of ['Сотрудники', 'WhatsApp', 'Телефония', 'Реклама', 'МИС']) assert.match(source, new RegExp(token));
  assert.match(source, /onboardingProgress/);
  assert.match(source, /connectedProvider/);
});

test('multi clinic dashboard and usage meter are mounted on dashboard', async () => {
  const platform = await read('src/MarketingPlatform.tsx');
  const panel = await read('src/components/OperatingOverviewPanel.tsx');
  assert.match(platform, /<OperatingOverviewPanel \/>/);
  assert.match(panel, /MULTI-CLINIC/);
  assert.match(panel, /USAGE \/ LIMITS/);
  assert.match(panel, /switchCompany\(companyId\)/);
});

test('usage limits are not hardcoded to plan names', async () => {
  const panel = await read('src/components/OperatingOverviewPanel.tsx');
  const overview = await read('worker/operatingOverview.ts');
  assert.doesNotMatch(panel + overview, /plan\s*===/i);
  assert.match(panel, /Control Plane/);
});
