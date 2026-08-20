import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('platform frontend boundary models canonical access scopes and context', () => {
  const types = read('src/platform/types.ts');
  const context = read('src/platform/context.ts');
  assert.match(types, /'organization'\s*\|\s*'branch'\s*\|\s*'product'\s*\|\s*'branch_product'/);
  assert.match(types, /PlatformBranch/);
  assert.match(types, /PlatformAccessScope/);
  assert.match(types, /PlatformProductRegistration/);
  assert.match(context, /buildPlatformFrontendContext/);
  assert.match(context, /organizationId/);
  assert.match(context, /branchId/);
  assert.match(context, /accessScopes/);
});

test('organization switching owns branch reset through one adapter', () => {
  const selection = read('src/platform/selection.ts');
  assert.match(selection, /activeBranchId/);
  assert.match(selection, /setActiveBranchId/);
  assert.match(selection, /switchOrganizationContext/);
  assert.match(selection, /removeItem\(BRANCH_KEY\)/);

  const auth = read('src/services/auth.ts');
  const branches = read('src/services/branches.ts');
  assert.match(auth, /switchOrganizationContext/);
  assert.match(auth, /activeBranchId/);
  assert.match(branches, /from '\.\.\/platform\/selection'/);
});

test('product registry separates marketing and crm ownership', () => {
  const registry = read('src/platform/productRegistry.ts');
  assert.match(registry, /code:\s*'marketing'/);
  assert.match(registry, /code:\s*'crm'/);
  assert.match(registry, /routePrefix:\s*'\/marketing'/);
  assert.match(registry, /routePrefix:\s*'\/crm'/);
  for (const route of ['/leads', '/customers', '/pipeline']) assert.match(registry, new RegExp(route.replace('/', '\\/')));
  assert.match(registry, /canAccessRegisteredProduct/);
  assert.doesNotMatch(registry, /worker\//);
  assert.doesNotMatch(registry, /server\//);
});
