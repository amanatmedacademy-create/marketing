import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const specs = [
  ['light', 'imds-bg-light.jpg'],
  ['dark', 'imds-bg-dark.jpg'],
];

await mkdir(join(root, 'public'), { recursive: true });

for (const [theme, filename] of specs) {
  const dir = join(root, 'src', 'background-assets', theme);
  const files = (await readdir(dir)).filter((name) => name.endsWith('.b64')).sort();
  if (!files.length) throw new Error(`No IMDS background chunks found for ${theme}`);
  const parts = await Promise.all(files.map(async (name) => (await readFile(join(dir, name), 'utf8')).trim()));
  await writeFile(join(root, 'public', filename), Buffer.from(parts.join(''), 'base64'));
}
