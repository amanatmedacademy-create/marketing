import { spawnSync } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const META_OPENAPI_COMMIT = '40033862592a6201af195a7fc0853cd197cac653';
const META_OPENAPI_VERSION = 'v23.0';
const GENERATOR_VERSION = '7.13.0';
const SPEC_NAME = `business-messaging-api_${META_OPENAPI_VERSION}.yaml`;
const SPEC_URL = `https://raw.githubusercontent.com/facebook/openapi/${META_OPENAPI_COMMIT}/${SPEC_NAME}`;
const OUTPUT_PATH = path.resolve('src/types/generated/meta-business-messaging-v23.ts');
const checkOnly = process.argv.includes('--check');

function fail(message) {
  console.error(`[meta-openapi] ${message}`);
  process.exit(1);
}

async function downloadSpec() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(SPEC_URL, {
      headers: { accept: 'application/yaml, text/yaml, text/plain' },
      signal: controller.signal,
    });
    if (!response.ok) fail(`Meta specification download failed: HTTP ${response.status}`);
    const content = await response.text();
    if (content.length < 50_000) fail('Downloaded Meta specification is unexpectedly small');
    if (!content.includes('WhatsApp') || !content.includes('openapi:')) {
      fail('Downloaded file does not look like the WhatsApp OpenAPI specification');
    }
    return content;
  } finally {
    clearTimeout(timeout);
  }
}

async function generateTypes(specContent) {
  const workDir = path.join(tmpdir(), `imds-meta-openapi-${process.pid}`);
  const specPath = path.join(workDir, SPEC_NAME);
  const generatedPath = path.join(workDir, 'generated.ts');
  await rm(workDir, { recursive: true, force: true });
  await mkdir(workDir, { recursive: true });
  await writeFile(specPath, specContent, 'utf8');

  const command = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const result = spawnSync(command, [
    '--yes',
    `openapi-typescript@${GENERATOR_VERSION}`,
    specPath,
    '-o',
    generatedPath,
  ], { stdio: 'inherit', encoding: 'utf8' });

  if (result.error) fail(`Unable to start OpenAPI generator: ${result.error.message}`);
  if (result.status !== 0) fail(`OpenAPI generator exited with code ${result.status}`);

  const generated = await readFile(generatedPath, 'utf8');
  await rm(workDir, { recursive: true, force: true });
  if (!generated.includes('export interface paths') || !generated.includes('export interface components')) {
    fail('Generated definitions do not contain expected OpenAPI interfaces');
  }

  const provenance = [
    '/**',
    ' * Generated from the official Meta WhatsApp Business Messaging OpenAPI specification.',
    ` * Source commit: ${META_OPENAPI_COMMIT}`,
    ` * API version: ${META_OPENAPI_VERSION}`,
    ` * Generator: openapi-typescript@${GENERATOR_VERSION}`,
    ' * Do not edit manually. Run: npm run meta:openapi:sync',
    ' */',
    '',
  ].join('\n');
  return provenance + generated;
}

const specContent = await downloadSpec();
const generated = await generateTypes(specContent);

if (checkOnly) {
  console.log(`[meta-openapi] verified ${META_OPENAPI_VERSION} at ${META_OPENAPI_COMMIT}`);
  console.log(`[meta-openapi] generated ${generated.length.toLocaleString('en-US')} characters`);
} else {
  await mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(OUTPUT_PATH, generated, 'utf8');
  console.log(`[meta-openapi] wrote ${path.relative(process.cwd(), OUTPUT_PATH)}`);
}
