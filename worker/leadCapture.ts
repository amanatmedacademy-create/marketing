type Row = Record<string, unknown>;

export interface LeadCaptureEnv {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
}

const text = (value: unknown): string => typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim();
const record = (value: unknown): Row => value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {};
const json = (value: unknown, status = 200, extra: HeadersInit = {}) => new Response(JSON.stringify(value), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'content-type',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    ...extra,
  },
});

function headers(env: LeadCaptureEnv, extra: HeadersInit = {}): Headers {
  const result = new Headers(extra);
  result.set('apikey', env.SUPABASE_SERVICE_ROLE_KEY);
  result.set('authorization', `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`);
  result.set('accept', 'application/json');
  if (!result.has('content-type')) result.set('content-type', 'application/json');
  return result;
}

async function db<T>(env: LeadCaptureEnv, path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/${path}`, {
    ...init,
    headers: headers(env, init.headers),
    cache: 'no-store',
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`Lead capture DB ${response.status}: ${body.slice(0, 1200)}`);
  return (body ? JSON.parse(body) : null) as T;
}

function normalizePhone(value: string): string {
  let digits = value.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('8')) digits = `7${digits.slice(1)}`;
  return digits;
}

function tracking(input: Row, form: Row): Row {
  const explicit = record(input.tracking);
  return {
    utm_source: text(explicit.utm_source) || text(input.utm_source),
    utm_medium: text(explicit.utm_medium) || text(input.utm_medium),
    utm_campaign: text(explicit.utm_campaign) || text(input.utm_campaign) || text(form.campaign),
    utm_content: text(explicit.utm_content) || text(input.utm_content),
    utm_term: text(explicit.utm_term) || text(input.utm_term),
    fbclid: text(explicit.fbclid) || text(input.fbclid),
    ttclid: text(explicit.ttclid) || text(input.ttclid),
  };
}

export async function handleLeadCaptureRequest(request: Request, env: LeadCaptureEnv, url: URL): Promise<Response | null> {
  const match = url.pathname.match(/^\/api\/webhooks\/lead-forms\/([^/]+)$/);
  if (!match) return null;
  if (request.method === 'OPTIONS') return json({ ok: true }, 204);

  const token = decodeURIComponent(match[1]);
  const forms = await db<Row[]>(env, `marketing_lead_forms?public_token=eq.${encodeURIComponent(token)}&status=eq.active&select=id,company_id,name,source,campaign,success_message,fields&limit=1`);
  const form = forms[0];
  if (!form) return json({ error: 'Форма не найдена или отключена' }, 404);

  if (request.method === 'GET') {
    return json({
      id: text(form.id),
      name: text(form.name),
      fields: Array.isArray(form.fields) ? form.fields : [],
      successMessage: text(form.success_message),
    });
  }

  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const input = record(await request.json().catch(() => ({})));
  const name = text(input.name);
  const phone = normalizePhone(text(input.phone));
  const email = text(input.email);
  if (!name || !phone) return json({ error: 'Имя и телефон обязательны' }, 400);

  const track = tracking(input, form);
  const source = text(form.source) || text(track.utm_source) || 'Web form';
  const campaign = text(form.campaign) || text(track.utm_campaign);
  const now = new Date().toISOString();
  const metadata = {
    lead_capture: {
      form_id: text(form.id),
      form_name: text(form.name),
      page_url: text(input.page_url),
      referrer: text(input.referrer),
    },
    submitted_fields: input,
  };

  const payload: Row = {
    company_id: text(form.company_id),
    name,
    phone,
    email: email || null,
    source,
    campaign: campaign || null,
    stage: 'Новый',
    first_message: text(input.message) || 'Заявка с формы сайта',
    metadata,
    created_at: now,
    updated_at: now,
    ...track,
  };

  const rows = await db<Row[]>(env, 'marketing_leads?select=id,name,phone,created_at', {
    method: 'POST',
    headers: { prefer: 'return=representation' },
    body: JSON.stringify(payload),
  });
  const lead = rows[0] || {};
  return json({
    ok: true,
    leadId: text(lead.id),
    successMessage: text(form.success_message) || 'Спасибо! Мы свяжемся с вами.',
  }, 201);
}
