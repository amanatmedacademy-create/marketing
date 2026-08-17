import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import worker from '../worker/securedMain';
import type { AssetFetcher, WorkerExecutionContext } from '../worker/integrations';

type RuntimeEnv = Record<string, string | undefined> & { ASSETS: AssetFetcher };

const root = process.cwd();
const distDir = path.resolve(root, process.env.IMDS_DIST_DIR || 'dist');
const host = process.env.IMDS_HOST || '127.0.0.1';
const port = Number(process.env.PORT || 8787);
const appOrigin = (process.env.APP_ORIGIN || '').replace(/\/$/, '');

const contentTypes: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
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
      return new Response(body, {
        status: 200,
        headers: {
          'content-type': contentTypes[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
          'cache-control': filePath.endsWith('index.html') ? 'no-cache' : 'public, max-age=31536000, immutable',
        },
      });
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

const env: RuntimeEnv = { ...process.env, ASSETS };

function executionContext(): WorkerExecutionContext {
  return {
    waitUntil(task: Promise<unknown>) {
      void task.catch((error) => console.error('[waitUntil]', error));
    },
  };
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
  return new Request(requestUrl(req), {
    method: req.method || 'GET',
    headers,
    body,
  });
}

async function sendResponse(res: ServerResponse, response: Response): Promise<void> {
  res.statusCode = response.status;
  response.headers.forEach((value, name) => res.setHeader(name, value));
  if (!response.body) {
    res.end();
    return;
  }
  const body = Buffer.from(await response.arrayBuffer());
  res.end(body);
}

const server = createServer(async (req, res) => {
  const startedAt = Date.now();
  try {
    const request = await toRequest(req);
    const response = await worker.fetch(request, env as never, executionContext());
    await sendResponse(res, response);
    console.log(JSON.stringify({ method: req.method, path: req.url, status: response.status, durationMs: Date.now() - startedAt }));
  } catch (error) {
    console.error('[http]', error);
    res.statusCode = 500;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ error: 'VPS runtime error' }));
  }
});

server.listen(port, host, () => {
  console.log(`IMDS Marketing VPS runtime listening on http://${host}:${port}`);
});

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
