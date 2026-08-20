import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const nginxConfig = await readFile(
  new URL('../deploy/vps/nginx-imds-marketing.conf', import.meta.url),
  'utf8',
);
const installRelease = await readFile(
  new URL('../deploy/vps/install-release.sh', import.meta.url),
  'utf8',
);

assert.match(
  nginxConfig,
  /server_name\s+imds\.duckdns\.org;/,
  'repository nginx config must preserve imds.duckdns.org instead of resetting to server_name _',
);

assert.match(
  installRelease,
  /imds\.duckdns\.org/,
  'release installer must explicitly preserve or restore the verified DuckDNS hostname during deploy',
);

console.log('VPS DuckDNS deployment persistence regression passed');
