import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migration = await readFile(
  new URL('../supabase/migrations/20260818123000_binotel_sipuni_telephony.sql', import.meta.url),
  'utf8',
);

const columnGuard = migration.indexOf('add column if not exists telephony_provider');
const constraint = migration.indexOf('add constraint marketing_calls_telephony_provider_check');

assert.ok(
  columnGuard >= 0,
  'Binotel/Sipuni migration must create marketing_calls.telephony_provider when the VPS skipped the universal telephony migration',
);
assert.ok(
  constraint >= 0,
  'Binotel/Sipuni migration must keep the telephony provider constraint',
);
assert.ok(
  columnGuard < constraint,
  'telephony_provider must exist before the migration adds marketing_calls_telephony_provider_check',
);

console.log('VPS telephony migration compatibility regression passed');
