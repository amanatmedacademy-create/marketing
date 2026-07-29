type ChatProxyEnv = {
  IMDS_MIS_API_URL?: string;
  IMDS_INTERNAL_SERVICE_TOKEN?: string;
};

const DEFAULT_MIS_API_URL = 'https://misv0001-b.amanat-med-academy.workers.dev/api';

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

function targetPath(pathname: string): string | null {
  if (pathname === '/api/conversations') return '/inbox/workspace';

  const messages = pathname.match(/^\/api\/conversations\/([^/]+)\/messages$/);
  if (messages) return `/inbox/threads/${encodeURIComponent(decodeURIComponent(messages[1]))}/messages`;

  const thread = pathname.match(/^\/api\/conversations\/([^/]+)$/);
  if (thread) return `/inbox/threads/${encodeURIComponent(decodeURIComponent(thread[1]))}`;

  return null;
}

export async function handleChatProxy(request: Request, env: ChatProxyEnv, url: URL): Promise<Response | null> {
  const mappedPath = targetPath(url.pathname);
  if (!mappedPath) return null;

  const serviceToken = env.IMDS_INTERNAL_SERVICE_TOKEN?.trim();
  if (!serviceToken) {
    return json({
      error: 'Не настроен внутренний доступ к IMDS Chat',
      code: 'IMDS_SERVICE_AUTH_NOT_CONFIGURED',
    }, 503);
  }

  const base = (env.IMDS_MIS_API_URL || DEFAULT_MIS_API_URL).replace(/\/+$/, '');
  const target = new URL(`${base}${mappedPath}`);
  target.search = url.search;

  const headers = new Headers({
    accept: 'application/json',
    'x-imds-service-token': serviceToken,
    'x-imds-service-name': 'amanat-marketing',
  });

  let body: BodyInit | undefined;
  if (!['GET', 'HEAD'].includes(request.method)) {
    const raw = await request.text();
    if (raw) {
      headers.set('content-type', 'application/json');
      if (request.method === 'POST' && mappedPath.endsWith('/messages')) {
        const parsed = JSON.parse(raw) as { body?: string };
        body = JSON.stringify({
          body: parsed.body || '',
          direction: 'OUTBOUND',
          senderName: 'Marketing',
        });
      } else {
        body = raw;
      }
    }
  }

  try {
    const response = await fetch(target.toString(), {
      method: request.method,
      headers,
      body,
      redirect: 'follow',
    });

    const responseBody = await response.text();
    return new Response(responseBody || null, {
      status: response.status,
      headers: {
        'content-type': response.headers.get('content-type') || 'application/json; charset=utf-8',
        'cache-control': 'no-store',
        'x-imds-chat-proxy': '1',
      },
    });
  } catch (error) {
    return json({
      error: error instanceof Error ? error.message : 'Не удалось подключиться к IMDS Chat API',
    }, 502);
  }
}
