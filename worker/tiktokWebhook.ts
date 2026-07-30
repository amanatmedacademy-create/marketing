export const TIKTOK_WEBHOOK_PATH = '/api/integrations/tiktok/webhook';

const responseHeaders = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
};

export async function handleTikTokWebhook(request: Request, url: URL): Promise<Response | null> {
  if (url.pathname !== TIKTOK_WEBHOOK_PATH) return null;

  if (request.method === 'GET' || request.method === 'HEAD') {
    return new Response(request.method === 'HEAD' ? null : JSON.stringify({ ok: true }), {
      status: 200,
      headers: responseHeaders,
    });
  }

  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...responseHeaders, allow: 'GET, HEAD, POST' },
    });
  }

  const rawBody = await request.text();
  let payload: unknown = rawBody;

  if (rawBody) {
    try {
      payload = JSON.parse(rawBody);
    } catch {
      // Keep the original body so the endpoint still acknowledges TikTok test calls.
    }
  }

  console.log('TikTok webhook received', {
    signaturePresent: Boolean(request.headers.get('TikTok-Signature')),
    payload,
  });

  // TikTok requires an immediate HTTP 200 acknowledgement. Event processing can
  // be added asynchronously after the application credentials are finalized.
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: responseHeaders,
  });
}
