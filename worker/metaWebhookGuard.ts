type MetaWebhookGuardEnv = {
  META_APP_SECRET?: string;
};

const json = (value: unknown, status: number) => new Response(JSON.stringify(value), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});

function secureEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let result = 0;
  for (let index = 0; index < left.length; index += 1) result |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return result === 0;
}

async function hmacSha256(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function guardMetaSignedWebhook(
  request: Request,
  env: MetaWebhookGuardEnv,
  pathname: string,
): Promise<Response | null> {
  if (request.method !== 'POST' || !['/api/webhooks/meta', '/api/webhooks/waba'].includes(pathname)) return null;

  const secret = (env.META_APP_SECRET || '').trim();
  if (!secret) {
    console.error('Meta webhook rejected because META_APP_SECRET is unavailable');
    return json({ error: 'Meta webhook signing secret is not configured' }, 503);
  }

  const supplied = request.headers.get('x-hub-signature-256') || '';
  if (!supplied.startsWith('sha256=')) return json({ error: 'Invalid Meta signature' }, 401);

  const body = await request.clone().text();
  const expected = `sha256=${await hmacSha256(secret, body)}`;
  if (!secureEqual(supplied, expected)) return json({ error: 'Invalid Meta signature' }, 401);
  return null;
}
