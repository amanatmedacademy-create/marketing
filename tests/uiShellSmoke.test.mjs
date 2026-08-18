import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const platform = await readFile(new URL('../src/MarketingPlatform.tsx', import.meta.url), 'utf8');
const marketing = await readFile(new URL('../src/pages/MarketingOS.tsx', import.meta.url), 'utf8');
const main = await readFile(new URL('../src/main.tsx', import.meta.url), 'utf8');

const requiredRoutes = [
  '/',
  '/tasks',
  '/crm',
  '/chat',
  '/telephony',
  '/schedule',
  '/marketing',
  '/growth',
  '/assistant',
  '/integrations',
  '/data-quality',
  '/audit',
];

test('primary product routes remain mounted in the marketing shell', () => {
  for (const route of requiredRoutes) {
    const escaped = route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    assert.match(platform, new RegExp(`path=["']${escaped}["']|to: ["']${escaped}["']`), `missing route ${route}`);
  }
});

test('marketing overview owns summary analytics while analytics keeps drill-down', () => {
  assert.match(marketing, /view === 'overview'[\s\S]*<Overview/);
  assert.match(marketing, /marketing-overview-analytics[\s\S]*<V36Dashboard\s*\/>/);
  assert.match(marketing, /view === 'analytics'[\s\S]*<AnalyticsWorkspace\s*\/>/);
  assert.match(marketing, /Сводные KPI и графики перенесены в «Обзор»/);
});

test('theme is initialized before React render', () => {
  assert.match(main, /document\.documentElement\.dataset\.theme = theme/);
  assert.ok(main.indexOf('applyInitialTheme();') < main.indexOf('ReactDOM.createRoot'), 'theme must be applied before mount');
});

test('final color authority loads after legacy harmony and before brand/readability overrides', () => {
  const legacy = main.indexOf("import './imds-legacy-color-cleanup.css';");
  const finalColor = main.indexOf("import './imds-color-system-final.css';");
  const brand = main.indexOf("import './beles-brand.css';");
  const readability = main.indexOf("import './ui-readability-final.css';");
  assert.ok(legacy >= 0 && finalColor > legacy, 'final color system must load after legacy cleanup');
  assert.ok(brand > finalColor, 'BELES brand overrides must load after final color system');
  assert.ok(readability > brand, 'readability overrides must remain last');
});
