import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const specs = [
  {
    theme: 'light',
    filename: 'imds-bg-light.webp',
    files: ['background.webp.b64'],
    expectedBytes: 103_290,
    format: 'webp',
  },
  {
    theme: 'dark',
    filename: 'imds-bg-dark.jpg',
    files: null,
    expectedBytes: 580_669,
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
  const isWebp = output.length >= 12
    && output.subarray(0, 4).toString('ascii') === 'RIFF'
    && output.subarray(8, 12).toString('ascii') === 'WEBP';

  if (spec.format === 'jpeg' && !isJpeg) throw new Error(`IMDS ${spec.theme} background is an incomplete JPEG`);
  if (spec.format === 'webp' && !isWebp) throw new Error(`IMDS ${spec.theme} background is an incomplete WEBP`);
  if (output.length !== spec.expectedBytes) {
    throw new Error(
      `IMDS ${spec.theme} background size mismatch: ${output.length} != ${spec.expectedBytes}`,
    );
  }

  await writeFile(join(root, 'public', spec.filename), output);
}
