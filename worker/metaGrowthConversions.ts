import type { Env } from './integrations';
import { requireCompanyId, type TenantScopedEnv } from './tenantScope';

type Row = Record<string, unknown>;
type ScopedEnv = Env & TenantScopedEnv;

const text = (value: unknown): string => typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim();
const number = (value: unknown): number => typeof value === 'number' && Number.isFinite(value) ? value : Number(value || 0) || 0;
const record = (value: unknown): Row => value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {};

function headers(env: Env, extra: HeadersInit = {}): Headers {
  const next = new Headers(extra);
  next.set('apikey', env.SUPABASE_SERVICE_ROLE_KEY);
  next.set('authorization', `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`);
  next.set('accept', 'application/json');
  if (!next.has('content-type')) next.set('content-type', 'application/json');
  return next;
}

async function db<T>(env: Env, path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/${path}`, {
    ...init,
    headers: headers(env, init.headers),
    cache: 'no-store',
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`Meta Growth DB ${response.status}: ${body.slice(0, 1200)}`);
  return (body ? JSON.parse(body) : null) as T;
}

function graphVersion(value?: string): string {
  const version = text(value) || 'v23.0';
  return version.startsWith('v') ? version : `v${version}`;
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value.trim().toLowerCase()));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function graphPost(env: Env, datasetId: string, payload: Row): Promise<Row> {
  const token = text(env.META_ACCESS_TOKEN);
  if (!token) throw new Error('Meta access token не настроен для текущей клиники');
  const response = await fetch(`https://graph.facebook.com/${graphVersion(env.META_GRAPH_VERSION)}/${encodeURIComponent(datasetId)}/events`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await response.text();
  let result: Row = {};
  try { result = record(body ? JSON.parse(body) : {}); } catch { result = { raw: body }; }
  if (!response.ok || result.error) throw new Error(`Meta Graph ${response.status}: ${JSON.stringify(result).slice(0, 1600)}`);
  return result;
}

function metaEventName(value: unknown): string | null {
  switch (text(value)) {
    case 'qualified_lead': return 'Lead';
    case 'appointment_booked': return 'Schedule';
    case 'arrived': return 'CompleteRegistration';
    case 'purchase': return 'Purchase';
    default: return null;
  }
}

function actionSource(lead: Row): { action_source: string; messaging_channel?: string } {
  const source = `${text(lead.source)} ${text(lead.platform)} ${text(lead.utm_medium)}`.toLowerCase();
  if (source.includes('whatsapp') || source.includes('message')) return { action_source: 'business_messaging', messaging_channel: 'whatsapp' };
  return { action_source: 'website' };
}

async function mark(env: Env, companyId: string, id: string, patch: Row): Promise<void> {
  await db<Row[]>(env, `conversion_events?id=eq.${encodeURIComponent(id)}&company_id=eq.${encodeURIComponent(companyId)}&select=id`, {
    method: 'PATCH',
    headers: { prefer: 'return=minimal' },
    body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() }),
  });
}

export async function processMetaGrowthConversions(env: ScopedEnv, limit = 25): Promise<{ processed: number; sent: number; failed: number; skipped: number }> {
  const companyId = requireCompanyId(env);
  const settings = await db<Row[]>(env, `growth_conversion_destinations?company_id=eq.${encodeURIComponent(companyId)}&provider=eq.meta&enabled=eq.true&select=external_destination_id,config&limit=1`);
  const datasetId = text(settings[0]?.external_destination_id);
  if (!datasetId) throw new Error('Укажите Meta Dataset / Pixel ID в Growth Engine');

  const rows = await db<Row[]>(env, `conversion_events?company_id=eq.${encodeURIComponent(companyId)}&destination=eq.meta&sync_status=in.(pending,failed)&select=*&order=occurred_at.asc&limit=${Math.min(Math.max(limit, 1), 100)}`);
  let sent = 0;
  let failed = 0;
  let skipped = 0;

  for (const row of rows) {
    const id = text(row.id);
    const leadId = text(row.lead_id);
    const eventName = metaEventName(row.event_name);
    if (!id || !leadId || !eventName) {
      if (id) await mark(env, companyId, id, { sync_status: 'skipped', last_error: 'Unsupported conversion event' });
      skipped += 1;
      continue;
    }

    const leads = await db<Row[]>(env, `marketing_leads?id=eq.${encodeURIComponent(leadId)}&company_id=eq.${encodeURIComponent(companyId)}&select=*&limit=1`);
    const lead = leads[0];
    if (!lead) {
      await mark(env, companyId, id, { sync_status: 'failed', attempts: number(row.attempts) + 1, last_error: 'Lead not found in current clinic' });
      failed += 1;
      continue;
    }

    const userData: Row = {};
    const phone = text(lead.phone).replace(/\D/g, '');
    const email = text(lead.email);
    if (phone) userData.ph = [await sha256(phone)];
    if (email) userData.em = [await sha256(email)];
    const fbclid = text(row.fbclid) || text(lead.fbclid);
    if (fbclid) {
      const eventMillis = Date.parse(text(row.occurred_at)) || Date.now();
      userData.fbc = `fb.1.${Math.floor(eventMillis / 1000)}.${fbclid}`;
    }
    if (!phone && !email && !fbclid) {
      await mark(env, companyId, id, { sync_status: 'skipped', last_error: 'Нет match key для Meta: phone/email/fbclid' });
      skipped += 1;
      continue;
    }

    const occurredAt = Date.parse(text(row.occurred_at));
    const customData: Row = {
      currency: text(row.currency || 'KZT').toUpperCase(),
      lead_event_source: text(lead.source) || text(lead.platform) || 'IMDS',
      campaign_id: text(row.campaign_id) || text(lead.campaign_id) || undefined,
      adset_id: text(row.adset_id) || text(lead.adset_id) || undefined,
      ad_id: text(row.ad_id) || text(lead.ad_id) || text(lead.referral_source_id) || undefined,
    };
    if (number(row.value) > 0) customData.value = number(row.value);
    const source = actionSource(lead);
    const event: Row = {
      event_name: eventName,
      event_time: Math.floor((Number.isFinite(occurredAt) ? occurredAt : Date.now()) / 1000),
      event_id: text(row.dedupe_key) || `imds:${id}`,
      ...source,
      user_data: userData,
      custom_data: customData,
    };

    await mark(env, companyId, id, { sync_status: 'processing', attempts: number(row.attempts) + 1, last_error: null });
    try {
      const config = record(settings[0]?.config);
      const response = await graphPost(env, datasetId, { data: [event], ...(text(config.testEventCode) ? { test_event_code: text(config.testEventCode) } : {}) });
      await mark(env, companyId, id, { sync_status: 'sent', sent_at: new Date().toISOString(), last_error: null, payload: { ...record(row.payload), meta_response: response, meta_event_name: eventName } });
      sent += 1;
    } catch (error) {
      await mark(env, companyId, id, { sync_status: 'failed', last_error: error instanceof Error ? error.message : String(error) });
      failed += 1;
    }
  }

  return { processed: rows.length, sent, failed, skipped };
}
