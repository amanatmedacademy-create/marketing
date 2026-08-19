import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const panelUrl = new URL('../src/components/BranchManagementPanel.tsx', import.meta.url);

test('branch create validation is scoped to the open create form and clears on close', async () => {
  const source = await readFile(panelUrl, 'utf8');

  assert.match(source, /formError/);
  assert.match(source, /setFormError\(''\)/);
  assert.match(source, /creating\s*&&\s*formError/);
  assert.match(source, /setCreating\(false\).*setDraft\(emptyDraft\).*setFormError\(''\)/s);
});
