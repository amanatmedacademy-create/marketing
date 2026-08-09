import { CLINIC_FLOW_SCHEMA_VERSION } from './wabaClinicFlow';

type Row = Record<string, unknown>;

type Credential = {
  rowId: string;
  companyId: string;
  accessToken: string;
  wabaId: string;
  phoneNumberId: string;
  graphVersion: string;
  configSummary: Row;
};

type MetaTemplate = {
  id?: string;
  name: string;
  language: string;
  category: string;
  status: string;
};

export interface WabaClinicFlowOutreachEnv {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  DEFAULT_COMPANY_ID?: string;
  CURRENT_COMPANY_ID?: string;
  INTEGRATION_ENCRYPTION_KEY?: string;
  META_GRAPH_VERSION?: string;
}

const TEMPLATE_NAME = `imds_clinic_booking_v${CLINIC_FLOW_SCHEMA_VERSION}`;
const TEMPLATE_LANGUAGE = 'ru';
const TEMPLATE_CATEGORY = 'MARKETING';
const TEMPLATE_BODY = 'Здравствуйте! Чтобы подобрать удобное время для записи, заполните короткую форму.';
const TEMPLATE_BUTTON = 'Записаться';

const text = (value: unknown): string => typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim();
const record = (value: unknown): Row => value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {};
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});

function graphVersion(value?: string): string {
  const version = text(value) || 'v23.0';
  return version.startsWith('v') ? version : `v${version}`;
}

function secret(env: WabaClinicFlowOutreachEnv): string {
  return text(env.INTEGRATION_ENCRYPTION_KEY) || `imds-integrations:v1:${env.SUPABASE_SERVICE_ROLE_KEY}`;
}

function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const buffer = new ArrayBuffer(binary.length);
  const bytes = new Uint8Array(buffer);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function dbHeaders(env: WabaClinicFlowOutreachEnv, extra: HeadersInit = {}): Headers {
  const headers = new Headers(extra);
  headers.set('apikey', env.SUPABASE_SERVICE_ROLE_KEY);
  headers.set('authorization', `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`);
  headers.set('accept', 'application/json');
  return headers;
}

async function db<T>(env: WabaClinicFlowOutreachEnv, path: string, init: RequestInit = {}): Promise<T> {
  const headers = dbHeaders(env, init.headers);
  if (init.body != null) headers.set('content-type', 'application/json');
  if (init.method && !['GET', 'HEAD'].includes(init.method) && !headers.has('prefer')) headers.set('prefer', 'return=representation');
  const response = await fetch(`${env.SUPABASE_URL.replace(/\/+$/, '')}/rest/v1/${path}`, { ...init, headers, cache: 'no-store' });
  const raw = await response.text();
  if (!response.ok) throw new Error(`Supabase ${response.status}: ${raw.slice(0, 1800)}`);
  return (raw ? JSON.parse(raw) : null) as T;
}

async function decryptCredential(env: WabaClinicFlowOutreachEnv, row: Row): Promise<Credential | null> {
  const encrypted = text(row.encrypted_payload);
  const iv = text(row.iv);
  if (!encrypted || !iv) return null;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret(env)));
  const key = await crypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, ['decrypt']);
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: base64ToBytes(iv) }, key, base64ToBytes(encrypted));
  const payload = record(JSON.parse(new TextDecoder().decode(decrypted)));
  const accessToken = text(payload.accessToken);
  const wabaId = text(payload.wabaId);
  const phoneNumberId = text(payload.phoneNumberId);
  if (!accessToken || !wabaId || !phoneNumberId) return null;
  return {
    rowId: text(row.id),
    companyId: text(row.company_id),
    accessToken,
    wabaId,
    phoneNumberId,
    graphVersion: graphVersion(text(payload.graphVersion) || env.META_GRAPH_VERSION),
    configSummary: record(row.config_summary),
  };
}

async function findCredential(env: WabaClinicFlowOutreachEnv, companyId: string): Promise<Credential> {
  const rows = await db<Row[]>(env,
    `integration_credentials?provider=eq.waba&status=eq.connected&company_id=eq.${encodeURIComponent(companyId)}&select=id,company_id,encrypted_payload,iv,config_summary&order=updated_at.desc&limit=20`,
  );
  for (const row of rows) {
    try {
      const value = await decryptCredential(env, row);
      if (value) return value;
    } catch (error) {
      console.error('Unable to decrypt WABA credential for Flow outreach', error);
    }
  }
  throw new Error('Подключённая WABA не найдена');
}

async function graphJson(url: string, accessToken: string, init: RequestInit = {}): Promise<Row> {
  const headers = new Headers(init.headers);
  headers.set('authorization', `Bearer ${accessToken}`);
  headers.set('accept', 'application/json');
  if (init.body != null) headers.set('content-type', 'application/json');
  const response = await fetch(url, { ...init, headers });
  const raw = await response.text();
  let payload: Row = {};
  try { payload = record(raw ? JSON.parse(raw) : {}); } catch { payload = { raw }; }
  if (!response.ok || payload.error) throw new Error(`Meta Graph ${response.status}: ${JSON.stringify(payload).slice(0, 1800)}`);
  return payload;
}

function clinicFlow(current: Credential): { flowId: string; status: string; schemaVersion: number } {
  const clinic = record(record(current.configSummary.flows).clinic);
  return { flowId: text(clinic.flowId), status: text(clinic.status).toUpperCase(), schemaVersion: Number(clinic.schemaVersion || 0) };
}

async function getTemplate(current: Credential): Promise<MetaTemplate | null> {
  const fields = encodeURIComponent('id,name,status,category,language,components');
  const payload = await graphJson(
    `https://graph.facebook.com/${current.graphVersion}/${encodeURIComponent(current.wabaId)}/message_templates?fields=${fields}&limit=250`,
    current.accessToken,
  );
  const rows = Array.isArray(payload.data) ? payload.data.map(record) : [];
  const row = rows.find((item) => text(item.name) === TEMPLATE_NAME && text(item.language) === TEMPLATE_LANGUAGE);
  if (!row) return null;
  return {
    id: text(row.id) || undefined,
    name: text(row.name),
    language: text(row.language),
    category: text(row.category),
    status: text(row.status).toUpperCase(),
  };
}

async function saveTemplateSummary(env: WabaClinicFlowOutreachEnv, current: Credential, template: MetaTemplate): Promise<void> {
  const summary = current.configSummary;
  const flows = record(summary.flows);
  const clinic = record(flows.clinic);
  const next = {
    ...summary,
    flows: {
      ...flows,
      clinic: {
        ...clinic,
        template: {
          id: template.id || null,
          name: template.name,
          language: template.language,
          category: template.category,
          status: template.status,
          schemaVersion: CLINIC_FLOW_SCHEMA_VERSION,
          updatedAt: new Date().toISOString(),
        },
      },
    },
  };
  await db<Row[]>(env, `integration_credentials?id=eq.${encodeURIComponent(current.rowId)}&select=id`, {
    method: 'PATCH',
    body: JSON.stringify({ config_summary: next, updated_at: new Date().toISOString() }),
  });
}

async function createTemplate(env: WabaClinicFlowOutreachEnv, current: Credential): Promise<MetaTemplate> {
  const flow = clinicFlow(current);
  if (!flow.flowId || flow.status !== 'PUBLISHED' || flow.schemaVersion !== CLINIC_FLOW_SCHEMA_VERSION) {
    throw new Error(`Сначала опубликуйте актуальный Flow v${CLINIC_FLOW_SCHEMA_VERSION} «Запись в клинику»`);
  }

  const existing = await getTemplate(current);
  if (existing) {
    await saveTemplateSummary(env, current, existing);
    return existing;
  }

  const payload = await graphJson(
    `https://graph.facebook.com/${current.graphVersion}/${encodeURIComponent(current.wabaId)}/message_templates`,
    current.accessToken,
    {
      method: 'POST',
      body: JSON.stringify({
        name: TEMPLATE_NAME,
        language: TEMPLATE_LANGUAGE,
        category: TEMPLATE_CATEGORY,
        components: [
          { type: 'BODY', text: TEMPLATE_BODY },
          {
            type: 'BUTTONS',
            buttons: [{
              type: 'FLOW',
              text: TEMPLATE_BUTTON,
              flow_id: flow.flowId,
              navigate_screen: 'APPOINTMENT',
              flow_action: 'navigate',
            }],
          },
        ],
      }),
    },
  );
  const created: MetaTemplate = {
    id: text(payload.id) || undefined,
    name: TEMPLATE_NAME,
    language: TEMPLATE_LANGUAGE,
    category: text(payload.category) || TEMPLATE_CATEGORY,
    status: text(payload.status).toUpperCase() || 'PENDING',
  };
  await saveTemplateSummary(env, current, created);
  return created;
}

function normalizePhone(value: string): string {
  let digits = value.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('8')) digits = `7${digits.slice(1)}`;
  return digits;
}

async function sendClinicFlowTemplate(env: WabaClinicFlowOutreachEnv, request: Request, threadId: string, input: Row): Promise<Response> {
  const rows = await db<Row[]>(env,
    `marketing_conversations?id=eq.${encodeURIComponent(threadId)}&archived_at=is.null&select=id,phone,channel,company_id&limit=1`,
  );
  const thread = rows[0];
  if (!thread || text(thread.channel).toUpperCase() !== 'WHATSAPP') return json({ error: 'WhatsApp-диалог не найден' }, 404);
  const phone = normalizePhone(text(thread.phone));
  if (!phone) return json({ error: 'В диалоге не указан WhatsApp-номер клиента' }, 400);
  const companyId = text(thread.company_id);
  if (!companyId) return json({ error: 'У диалога не определена клиника' }, 400);

  const current = await findCredential(env, companyId);
  const flow = clinicFlow(current);
  if (!flow.flowId || flow.status !== 'PUBLISHED' || flow.schemaVersion !== CLINIC_FLOW_SCHEMA_VERSION) {
    return json({ error: `Flow «Запись в клинику» необходимо обновить до v${CLINIC_FLOW_SCHEMA_VERSION}` }, 409);
  }
  const template = await getTemplate(current);
  if (!template) return json({ error: `Шаблон ${TEMPLATE_NAME} ещё не создан. Создайте его в настройках WABA.`, code: 'FLOW_TEMPLATE_MISSING' }, 409);
  await saveTemplateSummary(env, current, template).catch(() => undefined);
  if (template.status !== 'APPROVED') {
    return json({
      error: `Шаблон «Запись в клинику» имеет статус ${template.status || 'PENDING'}. Дождитесь одобрения Meta.`,
      code: 'FLOW_TEMPLATE_NOT_APPROVED',
      templateStatus: template.status,
    }, 409);
  }

  const flowToken = `imds-clinic:${threadId}:${crypto.randomUUID()}`;
  const payload = {
    messaging_product: 'whatsapp',
    to: phone,
    type: 'template',
    template: {
      name: template.name,
      language: { code: template.language },
      components: [{
        type: 'button',
        sub_type: 'flow',
        index: '0',
        parameters: [{
          type: 'action',
          action: {
            flow_token: flowToken,
            flow_action_data: { thread_id: threadId },
          },
        }],
      }],
    },
  };
  const result = await graphJson(
    `https://graph.facebook.com/${current.graphVersion}/${encodeURIComponent(current.phoneNumberId)}/messages`,
    current.accessToken,
    { method: 'POST', body: JSON.stringify(payload) },
  );
  const externalMessageId = text(record(Array.isArray(result.messages) ? result.messages[0] : null).id);
  const sentAt = new Date().toISOString();
  const senderName = text(input.senderName) || 'Оператор';
  const messageRows = await db<Row[]>(env, 'marketing_messages?select=*', {
    method: 'POST',
    body: JSON.stringify({
      company_id: companyId,
      conversation_id: threadId,
      body: 'Запись в клинику · интерактивная форма WhatsApp',
      direction: 'OUTBOUND',
      sender_name: senderName,
      external_message_id: externalMessageId || null,
      status: 'SENT',
      sent_at: sentAt,
      read_at: null,
      metadata: {
        whatsapp: result,
        whatsapp_type: 'flow_template',
        whatsapp_template: { name: template.name, language: template.language, category: template.category },
        whatsapp_flow: { flow_id: flow.flowId, flow_token: flowToken, screen: 'APPOINTMENT', schema_version: CLINIC_FLOW_SCHEMA_VERSION },
      },
      created_at: sentAt,
    }),
  });
  await db<Row[]>(env, `marketing_conversations?id=eq.${encodeURIComponent(threadId)}&select=id`, {
    method: 'PATCH',
    body: JSON.stringify({ last_message_at: sentAt, updated_at: sentAt, status: 'OPEN' }),
  });
  const saved = messageRows[0] || {};
  return json({
    id: text(saved.id),
    threadId,
    direction: 'OUTBOUND',
    senderName,
    body: text(saved.body) || 'Запись в клинику · интерактивная форма WhatsApp',
    status: text(saved.status) || 'SENT',
    externalId: text(saved.external_message_id) || undefined,
    readAt: text(saved.read_at) || undefined,
    hasAttachment: false,
    sentAt: text(saved.sent_at) || sentAt,
  }, 201);
}

export async function handleWabaClinicFlowOutreachRequest(request: Request, env: WabaClinicFlowOutreachEnv, url: URL): Promise<Response | null> {
  if (url.pathname === '/api/integrations/waba/flows/clinic/template' && request.method === 'GET') {
    const role = text(request.headers.get('x-amanat-auth-role'));
    if (role !== 'administrator') return json({ error: 'Требуются права администратора' }, 403);
    try {
      const companyId = text(env.CURRENT_COMPANY_ID) || text(env.DEFAULT_COMPANY_ID);
      if (!companyId) throw new Error('Не определена клиника');
      const current = await findCredential(env, companyId);
      const template = await getTemplate(current);
      if (template) await saveTemplateSummary(env, current, template).catch(() => undefined);
      return json({
        configured: Boolean(template),
        name: TEMPLATE_NAME,
        language: TEMPLATE_LANGUAGE,
        category: template?.category || TEMPLATE_CATEGORY,
        status: template?.status || null,
        templateId: template?.id || null,
        schemaVersion: CLINIC_FLOW_SCHEMA_VERSION,
      });
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  }

  if (url.pathname === '/api/integrations/waba/flows/clinic/template' && request.method === 'POST') {
    const role = text(request.headers.get('x-amanat-auth-role'));
    if (role !== 'administrator') return json({ error: 'Требуются права администратора' }, 403);
    try {
      const companyId = text(env.CURRENT_COMPANY_ID) || text(env.DEFAULT_COMPANY_ID);
      if (!companyId) throw new Error('Не определена клиника');
      const current = await findCredential(env, companyId);
      const template = await createTemplate(env, current);
      return json({
        ok: true,
        configured: true,
        name: template.name,
        language: template.language,
        category: template.category,
        status: template.status,
        templateId: template.id || null,
        schemaVersion: CLINIC_FLOW_SCHEMA_VERSION,
      });
    } catch (error) {
      console.error('Clinic Flow template setup failed', error);
      return json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  }

  const messageMatch = url.pathname.match(/^\/api\/callcenter\/threads\/([^/]+)\/messages$/);
  if (messageMatch && request.method === 'POST') {
    const input = record(await request.clone().json().catch(() => ({})));
    const template = record(input.template);
    if (text(template.name) !== TEMPLATE_NAME) return null;
    return sendClinicFlowTemplate(env, request, decodeURIComponent(messageMatch[1]), input);
  }

  return null;
}
