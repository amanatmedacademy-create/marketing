import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const specs = [
  { theme: 'light', filename: 'imds-bg-light.jpg', files: ['00.b64', '01.b64', '02.b64'] },
  { theme: 'dark', filename: 'imds-bg-dark.jpg', files: null },
];

await mkdir(join(root, 'public'), { recursive: true });

for (const spec of specs) {
  const dir = join(root, 'src', 'background-assets', spec.theme);
  const files = spec.files || (await readdir(dir)).filter((name) => name.endsWith('.b64')).sort();
  if (!files.length) throw new Error(`No IMDS background chunks found for ${spec.theme}`);
  const parts = await Promise.all(files.map(async (name) => (await readFile(join(dir, name), 'utf8')).trim()));
  const output = Buffer.from(parts.join(''), 'base64');
  if (output.length < 100_000) throw new Error(`IMDS ${spec.theme} background is unexpectedly small`);
  await writeFile(join(root, 'public', spec.filename), output);
}
