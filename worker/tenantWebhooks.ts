import { resolveCompanyId } from './companyContext';

type JsonRecord = Record<string, unknown>;

type WebhookProvider = 'bitrix' | 'meta' | 'tiktok';

export interface TenantWebhookEnv {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  DEFAULT_COMPANY_ID?: string;
  BITRIX_WEBHOOK_BASE_URL?: string;
  BITRIX_OUTBOUND_TOKEN?: string;
  BITRIX_ENTITY_TYPE_ID?: string;
  BITRIX_TARGET_STAGE_IDS?: string;
  BITRIX_ARRIVED_STAGE_IDS?: string;
  BITRIX_SALE_STAGE_IDS?: string;
  BITRIX_APPOINTMENT_FIELD?: string;
  BITRIX_TARGET_FIELD?: string;
  BITRIX_ARRIVED_FIELD?: string;
  BITRIX_SALE_DATE_FIELD?: string;
  BITRIX_SALE_AMOUNT_FIELD?: string;
  BITRIX_NEXT_ACTION_FIELD?: string;
  BITRIX_SOURCE_FIELD?: string;
  BITRIX_CAMPAIGN_FIELD?: string;
  META_ACCESS_TOKEN?: string;
  META_GRAPH_VERSION?: string;
  META_WEBHOOK_VERIFY_TOKEN?: string;
  META_APP_SECRET?: string;
  TIKTOK_WEBHOOK_SECRET?: string;
  N8N_WEBHOOK_SECRET?: string;
}

interface NormalizedLead {
  external_id: string;
  name: string;
  phone: string;
  email: string | null;
  source: string;
  platform: string;
  campaign: string | null;
  manager: string | null;
  stage: string;
  next_action: string | null;
  first_message: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  utm_term: string | null;
  campaign_id: string | null;
  adset_id: string | null;
  ad_id: string | null;
  lead_created_at: string;
  appointment_at: string | null;
  arrived_at: string | null;
  sold_at: string | null;
  is_target: boolean;
  sale_amount: number;
  metadata: JsonRecord;
}

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});

const record = (value: unknown): JsonRecord => value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {};
const text = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value.trim() || null;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return null;
};
const number = (value: unknown): number => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value.replace(/\s/g, '').replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
};
const bool = (value: unknown): boolean => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  return ['1', 'y', 'yes', 'true', 'да'].includes(String(value || '').toLowerCase());
};
const csv = (value?: string): string[] => (value || '').split(',').map((item) => item.trim()).filter(Boolean);
const isoDate = (value: Date): string => value.toISOString().slice(0, 10);

function dateTime(value: unknown): string | null {
  const raw = text(value);
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function getField(item: JsonRecord, fieldName?: string): unknown {
  if (!fieldName) return undefined;
  if (fieldName in item) return item[fieldName];
  const lower = fieldName.toLowerCase();
  const key = Object.keys(item).find((candidate) => candidate.toLowerCase() === lower);
  return key ? item[key] : undefined;
}

function firstValue(item: JsonRecord, names: Array<string | undefined>): unknown {
  for (const name of names) {
    const value = getField(item, name);
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return undefined;
}

function firstText(item: JsonRecord, names: Array<string | undefined>): string | null {
  return text(firstValue(item, names));
}

function firstCommunication(item: JsonRecord, kind: 'PHONE' | 'EMAIL'): string | null {
  const direct = firstValue(item, [kind, kind.toLowerCase(), kind === 'PHONE' ? 'phone' : 'email']);
  if (Array.isArray(direct)) {
    for (const entry of direct) {
      const value = text(record(entry).VALUE ?? record(entry).value ?? entry);
      if (value) return value;
    }
  }
  const directText = text(direct);
  if (directText) return directText;
  const fm = record(item.fm);
  const entries = fm[kind] ?? fm[kind.toLowerCase()];
  if (Array.isArray(entries)) {
    for (const entry of entries) {
      const data = record(entry);
      const value = text(data.VALUE ?? data.value);
      if (value) return value;
    }
  }
  return null;
}

function platformFromSource(source: string | null): string {
  const value = (source || '').toLowerCase();
  if (/meta|facebook|instagram|fb|инстаграм/.test(value)) return 'Meta';
  if (/tiktok|tik tok|тикток/.test(value)) return 'TikTok';
  if (/google/.test(value)) return 'Google';
  if (/yandex|яндекс/.test(value)) return 'Яндекс';
  if (/organic|органик|сарафан|recommend/.test(value)) return 'Органика';
  return source || 'Не определено';
}

function secureEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let result = 0;
  for (let index = 0; index < left.length; index += 1) result |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return result === 0;
}

function bearerToken(request: Request): string | null {
  const auth = request.headers.get('authorization') || '';
  return auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : null;
}

function requireSecret(request: Request, expected?: string): boolean {
  if (!expected) return false;
  const supplied = bearerToken(request) || request.headers.get('x-webhook-secret') || new URL(request.url).searchParams.get('secret');
  return Boolean(supplied && secureEqual(supplied, expected));
}

async function hmacSha256(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function parseJsonOrForm(body: string, contentType: string): JsonRecord {
  if (contentType.includes('application/json')) {
    try { return record(JSON.parse(body)); } catch { return {}; }
  }
  const params = new URLSearchParams(body);
  const result: JsonRecord = {};
  params.forEach((value, key) => { result[key] = value; });
  return result;
}

async function supabase<T>(env: TenantWebhookEnv, path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      'content-type': 'application/json',
      ...init.headers,
    },
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`Tenant webhook Supabase: ${response.status} ${body}`);
  return (body ? JSON.parse(body) : null) as T;
}

async function upsertRows(
  env: TenantWebhookEnv,
  table: string,
  rows: JsonRecord[],
  onConflict: string,
): Promise<number> {
  if (!rows.length) return 0;
  await supabase<unknown>(env, `${table}?on_conflict=${encodeURIComponent(onConflict)}`, {
    method: 'POST',
    headers: { prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(rows),
  });
  return rows.length;
}

async function recordWebhookEvent(
  env: TenantWebhookEnv,
  companyId: string,
  source: WebhookProvider,
  eventKey: string,
  eventType: string,
  payload: unknown,
): Promise<boolean> {
  const rows = await supabase<JsonRecord[]>(env, `integration_events?on_conflict=${encodeURIComponent('company_id,source,event_key')}`, {
    method: 'POST',
    headers: { prefer: 'resolution=ignore-duplicates,return=representation' },
    body: JSON.stringify({
      company_id: companyId,
      source,
      event_key: eventKey,
      event_type: eventType,
      status: 'received',
      payload,
      received_at: new Date().toISOString(),
    }),
  });
  return rows.length > 0;
}

async function markWebhookEvent(
  env: TenantWebhookEnv,
  companyId: string,
  source: WebhookProvider,
  eventKey: string,
  status: 'processed' | 'failed',
  error?: unknown,
): Promise<void> {
  const params = new URLSearchParams({
    company_id: `eq.${companyId}`,
    source: `eq.${source}`,
    event_key: `eq.${eventKey}`,
  });
  await supabase<unknown>(env, `integration_events?${params}`, {
    method: 'PATCH',
    headers: { prefer: 'return=minimal' },
    body: JSON.stringify({
      status,
      processed_at: new Date().toISOString(),
      error: error instanceof Error ? error.message : error ? String(error) : null,
    }),
  });
}

async function refreshCrmMetrics(
  env: TenantWebhookEnv,
  companyId: string,
  date: string,
): Promise<void> {
  await supabase<unknown>(env, 'rpc/refresh_crm_daily_metrics', {
    method: 'POST',
    headers: { prefer: 'return=minimal' },
    body: JSON.stringify({ p_company_id: companyId, p_date_from: date, p_date_to: date }),
  });
}

function normalizeBitrixItem(item: JsonRecord, entityTypeId: number, env: TenantWebhookEnv): NormalizedLead {
  const id = firstText(item, ['id', 'ID']) || crypto.randomUUID();
  const stage = firstText(item, ['stageId', 'statusId', 'STAGE_ID', 'STATUS_ID']) || 'Не определено';
  const targetStages = new Set(csv(env.BITRIX_TARGET_STAGE_IDS));
  const arrivedStages = new Set(csv(env.BITRIX_ARRIVED_STAGE_IDS));
  const saleStages = new Set(csv(env.BITRIX_SALE_STAGE_IDS));
  const firstName = firstText(item, ['name', 'NAME']);
  const lastName = firstText(item, ['lastName', 'LAST_NAME']);
  const title = firstText(item, ['title', 'TITLE']);
  const fullName = [firstName, lastName].filter(Boolean).join(' ') || title || `Bitrix ${id}`;
  const utmSource = firstText(item, [env.BITRIX_SOURCE_FIELD, 'utmSource', 'UTM_SOURCE', 'sourceId', 'SOURCE_ID']);
  const utmMedium = firstText(item, ['utmMedium', 'UTM_MEDIUM']);
  const platform = platformFromSource(`${utmSource || ''} ${utmMedium || ''}`);
  const source = utmSource || platform;
  const saleDateValue = firstValue(item, [env.BITRIX_SALE_DATE_FIELD, 'closedTime', 'CLOSEDATE']);
  const leadCreatedAt = dateTime(firstValue(item, ['createdTime', 'dateCreate', 'DATE_CREATE'])) || new Date().toISOString();
  const sold = saleStages.has(stage) || Boolean(dateTime(saleDateValue));
  const arrived = arrivedStages.has(stage) || sold || bool(getField(item, env.BITRIX_ARRIVED_FIELD));
  return {
    external_id: `bitrix:${entityTypeId}:${id}`,
    name: fullName,
    phone: firstCommunication(item, 'PHONE') || '',
    email: firstCommunication(item, 'EMAIL'),
    source,
    platform,
    campaign: firstText(item, [env.BITRIX_CAMPAIGN_FIELD, 'utmCampaign', 'UTM_CAMPAIGN']),
    manager: firstText(item, ['assignedById', 'ASSIGNED_BY_ID']),
    stage,
    next_action: firstText(item, [env.BITRIX_NEXT_ACTION_FIELD, 'comments', 'COMMENTS']),
    first_message: firstText(item, ['comments', 'COMMENTS']),
    utm_source: utmSource,
    utm_medium: utmMedium,
    utm_campaign: firstText(item, ['utmCampaign', 'UTM_CAMPAIGN']),
    utm_content: firstText(item, ['utmContent', 'UTM_CONTENT']),
    utm_term: firstText(item, ['utmTerm', 'UTM_TERM']),
    campaign_id: firstText(item, ['campaignId', 'CAMPAIGN_ID']),
    adset_id: firstText(item, ['adsetId', 'ADSET_ID']),
    ad_id: firstText(item, ['adId', 'AD_ID']),
    lead_created_at: leadCreatedAt,
    appointment_at: dateTime(firstValue(item, [env.BITRIX_APPOINTMENT_FIELD])),
    arrived_at: arrived ? dateTime(firstValue(item, [env.BITRIX_ARRIVED_FIELD, 'movedTime', 'MOVED_TIME'])) || leadCreatedAt : null,
    sold_at: sold ? dateTime(saleDateValue) || leadCreatedAt : null,
    is_target: targetStages.has(stage) || bool(getField(item, env.BITRIX_TARGET_FIELD)) || arrived || sold,
    sale_amount: sold ? number(firstValue(item, [env.BITRIX_SALE_AMOUNT_FIELD, 'opportunity', 'OPPORTUNITY'])) : 0,
    metadata: { bitrix: item, entity_type_id: entityTypeId },
  };
}

async function bitrixCall<T>(env: TenantWebhookEnv, method: string, params: JsonRecord): Promise<T> {
  if (!env.BITRIX_WEBHOOK_BASE_URL) throw new Error('BITRIX_WEBHOOK_BASE_URL is missing');
  const response = await fetch(`${env.BITRIX_WEBHOOK_BASE_URL.replace(/\/$/, '')}/${method}.json`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(params),
  });
  const payload = await response.json() as JsonRecord;
  if (!response.ok || payload.error) throw new Error(`Bitrix ${method}: ${response.status} ${JSON.stringify(payload)}`);
  return payload as T;
}

async function fetchBitrixItem(env: TenantWebhookEnv, entityTypeId: number, id: string): Promise<JsonRecord> {
  const payload = await bitrixCall<{ result?: { item?: JsonRecord } }>(env, 'crm.item.get', {
    entityTypeId,
    id: Number(id),
    useOriginalUfNames: 'Y',
  });
  if (!payload.result?.item) throw new Error(`Bitrix item ${entityTypeId}:${id} was not returned`);
  return payload.result.item;
}

async function handleBitrixWebhook(request: Request, env: TenantWebhookEnv): Promise<Response> {
  const body = await request.text();
  const payload = parseJsonOrForm(body, request.headers.get('content-type') || '');
  const auth = record(payload.auth);
  const suppliedToken = text(auth.application_token) || text(payload['auth[application_token]']) || request.headers.get('x-webhook-secret');
  if (!env.BITRIX_OUTBOUND_TOKEN || !suppliedToken || !secureEqual(suppliedToken, env.BITRIX_OUTBOUND_TOKEN)) {
    return json({ error: 'Invalid Bitrix webhook token' }, 401);
  }

  const event = (text(payload.event) || 'UNKNOWN').toUpperCase();
  const data = record(payload.data);
  const fields = record(data.FIELDS ?? data.fields);
  const id = text(fields.ID ?? fields.id ?? payload['data[FIELDS][ID]']);
  if (!id) return json({ error: 'Bitrix entity ID is missing' }, 400);

  const companyId = await resolveCompanyId(env);
  const entityTypeId = event.includes('DEAL') ? 2 : Number(env.BITRIX_ENTITY_TYPE_ID || 1);
  const eventKey = `${event}:${entityTypeId}:${id}:${text(payload.ts) || '0'}`;
  const created = await recordWebhookEvent(env, companyId, 'bitrix', eventKey, event, payload);
  if (!created) return json({ ok: true, duplicate: true });

  try {
    const item = await fetchBitrixItem(env, entityTypeId, id);
    const lead = normalizeBitrixItem(item, entityTypeId, env);
    await upsertRows(env, 'marketing_leads', [{ ...lead, company_id: companyId }], 'company_id,external_id');
    await refreshCrmMetrics(env, companyId, lead.lead_created_at.slice(0, 10));
    await markWebhookEvent(env, companyId, 'bitrix', eventKey, 'processed');
    return json({ ok: true, external_id: lead.external_id });
  } catch (error) {
    await markWebhookEvent(env, companyId, 'bitrix', eventKey, 'failed', error);
    throw error;
  }
}

function metaLeadField(fields: unknown, names: string[]): string | null {
  if (!Array.isArray(fields)) return null;
  const accepted = new Set(names.map((name) => name.toLowerCase()));
  for (const item of fields) {
    const row = record(item);
    const name = (text(row.name) || '').toLowerCase();
    if (!accepted.has(name)) continue;
    const values = Array.isArray(row.values) ? row.values : [];
    const value = text(values[0]);
    if (value) return value;
  }
  return null;
}

async function fetchMetaLead(env: TenantWebhookEnv, leadgenId: string): Promise<JsonRecord> {
  if (!env.META_ACCESS_TOKEN || !env.META_GRAPH_VERSION) throw new Error('Meta credentials are missing');
  const params = new URLSearchParams({
    access_token: env.META_ACCESS_TOKEN,
    fields: 'id,created_time,ad_id,form_id,field_data',
  });
  const response = await fetch(`https://graph.facebook.com/${env.META_GRAPH_VERSION}/${encodeURIComponent(leadgenId)}?${params}`);
  const payload = await response.json() as JsonRecord;
  if (!response.ok || payload.error) throw new Error(`Meta lead: ${response.status} ${JSON.stringify(payload)}`);
  return payload;
}

async function handleMetaWebhook(request: Request, env: TenantWebhookEnv): Promise<Response> {
  const url = new URL(request.url);
  if (request.method === 'GET') {
    const mode = url.searchParams.get('hub.mode');
    const token = url.searchParams.get('hub.verify_token');
    const challenge = url.searchParams.get('hub.challenge');
    if (mode === 'subscribe' && token && env.META_WEBHOOK_VERIFY_TOKEN && secureEqual(token, env.META_WEBHOOK_VERIFY_TOKEN)) {
      return new Response(challenge || '', { status: 200 });
    }
    return new Response('Forbidden', { status: 403 });
  }

  const body = await request.text();
  if (env.META_APP_SECRET) {
    const supplied = request.headers.get('x-hub-signature-256') || '';
    const expected = `sha256=${await hmacSha256(env.META_APP_SECRET, body)}`;
    if (!secureEqual(supplied, expected)) return json({ error: 'Invalid Meta signature' }, 401);
  }

  const companyId = await resolveCompanyId(env);
  const payload = record(JSON.parse(body || '{}'));
  const entries = Array.isArray(payload.entry) ? payload.entry.map(record) : [];
  const changes = entries.flatMap((entry) => Array.isArray(entry.changes) ? entry.changes.map(record) : []);
  const results: string[] = [];

  for (const change of changes) {
    const value = record(change.value);
    const leadgenId = text(value.leadgen_id);
    if (!leadgenId) continue;
    const eventKey = `leadgen:${leadgenId}`;
    const created = await recordWebhookEvent(env, companyId, 'meta', eventKey, text(change.field) || 'leadgen', change);
    if (!created) continue;

    try {
      const leadData = await fetchMetaLead(env, leadgenId);
      const fieldData = leadData.field_data;
      const lead: NormalizedLead = {
        external_id: `meta-lead:${leadgenId}`,
        name: metaLeadField(fieldData, ['full_name', 'name']) || `Meta lead ${leadgenId}`,
        phone: metaLeadField(fieldData, ['phone_number', 'phone']) || '',
        email: metaLeadField(fieldData, ['email']),
        source: 'Meta',
        platform: 'Meta',
        campaign: null,
        manager: null,
        stage: 'Новый',
        next_action: null,
        first_message: null,
        utm_source: 'meta',
        utm_medium: 'lead_form',
        utm_campaign: null,
        utm_content: null,
        utm_term: null,
        campaign_id: null,
        adset_id: null,
        ad_id: text(leadData.ad_id),
        lead_created_at: dateTime(leadData.created_time) || new Date().toISOString(),
        appointment_at: null,
        arrived_at: null,
        sold_at: null,
        is_target: false,
        sale_amount: 0,
        metadata: { meta: leadData },
      };
      await upsertRows(env, 'marketing_leads', [{ ...lead, company_id: companyId }], 'company_id,external_id');
      await refreshCrmMetrics(env, companyId, lead.lead_created_at.slice(0, 10));
      await markWebhookEvent(env, companyId, 'meta', eventKey, 'processed');
      results.push(lead.external_id);
    } catch (error) {
      await markWebhookEvent(env, companyId, 'meta', eventKey, 'failed', error);
      console.error(error);
    }
  }

  return json({ ok: true, processed: results.length, leads: results });
}

async function handleTikTokWebhook(request: Request, env: TenantWebhookEnv): Promise<Response> {
  if (!requireSecret(request, env.TIKTOK_WEBHOOK_SECRET)) return json({ error: 'Invalid TikTok webhook secret' }, 401);
  const companyId = await resolveCompanyId(env);
  const payload = record(await request.json());
  const eventType = text(payload.event) || text(payload.event_type) || 'tiktok_event';
  const data = record(payload.data);
  const leadId = firstText(data, ['lead_id', 'leadId', 'id']) || (await sha256Hex(JSON.stringify(payload))).slice(0, 32);
  const eventKey = `${eventType}:${leadId}`;
  const created = await recordWebhookEvent(env, companyId, 'tiktok', eventKey, eventType, payload);
  if (!created) return json({ ok: true, duplicate: true });

  try {
    const lead: NormalizedLead = {
      external_id: `tiktok-lead:${leadId}`,
      name: firstText(data, ['full_name', 'name']) || `TikTok lead ${leadId}`,
      phone: firstText(data, ['phone_number', 'phone']) || '',
      email: firstText(data, ['email']),
      source: 'TikTok',
      platform: 'TikTok',
      campaign: firstText(data, ['campaign_name', 'campaign']),
      manager: null,
      stage: 'Новый',
      next_action: null,
      first_message: firstText(data, ['message', 'comments']),
      utm_source: 'tiktok',
      utm_medium: 'lead_form',
      utm_campaign: firstText(data, ['campaign_name', 'campaign']),
      utm_content: firstText(data, ['ad_name']),
      utm_term: null,
      campaign_id: firstText(data, ['campaign_id']),
      adset_id: firstText(data, ['adgroup_id', 'adset_id']),
      ad_id: firstText(data, ['ad_id']),
      lead_created_at: dateTime(firstValue(data, ['create_time', 'created_at', 'timestamp'])) || new Date().toISOString(),
      appointment_at: null,
      arrived_at: null,
      sold_at: null,
      is_target: false,
      sale_amount: 0,
      metadata: { tiktok: payload },
    };
    await upsertRows(env, 'marketing_leads', [{ ...lead, company_id: companyId }], 'company_id,external_id');
    await refreshCrmMetrics(env, companyId, lead.lead_created_at.slice(0, 10));
    await markWebhookEvent(env, companyId, 'tiktok', eventKey, 'processed');
    return json({ ok: true, external_id: lead.external_id });
  } catch (error) {
    await markWebhookEvent(env, companyId, 'tiktok', eventKey, 'failed', error);
    throw error;
  }
}

async function handleN8nWebhook(request: Request, env: TenantWebhookEnv): Promise<Response> {
  if (!requireSecret(request, env.N8N_WEBHOOK_SECRET)) return json({ error: 'Invalid n8n webhook secret' }, 401);
  const companyId = await resolveCompanyId(env);
  const payload = record(await request.json());
  const kind = text(payload.kind);
  const records = Array.isArray(payload.records) ? payload.records.map(record) : [record(payload.record ?? payload.data)];
  if (!kind || !records.length) return json({ error: 'kind and records are required' }, 400);

  if (kind === 'lead') {
    const normalized = records.map((item) => ({
      ...item,
      company_id: companyId,
      external_id: text(item.external_id) || `n8n:${crypto.randomUUID()}`,
      name: text(item.name) || 'Без имени',
      phone: text(item.phone) || '',
      stage: text(item.stage) || 'Новый',
      source: text(item.source) || 'n8n',
      platform: text(item.platform) || platformFromSource(text(item.source)),
      lead_created_at: dateTime(item.lead_created_at) || new Date().toISOString(),
      metadata: record(item.metadata),
    }));
    const written = await upsertRows(env, 'marketing_leads', normalized, 'company_id,external_id');
    const dates = [...new Set(normalized.map((item) => String(item.lead_created_at).slice(0, 10)))];
    await Promise.all(dates.map((date) => refreshCrmMetrics(env, companyId, date)));
    return json({ ok: true, kind, written });
  }

  if (kind === 'ad') {
    const normalized = records.map((item) => ({
      ...item,
      company_id: companyId,
      external_id: text(item.external_id) || `n8n-ad:${crypto.randomUUID()}`,
      report_date: text(item.report_date) || isoDate(new Date()),
      source: text(item.source) || text(item.platform) || 'n8n',
      platform: text(item.platform) || 'n8n',
      campaign_name: text(item.campaign_name) || 'Без кампании',
    }));
    const written = await upsertRows(env, 'marketing_ads', normalized, 'company_id,external_id,report_date');
    await supabase<unknown>(env, 'rpc/refresh_meta_daily_metrics', {
      method: 'POST',
      headers: { prefer: 'return=minimal' },
      body: JSON.stringify({ p_company_id: companyId }),
    });
    return json({ ok: true, kind, written });
  }

  if (kind === 'daily_metric') {
    const normalized = records.map((item) => ({
      ...item,
      company_id: companyId,
      date: text(item.date) || isoDate(new Date()),
      source: text(item.source) || 'n8n',
      platform: text(item.platform) || text(item.source) || 'n8n',
    }));
    return json({
      ok: true,
      kind,
      written: await upsertRows(env, 'marketing_daily_metrics', normalized, 'company_id,date,source,platform'),
    });
  }

  return json({ error: `Unsupported kind: ${kind}` }, 400);
}

export async function handleTenantWebhookRequest(
  request: Request,
  env: TenantWebhookEnv,
  url: URL,
): Promise<Response | null> {
  if (url.pathname === '/api/webhooks/bitrix' && request.method === 'POST') return handleBitrixWebhook(request, env);
  if (url.pathname === '/api/webhooks/meta' && ['GET', 'POST'].includes(request.method)) return handleMetaWebhook(request, env);
  if (url.pathname === '/api/webhooks/tiktok' && request.method === 'POST') return handleTikTokWebhook(request, env);
  if (url.pathname === '/api/webhooks/n8n' && request.method === 'POST') return handleN8nWebhook(request, env);
  return null;
}
