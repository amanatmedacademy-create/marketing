const baseHeaders = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store'
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: baseHeaders });
}

export function notFound(): Response {
  return json({ error: { code: 'NOT_FOUND', message: 'Route not found' } }, 404);
}

export function withSecurityHeaders(response: Response): Response {
  const secured = new Response(response.body, response);
  secured.headers.set('x-content-type-options', 'nosniff');
  secured.headers.set('x-frame-options', 'DENY');
  secured.headers.set('referrer-policy', 'strict-origin-when-cross-origin');
  secured.headers.set('permissions-policy', 'camera=(), microphone=(), geolocation=()');
  return secured;
}
