import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const platform = await readFile(new URL('../server/platformControl.ts', import.meta.url), 'utf8');
const runtime = await readFile(new URL('../server/vpsRuntime.ts', import.meta.url), 'utf8');
const ui = await readFile(new URL('../src/components/OperatingOverviewPanel.tsx', import.meta.url), 'utf8');
const statusLayer = await readFile(new URL('../src/components/SubscriptionStatusLayer.tsx', import.meta.url), 'utf8');

 test('control plane accepts numerical quota keys without plan-name coupling', () => {
  for (const key of ['limits.clinics','limits.users','limits.leads','limits.open_tasks','limits.integrations']) assert.match(platform, new RegExp(key.replace('.', '\\.')));
  assert.doesNotMatch(platform, /plan\s*===|planName|\bSTART\b|\bPRO\b|\bBUSINESS\b/);
});

test('hard quota enforcement protects growth operations while leads remain soft', () => {
  assert.match(platform, /QUOTA_EXCEEDED/);
  assert.match(platform, /pathname === '\/api\/clinics'/);
  assert.match(platform, /pathname === '\/api\/tasks'/);
  assert.match(platform, /\/api\/admin\/users\/invitations/);
  assert.match(platform, /integrations\/config/);
  assert.match(platform, /key === 'leads' \? 'soft' : 'hard'/);
  assert.match(platform, /if \(!key \|\| key === 'leads'\) return null/);
});

test('browser entitlement state exposes limits and live quota snapshot', () => {
  assert.match(runtime, /limits: entitlement\.limits \|\| \{\}/);
  assert.match(runtime, /platformQuotaSnapshotForTenant/);
  assert.match(runtime, /quota,/);
});

test('usage UI renders quota meters and threshold states', () => {
  assert.match(ui, /USAGE \/ LIMITS/);
  assert.match(ui, /usage-meter/);
  assert.match(ui, /quota\.level/);
  assert.match(ui, /quota\.percent/);
  assert.match(statusLayer, /Лимит достигнут/);
  assert.match(statusLayer, /Использовано/);
});
