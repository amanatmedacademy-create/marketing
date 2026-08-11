import { access, copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const exists = (path) => access(path).then(() => true, () => false);

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const specs = [
  {
    theme: 'light',
    filename: 'imds-bg-light.jpg',
    files: ['00.b64', '01.b64', '02.b64', '03.b64'],
    expectedBytes: 531_349,
  },
  {
    theme: 'dark',
    filename: 'imds-bg-dark.jpg',
    files: null,
    expectedBytes: 580_669,
  },
];

await mkdir(join(root, 'public'), { recursive: true });

// Фон — декоративный ресурс: битые чанки не должны блокировать сборку
// всего продукта. При ошибке оставляем прежний файл (или общий фон)
// и громко предупреждаем, чтобы артефакт переэкспортировали.
async function fallback(spec, reason) {
  const target = join(root, 'public', spec.filename);
  if (await exists(target)) {
    console.warn(`[imds-bg] ${spec.theme}: ${reason} — оставлен прежний public/${spec.filename}`);
    return;
  }
  const shared = join(root, 'public', 'imds-background.jpg');
  if (await exists(shared)) {
    await copyFile(shared, target);
    console.warn(`[imds-bg] ${spec.theme}: ${reason} — использован общий фон imds-background.jpg`);
    return;
  }
  console.warn(`[imds-bg] ${spec.theme}: ${reason} — фон не собран, тема останется без изображения`);
}

for (const spec of specs) {
  try {
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

    if (!isJpeg) throw new Error(`IMDS ${spec.theme} background is an incomplete JPEG`);
    if (output.length !== spec.expectedBytes) {
      throw new Error(
        `IMDS ${spec.theme} background size mismatch: ${output.length} != ${spec.expectedBytes}`,
      );
    }

    await writeFile(join(root, 'public', spec.filename), output);
  } catch (error) {
    await fallback(spec, error instanceof Error ? error.message : String(error));
  }
}
