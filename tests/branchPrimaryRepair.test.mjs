import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';

const migrationUrl = new URL('../supabase/migrations/20260820000500_ensure_primary_branch.sql', import.meta.url);

test('first or missing branch is repaired to a primary branch', async () => {
  assert.equal(existsSync(migrationUrl), true, 'primary-branch repair migration is missing');
  const migration = await readFile(migrationUrl, 'utf8');
  assert.match(migration, /imds_ensure_primary_branch_on_insert/);
  assert.match(migration, /before insert on public\.crm_branches/);
  assert.match(migration, /new\.is_primary := true/);
  assert.match(migration, /Companies with no branch at all receive a deterministic primary branch|insert into public\.crm_branches/i);
  assert.match(migration, /not exists[\s\S]*is_primary = true/);
});
