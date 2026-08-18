import type { UniversalTelephonyEnv } from './telephonyGateway';
import { branchScope, requireBranchId, requireCompanyId } from './tenantScope';

type Row = Record<string, unknown>;
export type ConfigurableTelephonyProvider = 'asterisk' | 'freepbx' | 'twilio' | 'voximplant' | 'binotel' | 'sipuni';
export type CloudTelephonyProvider = Extract<ConfigurableTelephonyProvider, 'binotel' | 'sipuni'>;
type Definition = { required: string[]; secrets: string[]; mapping: Record<string, string> };

const definitions: Record<ConfigurableTelephonyProvider, Definition> = {
  asterisk: { required: ['ariBaseUrl', 'ariUsername', 'ariPassword', 'stasisApp', 'endpointTemplate'], secrets: ['ariPassword'], mapping: { ariBaseUrl: 'ASTERISK_ARI_BASE_URL', ariUsername: 'ASTERISK_ARI_USERNAME', ariPassword: 'ASTERISK_ARI_PASSWORD', stasisApp: 'ASTERISK_STASIS_APP', endpointTemplate: 'ASTERISK_ENDPOINT_TEMPLATE', callerId: 'ASTERISK_CALLER_ID' } },
  freepbx: { required: ['ariBaseUrl', 'ariUsername', 'ariPassword', 'stasisApp', 'endpointTemplate'], secrets: ['ariPassword'], mapping: { ariBaseUrl: 'FREEPBX_ARI_BASE_URL', ariUsername: 'FREEPBX_ARI_USERNAME', ariPassword: 'FREEPBX_ARI_PASSWORD', stasisApp: 'FREEPBX_STASIS_APP', endpointTemplate: 'FREEPBX_ENDPOINT_TEMPLATE', callerId: 'FREEPBX_CALLER_ID' } },
  twilio: { required: ['accountSid', 'authToken', 'fromNumber', 'agentEndpoint'], secrets: ['authToken'], mapping: { accountSid: 'TWILIO_ACCOUNT_SID', authToken: 'TWILIO_AUTH_TOKEN', fromNumber: 'TWILIO_FROM_NUMBER', agentEndpoint: 'TWILIO_AGENT_ENDPOINT' } },
  voximplant: { required: ['accountId', 'keyId', 'privateKey', 'ruleId'], secrets: ['privateKey'], mapping: { accountId: 'VOXIMPLANT_ACCOUNT_ID', keyId: 'VOXIMPLANT_KEY_ID', privateKey: 'VOXIMPLANT_PRIVATE_KEY', ruleId: 'VOXIMPLANT_RULE_ID', controlProtocol: 'VOXIMPLANT_CONTROL_PROTOCOL' } },
  binotel: {
    required: ['apiKey', 'apiSecret'],
    secrets: ['apiKey', 'apiSecret', 'webhookSecret', 'outboundUrlTemplate'],
    mapping: {
      apiKey: 'BINOTEL_API_KEY',
      apiSecret: 'BINOTEL_API_SECRET',
      apiBaseUrl: 'BINOTEL_API_BASE_URL',
      webhookSecret: 'BINOTEL_WEBHOOK_SECRET',
      outboundUrlTemplate: 'BINOTEL_OUTBOUND_URL_TEMPLATE',
      outboundMethod: 'BINOTEL_OUTBOUND_METHOD',
    },
  },
  sipuni: {
    required: ['userId', 'apiKey'],
    secrets: ['apiKey', 'webhookSecret', 'outboundUrlTemplate'],
    mapping: {
      userId: 'SIPUNI_USER_ID',
      apiKey: 'SIPUNI_API_KEY',
      webhookSecret: 'SIPUNI_WEBHOOK_SECRET',
      outboundUrlTemplate: 'SIPUNI_OUTBOUND_URL_TEMPLATE',
      outboundMethod: 'SIPUNI_OUTBOUND_METHOD',
    },
  },
};

const text = (value: unknown) => typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim();
const rec = (value: unknown): Row => value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {};
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
const isCloudProvider = (value: ConfigurableTelephonyProvider): value is CloudTelephonyProvider => value === 'binotel' || value === 'sipuni';
function headers(env: UniversalTelephonyEnv, extra: HeadersInit = {}) { const result = new Headers(extra); result.set('apikey', env.SUPABASE_SERVICE_ROLE_KEY); result.set('authorization', `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`); result.set('accept', 'application/json'); if (!result.has('content-type')) result.set('content-type', 'application/json'); return result; }
async function db<T>(env: UniversalTelephonyEnv, path: string, init: RequestInit = {}): Promise<T> { const response = await fetch(`${env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/${path}`, { ...init, headers: headers(env, init.headers), cache: 'no-store' }); const raw = await response.text(); if (!response.ok) throw new Error(`Telephony credentials ${response.status}: ${raw.slice(0, 800)}`); return (raw ? JSON.parse(raw) : null) as T; }
function encryptionSecret(env: UniversalTelephonyEnv) { const direct = text((env as unknown as Row).INTEGRATION_ENCRYPTION_KEY); return direct || `amanat-integrations:v1:${env.SUPABASE_SERVICE_ROLE_KEY}`; }
function b64(bytes: Uint8Array) { let out = ''; for (const byte of bytes) out += String.fromCharCode(byte); return btoa(out); }
function fromB64(value: string) { const raw = atob(value); return Uint8Array.from(raw, (character) => character.charCodeAt(0)); }
async function key(value: string) { const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)); return crypto.subtle.importKey('raw', hash, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']); }
async function encrypt(payload: Row, value: string) { const iv = crypto.getRandomValues(new Uint8Array(12)); const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await key(value), new TextEncoder().encode(JSON.stringify(payload))); return { encrypted_payload: b64(new Uint8Array(encrypted)), iv: b64(iv) }; }
async function decrypt(row: Row, value: string): Promise<Row> { const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(text(row.iv)) }, await key(value), fromB64(text(row.encrypted_payload))); return rec(JSON.parse(new TextDecoder().decode(decrypted))); }
function provider(value: unknown): ConfigurableTelephonyProvider | null { const normalized = text(value).toLowerCase(); return normalized in definitions ? normalized as ConfigurableTelephonyProvider : null; }
function randomSecret(): string { const bytes = crypto.getRandomValues(new Uint8Array(32)); return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join(''); }
function webhookUrl(env: UniversalTelephonyEnv, selectedProvider: ConfigurableTelephonyProvider, companyId: string, branchId: string, secret: string): string | null { if (!isCloudProvider(selectedProvider)) return null; const origin = text((env as unknown as Row).APP_ORIGIN).replace(/\/$/, ''); return origin && secret ? `${origin}/api/telephony/${selectedProvider}/webhook/${companyId}/${branchId}?token=${encodeURIComponent(secret)}` : null; }
function scopeQuery(env: UniversalTelephonyEnv): string { const scope = branchScope(env); return scope.branchId ? `&branch_id=eq.${encodeURIComponent(scope.branchId)}` : scope.all ? '' : '&branch_id=is.null'; }
async function rows(env: UniversalTelephonyEnv) { const companyId = requireCompanyId(env); return db<Row[]>(env, `integration_credentials?company_id=eq.${encodeURIComponent(companyId)}&user_id=is.null${scopeQuery(env)}&provider=in.(asterisk,freepbx,twilio,voximplant,binotel,sipuni)&select=*`); }
function summary(row: Row) { const config = rec(row.config_summary); return { provider: text(row.provider), branchId: text(row.branch_id) || null, configured: true, active: config.active === true, status: text(row.status) || 'configured', values: rec(config.values), secretFields: rec(config.secretFields), lastVerifiedAt: row.last_verified_at || null, lastError: row.last_error || null }; }

export async function activeBranchCloudTelephonyProvider(env: UniversalTelephonyEnv, explicitCompanyId?: string, explicitBranchId?: string): Promise<CloudTelephonyProvider | null> {
  const companyId = explicitCompanyId || requireCompanyId(env);
  const branchId = explicitBranchId || requireBranchId(env);
  const cloudRows = await db<Row[]>(env, `integration_credentials?company_id=eq.${encodeURIComponent(companyId)}&branch_id=eq.${encodeURIComponent(branchId)}&user_id=is.null&provider=in.(binotel,sipuni)&select=provider,config_summary,updated_at&order=updated_at.desc`);
  const active = cloudRows.find((row) => rec(row.config_summary).active === true);
  const selected = provider(active?.provider);
  return selected && isCloudProvider(selected) ? selected : null;
}

async function deactivateOtherCloudProviders(env: UniversalTelephonyEnv, companyId: string, branchId: string, selectedProvider: CloudTelephonyProvider): Promise<void> {
  const cloudRows = await db<Row[]>(env, `integration_credentials?company_id=eq.${encodeURIComponent(companyId)}&branch_id=eq.${encodeURIComponent(branchId)}&user_id=is.null&provider=in.(binotel,sipuni)&select=id,provider,config_summary`);
  for (const row of cloudRows) {
    if (text(row.provider) === selectedProvider || rec(row.config_summary).active !== true || !row.id) continue;
    await db(env, `integration_credentials?id=eq.${encodeURIComponent(text(row.id))}&company_id=eq.${encodeURIComponent(companyId)}&branch_id=eq.${encodeURIComponent(branchId)}`, {
      method: 'PATCH',
      headers: { prefer: 'return=minimal' },
      body: JSON.stringify({ config_summary: { ...rec(row.config_summary), active: false }, updated_at: new Date().toISOString() }),
    });
  }
}

export async function loadTelephonyProviderCredential(env: UniversalTelephonyEnv, selectedProvider: ConfigurableTelephonyProvider, explicitCompanyId?: string, explicitBranchId?: string): Promise<{ row: Row; payload: Row } | null> { const companyId = explicitCompanyId || requireCompanyId(env); const branchId = explicitBranchId || requireBranchId(env); const found = (await db<Row[]>(env, `integration_credentials?company_id=eq.${encodeURIComponent(companyId)}&branch_id=eq.${encodeURIComponent(branchId)}&user_id=is.null&provider=eq.${selectedProvider}&select=*&limit=1`))[0]; if (!found) return null; return { row: found, payload: await decrypt(found, encryptionSecret(env)) }; }
export async function markTelephonyProviderStatus(env: UniversalTelephonyEnv, companyId: string, branchId: string, selectedProvider: ConfigurableTelephonyProvider, ok: boolean, error?: unknown): Promise<void> { const now = new Date().toISOString(); await db(env, `integration_credentials?company_id=eq.${encodeURIComponent(companyId)}&branch_id=eq.${encodeURIComponent(branchId)}&user_id=is.null&provider=eq.${selectedProvider}`, { method: 'PATCH', headers: { prefer: 'return=minimal' }, body: JSON.stringify({ status: ok ? 'connected' : 'error', last_verified_at: now, last_error: ok ? null : (error instanceof Error ? error.message : String(error || 'Telephony provider error')).slice(0, 1000), updated_at: now }) }); }
export async function hydrateTelephonyProviderEnv<T extends UniversalTelephonyEnv>(env: T): Promise<T> { const result = { ...env } as T; for (const row of await rows(env)) { const selectedProvider = provider(row.provider); if (!selectedProvider) continue; try { const payload = await decrypt(row, encryptionSecret(env)); const definition = definitions[selectedProvider]; for (const [field, target] of Object.entries(definition.mapping)) { const value = text(payload[field]); if (value) (result as Record<string, unknown>)[target] = value; } } catch (error) { console.error(`Unable to decrypt ${selectedProvider} telephony credentials`, error); } } return result; }

export async function handleTelephonyProviderConfig(request: Request, env: UniversalTelephonyEnv, url: URL): Promise<Response | null> {
  if (!url.pathname.startsWith('/api/telephony/providers')) return null;
  const role = text(request.headers.get('x-amanat-auth-role')).toLowerCase();
  if (!['owner', 'administrator', 'super_admin'].includes(role)) return json({ error: 'Настройки телефонии доступны только владельцу или администратору' }, 403);
  const companyId = requireCompanyId(env);
  const scope = branchScope(env);
  if (url.pathname === '/api/telephony/providers' && request.method === 'GET') return json({ providers: (await rows(env)).map(summary), branchMode: scope.all ? 'all' : 'single' });
  if (scope.all || !scope.branchId) return json({ error: 'Для настройки телефонии выберите конкретный филиал', code: 'BRANCH_REQUIRED' }, 409);
  const branchId = requireBranchId(env);
  const selectedProvider = provider(url.pathname.split('/').pop());
  if (!selectedProvider) return null;
  const existing = (await db<Row[]>(env, `integration_credentials?company_id=eq.${encodeURIComponent(companyId)}&branch_id=eq.${encodeURIComponent(branchId)}&user_id=is.null&provider=eq.${selectedProvider}&select=*&limit=1`))[0] || null;
  if (request.method === 'GET') { if (!existing) return json({ provider: { provider: selectedProvider, branchId, configured: false, active: false }, webhookUrl: null }); let secret = ''; if (isCloudProvider(selectedProvider)) try { secret = text((await decrypt(existing, encryptionSecret(env))).webhookSecret); } catch { secret = ''; } return json({ provider: summary(existing), webhookUrl: webhookUrl(env, selectedProvider, companyId, branchId, secret) }); }
  if (request.method === 'DELETE') { await db(env, `integration_credentials?company_id=eq.${encodeURIComponent(companyId)}&branch_id=eq.${encodeURIComponent(branchId)}&user_id=is.null&provider=eq.${selectedProvider}`, { method: 'DELETE', headers: { prefer: 'return=minimal' } }); return json({ ok: true, provider: selectedProvider }); }
  if (request.method !== 'PUT') return json({ error: 'Method not allowed' }, 405);
  const incoming = rec(await request.json().catch(() => ({})));
  const definition = definitions[selectedProvider]; let payload: Row = {};
  if (existing) try { payload = await decrypt(existing, encryptionSecret(env)); } catch { payload = {}; }
  for (const field of Object.keys(definition.mapping)) { const value = text(incoming[field]); if (value) payload[field] = value; else if (!definition.secrets.includes(field) && field in incoming) payload[field] = incoming[field]; }
  if (isCloudProvider(selectedProvider) && (!text(payload.webhookSecret) || incoming.rotateWebhookSecret === true)) payload.webhookSecret = randomSecret();
  const missing = definition.required.filter((field) => !text(payload[field])); if (missing.length) return json({ error: `Заполните обязательные поля: ${missing.join(', ')}` }, 400);
  const method = text(payload.outboundMethod).toUpperCase();
  if (method && !['GET', 'POST'].includes(method)) return json({ error: 'outboundMethod должен быть GET или POST' }, 400);
  if (text(payload.outboundUrlTemplate) && !text(payload.outboundUrlTemplate).includes('{phone}')) return json({ error: 'URL исходящего звонка должен содержать плейсхолдер {phone}' }, 400);
  const sealed = await encrypt(payload, encryptionSecret(env)); const values: Record<string, string> = {}; const secretFields: Record<string, boolean> = {};
  for (const field of Object.keys(definition.mapping)) { if (definition.secrets.includes(field)) secretFields[field] = Boolean(text(payload[field])); else values[field] = text(payload[field]); }
  const existingSummary = rec(existing?.config_summary);
  const active = incoming.activate === true ? true : existingSummary.active === true;
  const stored = { provider: selectedProvider, company_id: companyId, branch_id: branchId, user_id: null, ...sealed, config_summary: { values, secretFields, active }, status: existing?.status === 'connected' ? 'connected' : 'configured', last_error: null, updated_at: new Date().toISOString() };
  const saved = existing?.id ? await db<Row[]>(env, `integration_credentials?id=eq.${encodeURIComponent(text(existing.id))}&company_id=eq.${encodeURIComponent(companyId)}&branch_id=eq.${encodeURIComponent(branchId)}`, { method: 'PATCH', headers: { prefer: 'return=representation' }, body: JSON.stringify(stored) }) : await db<Row[]>(env, 'integration_credentials', { method: 'POST', headers: { prefer: 'return=representation' }, body: JSON.stringify(stored) });
  if (incoming.activate === true && isCloudProvider(selectedProvider)) await deactivateOtherCloudProviders(env, companyId, branchId, selectedProvider);
  if (incoming.activate === true && !isCloudProvider(selectedProvider)) await db(env, `telephony_settings?company_id=eq.${encodeURIComponent(companyId)}`, { method: 'PATCH', body: JSON.stringify({ provider: selectedProvider, updated_at: new Date().toISOString() }) });
  return json({ ok: true, provider: summary(saved[0] || stored), active, webhookUrl: webhookUrl(env, selectedProvider, companyId, branchId, text(payload.webhookSecret)) });
}
