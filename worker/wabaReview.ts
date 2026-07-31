type JsonRecord = Record<string, unknown>;

export interface WabaReviewEnv {
  META_WABA_GRAPH_VERSION?: string;
  META_WABA_ACCESS_TOKEN?: string;
  META_WABA_ID?: string;
  META_WABA_PHONE_NUMBER_ID?: string;
}

const text = (value: unknown) => typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim();
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});
const version = (env: WabaReviewEnv) => {
  const value = text(env.META_WABA_GRAPH_VERSION) || 'v23.0';
  return value.startsWith('v') ? value : `v${value}`;
};

async function graph(env: WabaReviewEnv, path: string, init?: RequestInit): Promise<JsonRecord> {
  const token = text(env.META_WABA_ACCESS_TOKEN);
  if (!token) throw new Error('META_WABA_ACCESS_TOKEN не настроен');
  const response = await fetch(`https://graph.facebook.com/${version(env)}/${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      ...init?.headers,
    },
  });
  const body = await response.text();
  let parsed: JsonRecord = {};
  try { parsed = body ? JSON.parse(body) as JsonRecord : {}; } catch { parsed = { error: body }; }
  if (!response.ok) {
    const error = parsed.error as JsonRecord | undefined;
    throw new Error(text(error?.message) || text(parsed.error) || `Meta Graph API: ${response.status}`);
  }
  return parsed;
}

export async function handleWabaReviewRequest(request: Request, env: WabaReviewEnv, url: URL): Promise<Response | null> {
  if (url.pathname === '/api/integrations/waba/review/overview' && request.method === 'GET') {
    try {
      const wabaId = text(env.META_WABA_ID);
      const phoneNumberId = text(env.META_WABA_PHONE_NUMBER_ID);
      const configured = Boolean(text(env.META_WABA_ACCESS_TOKEN) && wabaId && phoneNumberId);
      if (!configured) return json({ configured: false, error: 'Нужны META_WABA_ACCESS_TOKEN, META_WABA_ID и META_WABA_PHONE_NUMBER_ID' }, 503);

      const [phones, templates] = await Promise.all([
        graph(env, `${wabaId}/phone_numbers?fields=id,display_phone_number,verified_name,quality_rating,code_verification_status,status`),
        graph(env, `${wabaId}/message_templates?fields=id,name,language,status,category&limit=100`),
      ]);
      return json({ configured: true, wabaId, phoneNumberId, phones: phones.data || [], templates: templates.data || [] });
    } catch (error) {
      return json({ configured: false, error: error instanceof Error ? error.message : String(error) }, 400);
    }
  }

  if (url.pathname === '/api/integrations/waba/review/send' && request.method === 'POST') {
    try {
      const phoneNumberId = text(env.META_WABA_PHONE_NUMBER_ID);
      if (!phoneNumberId) return json({ error: 'META_WABA_PHONE_NUMBER_ID не настроен' }, 503);
      const payload = await request.json() as JsonRecord;
      const to = text(payload.to).replace(/\D/g, '');
      const message = text(payload.message);
      if (!to || !message) return json({ error: 'Укажите номер получателя и текст сообщения' }, 400);
      const result = await graph(env, `${phoneNumberId}/messages`, {
        method: 'POST',
        body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', to, type: 'text', text: { preview_url: false, body: message } }),
      });
      return json({ ok: true, result });
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  }

  return null;
}
