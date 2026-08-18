import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import worker from '../worker/securedMain';
import { authenticateRequest } from '../worker/auth';
import { resolveCompanyId } from '../worker/companyContext';
import type { AssetFetcher, WorkerExecutionContext } from '../worker/integrations';
import { enforcePlatformEntitlement, handlePlatformInternalRequest, localTrialForTenant, platformEntitlementForTenant, platformQuotaSnapshotForTenant } from './platformControl';
import { handleBillingGatewayRequest } from './billingGateway';
import { enforceGoogleMfaRedirect, handleAccountSecurityGatewayRequest } from './accountSecurityGateway';
import { enforceBranchQuota } from './branchQuotaGateway';

type RuntimeEnv = Record<string, string | undefined> & { ASSETS: AssetFetcher };

const root = process.cwd();
const distDir = path.resolve(root, process.env.IMDS_DIST_DIR || 'dist');
const host = process.env.IMDS_HOST || '127.0.0.1';
const port = Number(process.env.PORT || 8787);
const appOrigin = (process.env.APP_ORIGIN || '').replace(/\/$/, '');

const contentTypes: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2',
};

function safeAssetPath(url: URL): string {
  const decoded = decodeURIComponent(url.pathname);
  const relative = decoded.replace(/^\/+/, '');
  const resolved = path.resolve(distDir, relative || 'index.html');
  if (!resolved.startsWith(distDir + path.sep) && resolved !== distDir) return path.join(distDir, 'index.html');
  return resolved;
}

const assets: AssetFetcher = {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    let filePath = safeAssetPath(url);
    try {
      const info = await stat(filePath);
      if (info.isDirectory()) filePath = path.join(filePath, 'index.html');
      const body = await readFile(filePath);
      return new Response(body, { status: 200, headers: { 'content-type': contentTypes[path.extname(filePath).toLowerCase()] || 'application/octet-stream', 'cache-control': filePath.endsWith('index.html') ? 'no-cache' : 'public, max-age=31536000, immutable' } });
    } catch {
      try {
        const index = path.join(distDir, 'index.html');
        const body = await readFile(index);
        return new Response(body, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' } });
      } catch {
        return new Response('IMDS Marketing frontend is not built', { status: 503 });
      }
    }
  },
};

const runtimeValues: Record<string, string | undefined> = { ...process.env };
const localDbUrl = (runtimeValues.IMDS_LOCAL_DB_URL || '').trim().replace(/\/$/, '');
const localServiceKey = (runtimeValues.IMDS_LOCAL_SERVICE_ROLE_KEY || '').trim();
delete runtimeValues.FRONTEND_ADMIN_KEY;
if (localDbUrl && localServiceKey) {
  runtimeValues.SUPABASE_URL = localDbUrl;
  runtimeValues.SUPABASE_SERVICE_ROLE_KEY = localServiceKey;
}
const env: RuntimeEnv = { ...runtimeValues, ASSETS: assets };

function executionContext(): WorkerExecutionContext {
  return { waitUntil(task: Promise<unknown>) { void task.catch((error) => console.error('[waitUntil]', error)); } };
}
async function readBody(req: IncomingMessage): Promise<Uint8Array | undefined> {
  if (req.method === 'GET' || req.method === 'HEAD') return undefined;
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  if (!chunks.length) return undefined;
  return new Uint8Array(Buffer.concat(chunks));
}
function requestUrl(req: IncomingMessage): string {
  const hostHeader = req.headers.host || `${host}:${port}`;
  const origin = appOrigin || `http://${hostHeader}`;
  return new URL(req.url || '/', `${origin}/`).toString();
}
async function toRequest(req: IncomingMessage): Promise<Request> {
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) value.forEach((item) => headers.append(name, item));
    else if (value != null) headers.set(name, value);
  }
  const body = await readBody(req);
  return new Request(requestUrl(req), { method: req.method || 'GET', headers, body });
}
async function sendResponse(res: ServerResponse, response: Response): Promise<void> {
  res.statusCode = response.status;
  response.headers.forEach((value, name) => res.setHeader(name, value));
  if (!response.body) { res.end(); return; }
  res.end(Buffer.from(await response.arrayBuffer()));
}

async function browserEntitlementResponse(request: Request): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== '/api/platform/entitlements' || request.method !== 'GET') return null;
  const user = await authenticateRequest(request, env as never);
  if (!user) return new Response(JSON.stringify({ error: 'AUTH_REQUIRED' }), { status: 401, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
  if (user.status !== 'active') return new Response(JSON.stringify({ error: 'USER_INACTIVE' }), { status: 403, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
  const requestedCompany = (request.headers.get('x-imds-company-id') || '').trim();
  const tenantId = await resolveCompanyId(requestedCompany ? { ...env, CURRENT_COMPANY_ID: requestedCompany } as never : env as never, user.id);
  const entitlement = await platformEntitlementForTenant(tenantId);
  const localBilling = entitlement ? null : await localTrialForTenant(tenantId, env);
  const quota = entitlement ? await platformQuotaSnapshotForTenant(entitlement, env).catch(() => null) : null;
  const payload = entitlement ? {
    managed: true, tenantId, organizationId: entitlement.organizationId, revision: entitlement.revision,
    productEnabled: entitlement.productEnabled, modules: entitlement.modules, limits: entitlement.limits || {}, quota,
    billing: entitlement.billing || null, updatedAt: entitlement.updatedAt,
  } : {
    managed: false, tenantId, organizationId: null, revision: null,
    productEnabled: localBilling?.subscriptionStatus !== 'expired' && localBilling?.subscriptionStatus !== 'suspended',
    modules: {}, limits: {}, quota: null, billing: localBilling, updatedAt: null,
  };
  return new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
}

const server = createServer(async (req, res) => {
  const startedAt = Date.now();
  try {
    const request = await toRequest(req);
    const securityResponse = await handleAccountSecurityGatewayRequest(request, env);
    if (securityResponse) { await sendResponse(res, securityResponse); console.log(JSON.stringify({ method: req.method, path: req.url, status: securityResponse.status, durationMs: Date.now() - startedAt, accountSecurity: true })); return; }
    const platformResponse = await handlePlatformInternalRequest(request, env);
    if (platformResponse) { await sendResponse(res, platformResponse); console.log(JSON.stringify({ method: req.method, path: req.url, status: platformResponse.status, durationMs: Date.now() - startedAt, platform: true })); return; }
    const billingResponse = await handleBillingGatewayRequest(request, env);
    if (billingResponse) { await sendResponse(res, billingResponse); console.log(JSON.stringify({ method: req.method, path: req.url, status: billingResponse.status, durationMs: Date.now() - startedAt, billing: true })); return; }
    const browserEntitlement = await browserEntitlementResponse(request);
    if (browserEntitlement) { await sendResponse(res, browserEntitlement); console.log(JSON.stringify({ method: req.method, path: req.url, status: browserEntitlement.status, durationMs: Date.now() - startedAt, entitlement: 'browser-state' })); return; }
    const branchQuotaDenied = await enforceBranchQuota(request, env);
    if (branchQuotaDenied) { await sendResponse(res, branchQuotaDenied); console.log(JSON.stringify({ method: req.method, path: req.url, status: branchQuotaDenied.status, durationMs: Date.now() - startedAt, branchQuota: 'denied' })); return; }
    const entitlementDenied = await enforcePlatformEntitlement(request, env);
    if (entitlementDenied) { await sendResponse(res, entitlementDenied); console.log(JSON.stringify({ method: req.method, path: req.url, status: entitlementDenied.status, durationMs: Date.now() - startedAt, entitlement: 'denied' })); return; }
    let response = await worker.fetch(request, env as never, executionContext());
    response = await enforceGoogleMfaRedirect(request, response, env);
    await sendResponse(res, response);
    console.log(JSON.stringify({ method: req.method, path: req.url, status: response.status, durationMs: Date.now() - startedAt }));
  } catch (error) {
    console.error('[http]', error);
    res.statusCode = 500;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ error: 'VPS runtime error' }));
  }
});

server.listen(port, host, () => console.log(`IMDS Marketing VPS runtime listening on http://${host}:${port}`));
for (const signal of ['SIGTERM', 'SIGINT'] as const) process.on(signal, () => server.close(() => process.exit(0)));
