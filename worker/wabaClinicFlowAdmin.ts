import { resolveCompanyId } from './companyContext';
import { CLINIC_FLOW_CATEGORY, CLINIC_FLOW_JSON, CLINIC_FLOW_NAME, CLINIC_FLOW_SCHEMA_VERSION, SERVICE_LABELS } from './wabaClinicFlow';
import { createClinicAppointment, handleClinicBookingAdminRequest, type WabaClinicBookingEnv } from './wabaClinicBooking';
import { handleClinicScreenResponse, normalizeClinicBookingData } from './wabaClinicScreenResponses';

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

export interface WabaClinicFlowEnv extends WabaClinicBookingEnv {
  DEFAULT_COMPANY_ID?: string;
  INTEGRATION_ENCRYPTION_KEY?: string;
  META_GRAPH_VERSION?: string;
}

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

function secret(env: WabaClinicFlowEnv): string {
  return text(env.INTEGRATION_ENCRYPTION_KEY) || `imds-integrations:v1:${env.SUPABASE_SERVICE_ROLE_KEY}`;
}

function supabaseHeaders(env: WabaClinicFlowEnv, extra: HeadersInit = {}): Headers {
  const headers = new Headers(extra);
  headers.set('apikey', env.SUPABASE_SERVICE_ROLE_KEY);
  headers.set('authorization', `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`);
  headers.set('accept', 'application/json');
  return headers;
}

async function db<T>(env: WabaClinicFlowEnv, path: string, init: RequestInit = {}): Promise<T> {
  const headers = supabaseHeaders(env, init.headers);
  if (init.body != null) headers.set('content-type', 'application/json');
  if (init.method && !['GET', 'HEAD'].includes(init.method) && !headers.has('prefer')) headers.set('prefer', 'return=representation');
  const response = await fetch(`${env.SUPABASE_URL.replace(/\/+$/, '')}/rest/v1/${path}`, { ...init, headers, cache: 'no-store' });
  const body = await response.text();
  if (!response.ok) throw new Error(`Supabase ${response.status}: ${body.slice(0, 1800)}`);
  return (body ? JSON.parse(body) : null) as T;
}

function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const buffer = new ArrayBuffer(binary.length);
  const bytes = new Uint8Array(buffer);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

async function decryptCredential(env: WabaClinicFlowEnv, row: Row): Promise<Credential | null> {
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

async function credential(env: WabaClinicFlowEnv, companyId: string): Promise<Credential> {
  const rows = await db<Row[]>(env,
    `integration_credentials?provider=eq.waba&status=eq.connected&company_id=eq.${encodeURIComponent(companyId)}&select=id,company_id,encrypted_payload,iv,config_summary&order=updated_at.desc&limit=20`,
  );
  for (const row of rows) {
    try {
      const value = await decryptCredential(env, row);
      if (value) return value;
    } catch (error) {
      console.error('Unable to decrypt WABA credential for clinic Flow', error);
    }
  }
  throw new Error('Подключённая WABA для клиники не найдена');
}

async function metaForm(url: string, accessToken: string, form?: FormData): Promise<Row> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' },
    body: form,
  });
  const raw = await response.text();
  let payload: Row = {};
  try { payload = record(raw ? JSON.parse(raw) : {}); } catch { payload = { raw }; }
  if (!response.ok || payload.error) throw new Error(`Meta Graph ${response.status}: ${JSON.stringify(payload).slice(0, 1800)}`);
  return payload;
}

async function createMetaFlow(request: Request, current: Credential): Promise<{ flowId: string; validationErrors: unknown[] }> {
  const endpointUri = `${new URL(request.url).origin}/api/webhooks/waba/flows`;
  const createForm = new FormData();
  createForm.set('name', `${CLINIC_FLOW_NAME} v${CLINIC_FLOW_SCHEMA_VERSION}`);
  createForm.set('categories', JSON.stringify(CLINIC_FLOW_CATEGORY));
  createForm.set('endpoint_uri', endpointUri);
  const createResult = await metaForm(
    `https://graph.facebook.com/${current.graphVersion}/${encodeURIComponent(current.wabaId)}/flows`,
    current.accessToken,
    createForm,
  );
  const flowId = text(createResult.id);
  if (!flowId) throw new Error('Meta не вернула Flow ID');

  const assetForm = new FormData();
  assetForm.set('file', new Blob([JSON.stringify(CLINIC_FLOW_JSON)], { type: 'application/json' }), 'flow.json');
  assetForm.set('name', 'flow.json');
  assetForm.set('asset_type', 'FLOW_JSON');
  const assetResult = await metaForm(
    `https://graph.facebook.com/${current.graphVersion}/${encodeURIComponent(flowId)}/assets`,
    current.accessToken,
    assetForm,
  );
  const validationErrors = Array.isArray(assetResult.validation_errors) ? assetResult.validation_errors : [];
  if (validationErrors.length) return { flowId, validationErrors };
  await metaForm(`https://graph.facebook.com/${current.graphVersion}/${encodeURIComponent(flowId)}/publish`, current.accessToken);
  return { flowId, validationErrors: [] };
}

async function saveFlowMeta(env: WabaClinicFlowEnv, current: Credential, flowId: string, endpointUrl: string): Promise<void> {
  const summary = current.configSummary;
  const flows = record(summary.flows);
  const previousClinic = record(flows.clinic);
  const next = {
    ...summary,
    flows: {
      ...flows,
      clinic: {
        ...previousClinic,
        flowId,
        name: CLINIC_FLOW_NAME,
        categories: CLINIC_FLOW_CATEGORY,
        endpointUrl,
        status: 'PUBLISHED',
        schemaVersion: CLINIC_FLOW_SCHEMA_VERSION,
        updatedAt: new Date().toISOString(),
      },
    },
  };
  await db<Row[]>(env, `integration_credentials?id=eq.${encodeURIComponent(current.rowId)}&select=id`, {
    method: 'PATCH',
    body: JSON.stringify({ config_summary: next, updated_at: new Date().toISOString() }),
  });
}

export async function handleWabaClinicFlowAdminRequest(request: Request, env: WabaClinicFlowEnv, url: URL): Promise<Response | null> {
  if (!url.pathname.startsWith('/api/integrations/waba/flows/clinic/')) return null;
  if (text(request.headers.get('x-amanat-auth-role')) !== 'administrator') return json({ error: 'Требуются права администратора' }, 403);
  const companyId = await resolveCompanyId(env);
  const bookingAdmin = await handleClinicBookingAdminRequest(request, env, url, companyId);
  if (bookingAdmin) return bookingAdmin;
  const current = await credential(env, companyId);
  const clinic = record(record(current.configSummary.flows).clinic);

  if (url.pathname === '/api/integrations/waba/flows/clinic/config' && request.method === 'GET') {
    return json({
      configured: Boolean(text(clinic.flowId)),
      flowId: text(clinic.flowId) || null,
      name: text(clinic.name) || CLINIC_FLOW_NAME,
      status: text(clinic.status) || null,
      schemaVersion: Number(clinic.schemaVersion || 1),
      requiredSchemaVersion: CLINIC_FLOW_SCHEMA_VERSION,
      endpointUrl: text(clinic.endpointUrl) || `${url.origin}/api/webhooks/waba/flows`,
      updatedAt: text(clinic.updatedAt) || null,
    });
  }

  if (url.pathname === '/api/integrations/waba/flows/clinic/create' && request.method === 'POST') {
    try {
      const result = await createMetaFlow(request, current);
      if (result.validationErrors.length) {
        return json({ ok: false, flowId: result.flowId, status: 'DRAFT', validationErrors: result.validationErrors, error: 'Meta отклонила Flow JSON. Исправьте validation_errors перед публикацией.' }, 422);
      }
      const endpointUrl = `${url.origin}/api/webhooks/waba/flows`;
      await saveFlowMeta(env, current, result.flowId, endpointUrl);
      return json({ ok: true, flowId: result.flowId, status: 'PUBLISHED', schemaVersion: CLINIC_FLOW_SCHEMA_VERSION, endpointUrl, validationErrors: [] });
    } catch (error) {
      console.error('Clinic WhatsApp Flow create failed', error);
      return json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  }
  return null;
}

function threadIdFromFlowToken(flowToken: string): string {
  if (!flowToken.startsWith('imds-clinic:')) return '';
  const withoutPrefix = flowToken.slice('imds-clinic:'.length);
  const separator = withoutPrefix.indexOf(':');
  return separator > 0 ? withoutPrefix.slice(0, separator) : '';
}

async function attachFlowSubmissionToThread(env: WabaClinicFlowEnv, companyId: string, threadId: string, leadId: string, name: string, flowToken: string, firstMessage: string, metadata: Row): Promise<void> {
  if (!threadId) return;
  const threads = await db<Row[]>(env, `marketing_conversations?id=eq.${encodeURIComponent(threadId)}&company_id=eq.${encodeURIComponent(companyId)}&channel=eq.WHATSAPP&archived_at=is.null&select=id,unread_count&limit=1`);
  const thread = threads[0];
  if (!thread) return;
  const externalMessageId = `flow:${flowToken}`;
  const existing = await db<Row[]>(env, `marketing_messages?external_message_id=eq.${encodeURIComponent(externalMessageId)}&company_id=eq.${encodeURIComponent(companyId)}&select=id&limit=1`);
  const sentAt = new Date().toISOString();
  if (!existing.length) {
    await db<Row[]>(env, 'marketing_messages?select=id', {
      method: 'POST',
      body: JSON.stringify({ company_id: companyId, conversation_id: threadId, body: firstMessage, direction: 'INBOUND', sender_name: name, external_message_id: externalMessageId, status: 'DELIVERED', sent_at: sentAt, read_at: null, metadata: { whatsapp_type: 'flow_submission', whatsapp_flow: metadata }, created_at: sentAt }),
    });
  }
  await db<Row[]>(env, `marketing_conversations?id=eq.${encodeURIComponent(threadId)}&company_id=eq.${encodeURIComponent(companyId)}&select=id`, {
    method: 'PATCH',
    body: JSON.stringify({ lead_id: leadId || null, last_message_at: sentAt, updated_at: sentAt, status: 'OPEN', unread_count: Math.max(0, Number(thread.unread_count || 0)) + (existing.length ? 0 : 1) }),
  });
}

async function linkAppointmentToLead(env: WabaClinicFlowEnv, companyId: string, appointmentId: string, leadId: string, threadId: string): Promise<void> {
  await db<Row[]>(env, `waba_clinic_appointments?id=eq.${encodeURIComponent(appointmentId)}&company_id=eq.${encodeURIComponent(companyId)}&select=id`, {
    method: 'PATCH',
    body: JSON.stringify({ lead_id: leadId || null, conversation_id: threadId || null, updated_at: new Date().toISOString() }),
  });
}

async function releaseUnlinkedAppointment(env: WabaClinicFlowEnv, companyId: string, appointmentId: string): Promise<void> {
  if (!appointmentId) return;
  await db<unknown>(env, `waba_clinic_appointments?id=eq.${encodeURIComponent(appointmentId)}&company_id=eq.${encodeURIComponent(companyId)}&lead_id=is.null`, {
    method: 'DELETE',
    headers: { prefer: 'return=minimal' },
  });
}

export async function handleClinicFlowExchange(env: WabaClinicFlowEnv, companyId: string, body: Row): Promise<Row | null> {
  const screenResponse = await handleClinicScreenResponse(env, companyId, body);
  if (screenResponse) return screenResponse;

  const action = text(body.action).toLowerCase();
  const screen = text(body.screen).toUpperCase();
  if (action !== 'data_exchange' || screen !== 'SUMMARY') return null;

  const data = normalizeClinicBookingData(record(body.data));
  const name = text(data.name);
  const phone = text(data.phone);
  const service = text(data.service);
  const comment = text(data.comment);
  const flowToken = text(body.flow_token) || crypto.randomUUID();
  if (!name || !phone || !service || !text(data.branch_id) || !text(data.doctor_id) || !text(data.slot_id)) {
    return { screen: 'SUMMARY', data: { ...record(body.data), error_message: 'Проверьте данные пациента и выбранное время.' } };
  }

  const serviceLabel = SERVICE_LABELS[service] || service;
  const externalId = `whatsapp-flow:${flowToken}`;
  const threadId = threadIdFromFlowToken(flowToken);
  const flowMetadata: Row = {
    flow_token: flowToken,
    screen: 'SUMMARY',
    service,
    service_label: serviceLabel,
    branch_id: text(data.branch_id),
    doctor_id: text(data.doctor_id),
    slot_id: text(data.slot_id),
    comment: comment || null,
    received_at: new Date().toISOString(),
  };

  let appointment: Awaited<ReturnType<typeof createClinicAppointment>> | null = null;
  try {
    // Reserve the slot first. This prevents creating a false CRM lead when the slot was already taken.
    appointment = await createClinicAppointment(env, companyId, data, '', threadId, flowToken);

    const leadPayload = {
      company_id: companyId,
      external_id: externalId,
      name,
      first_name: name.split(/\s+/)[0] || name,
      phone,
      source: 'WhatsApp Flow',
      platform: 'WhatsApp',
      stage: 'Запись',
      first_message: `Запись через WhatsApp Flow: ${serviceLabel}`,
      direction: 'INBOUND',
      is_target: true,
      appointment_at: new Date(appointment.startsAt).toISOString(),
      metadata: { whatsapp_flow: { ...flowMetadata, appointment_id: appointment.appointmentId } },
      updated_at: new Date().toISOString(),
    };
    const leadRows = await db<Row[]>(env, 'marketing_leads?on_conflict=company_id,external_id&select=id', {
      method: 'POST',
      headers: { prefer: 'resolution=merge-duplicates,return=representation' },
      body: JSON.stringify(leadPayload),
    });
    const leadId = text(leadRows[0]?.id);
    if (!leadId) throw new Error('Не удалось создать лид для подтверждённой записи.');

    await linkAppointmentToLead(env, companyId, appointment.appointmentId, leadId, threadId);

    const when = new Intl.DateTimeFormat('ru-KZ', { timeZone: 'Asia/Almaty', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(appointment.startsAt));
    const firstMessage = `Запись WhatsApp Flow: ${serviceLabel}; ${appointment.branchName}; ${appointment.doctorName}; ${when}${comment ? `; ${comment}` : ''}`;
    const finalMetadata = { ...flowMetadata, appointment_id: appointment.appointmentId, starts_at: appointment.startsAt, ends_at: appointment.endsAt, branch_name: appointment.branchName, doctor_name: appointment.doctorName };
    await attachFlowSubmissionToThread(env, companyId, threadId, leadId, name, flowToken, firstMessage, finalMetadata).catch((error) => console.error('Unable to attach WhatsApp Flow booking to chat', error));
    return {
      screen: 'SUCCESS',
      data: {
        extension_message_response: {
          params: {
            flow_token: flowToken,
            lead_id: leadId,
            appointment_id: appointment.appointmentId,
            appointment: `${appointment.branchName} · ${appointment.doctorName} · ${when}`,
          },
        },
      },
    };
  } catch (error) {
    if (appointment?.appointmentId) {
      await releaseUnlinkedAppointment(env, companyId, appointment.appointmentId).catch((cleanupError) => console.error('Unable to release unlinked clinic appointment', cleanupError));
    }
    return {
      screen: 'SUMMARY',
      data: {
        ...record(body.data),
        error_message: error instanceof Error ? error.message : 'Не удалось создать запись.',
      },
    };
  }
}
