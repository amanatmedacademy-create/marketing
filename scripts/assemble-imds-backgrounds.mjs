import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

// Light theme background is served directly from Supabase Storage.
// Only local backgrounds that still ship with the app are assembled here.
const specs = [
  {
    theme: 'dark',
    filename: 'imds-bg-dark.jpg',
    files: null,
    expectedBytes: 21_036,
    format: 'jpeg',
  },
];

await mkdir(join(root, 'public'), { recursive: true });

for (const spec of specs) {
  const dir = join(root, 'src', 'background-assets', spec.theme);
  const files = spec.files || (await readdir(dir)).filter((name) => name.endsWith('.b64')).sort();
  if (!files.length) throw new Error(`No IMDS background chunks found for ${spec.theme}`);

  const parts = await Promise.all(
    files.map(async (name) => (await readFile(join(dir, name), 'utf8')).trim()),
  );
  const output = Buffer.from(parts.join(''), 'base64');

  const isJpeg = output.length >= 4
    && output[0] === 0xff
    && output[1] === 0xd8
    && output[output.length - 2] === 0xff
    && output[output.length - 1] === 0xd9;

  if (spec.format === 'jpeg' && !isJpeg) {
    throw new Error(`IMDS ${spec.theme} background is an incomplete JPEG`);
  }
  if (output.length !== spec.expectedBytes) {
    throw new Error(
      `IMDS ${spec.theme} background size mismatch: ${output.length} != ${spec.expectedBytes}`,
    );
  }

  await writeFile(join(root, 'public', spec.filename), output);
}
