import type { UniversalTelephonyEnv } from './telephonyGateway';
import { activeBranchCloudTelephonyProvider, loadTelephonyProviderCredential, type CloudTelephonyProvider } from './telephonyProviderCredentials';
import { requireBranchId, requireCompanyId } from './tenantScope';

type Row = Record<string, unknown>;
type CloudProvider = CloudTelephonyProvider;

const text = (value: unknown) => typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim();
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
function headers(env: UniversalTelephonyEnv) { return { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, accept: 'application/json' }; }
async function activeProvider(env: UniversalTelephonyEnv, companyId: string, branchId: string): Promise<CloudProvider | null> {
  const branchProvider = await activeBranchCloudTelephonyProvider(env, companyId, branchId);
  if (branchProvider) return branchProvider;
  const response = await fetch(`${env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/telephony_settings?company_id=eq.${encodeURIComponent(companyId)}&select=provider&limit=1`, { headers: headers(env), cache: 'no-store' });
  if (!response.ok) return null;
  const rows = await response.json() as Row[];
  const provider = text(rows[0]?.provider).toLowerCase();
  return provider === 'binotel' || provider === 'sipuni' ? provider : null;
}
function normalizePhone(value: unknown): string {
  let digits = text(value).replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('8')) digits = `7${digits.slice(1)}`;
  if (digits.length === 10) digits = `7${digits}`;
  return digits.length >= 10 ? digits.slice(0, 15) : '';
}
function privateHostname(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.local')) return true;
  if (/^(127\.|0\.|10\.|192\.168\.)/.test(host)) return true;
  const match = host.match(/^172\.(\d+)\./);
  return Boolean(match && Number(match[1]) >= 16 && Number(match[1]) <= 31);
}
function replaceTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\{(phone|userId|apiKey|apiSecret|companyId|branchId)\}/g, (_, key: string) => encodeURIComponent(values[key] || ''));
}
function outboundReady(payload: Row): boolean {
  return Boolean(text(payload.outboundUrlTemplate));
}
function capabilities(provider: CloudProvider, payload?: Row): string[] {
  const common = ['inbound', 'outbound_events', 'call_history', 'missed_calls', 'recording_archive', 'transcription', 'call_analytics'];
  const realtime = provider === 'sipuni' ? 'realtime_http_events' : 'webhook_events';
  return outboundReady(payload || {}) ? [...common, realtime, 'outbound_callback'] : [...common, realtime];
}
async function startOutbound(request: Request, provider: CloudProvider, companyId: string, branchId: string, credential: { row: Row; payload: Row } | null): Promise<Response> {
  if (!credential) return json({ error: `${provider === 'sipuni' ? 'Sipuni' : 'Binotel'} не настроен для филиала` }, 400);
  const body = await request.json().catch(() => ({})) as Row;
  const phone = normalizePhone(body.phone);
  if (!phone) return json({ error: 'Некорректный номер телефона' }, 400);
  const template = text(credential.payload.outboundUrlTemplate);
  if (!template) return json({ error: `Для ${provider === 'sipuni' ? 'Sipuni' : 'Binotel'} не настроен URL исходящего вызова. Укажите его в настройках интеграции.`, provider, code: 'PROVIDER_OUTBOUND_NOT_CONFIGURED' }, 409);
  const values = {
    phone,
    userId: text(credential.payload.userId),
    apiKey: text(credential.payload.apiKey),
    apiSecret: text(credential.payload.apiSecret),
    companyId,
    branchId,
  };
  let target: URL;
  try { target = new URL(replaceTemplate(template, values)); }
  catch { return json({ error: 'Некорректный URL исходящего вызова' }, 400); }
  if (target.protocol !== 'https:' || privateHostname(target.hostname)) return json({ error: 'URL исходящего вызова должен быть публичным HTTPS адресом' }, 400);
  const method = text(credential.payload.outboundMethod).toUpperCase() === 'POST' ? 'POST' : 'GET';
  const response = await fetch(target.toString(), { method, headers: { accept: 'application/json, text/plain;q=0.9, */*;q=0.8' }, redirect: 'error' });
  const raw = await response.text();
  if (!response.ok) return json({ error: `${provider === 'sipuni' ? 'Sipuni' : 'Binotel'} callback HTTP ${response.status}: ${raw.slice(0, 500)}`, provider }, 502);
  let result: unknown = raw;
  try { result = raw ? JSON.parse(raw) : {}; } catch { /* provider returned text */ }
  return json({ ok: true, provider, mode: 'callback', phone: `+${phone}`, branchId, result });
}

export async function handleCloudTelephonyStatus(request: Request, env: UniversalTelephonyEnv, url: URL): Promise<Response | null> {
  if (!['/api/telephony/status', '/api/telephony/test', '/api/telephony/start', '/api/telephony/calls'].includes(url.pathname)) return null;
  const companyId = requireCompanyId(env); let branchId = '';
  try { branchId = requireBranchId(env); } catch { return json({ error: 'Для телефонии выберите конкретный филиал', code: 'BRANCH_REQUIRED' }, 409); }
  const provider = await activeProvider(env, companyId, branchId); if (!provider) return null;
  const credential = await loadTelephonyProviderCredential(env, provider, companyId, branchId);
  const configured = Boolean(credential), connected = credential?.row?.status === 'connected' && !credential?.row?.last_error;
  const outboundConfigured = outboundReady(credential?.payload || {});
  if (url.pathname === '/api/telephony/status' && request.method === 'GET') return json({ provider, providerLabel: provider === 'sipuni' ? 'Sipuni' : 'Binotel', configured, connected, extension: null, mode: outboundConfigured ? 'callback' : 'webhook', credentialScope: 'branch', branchId, capabilities: capabilities(provider, credential?.payload), lastVerifiedAt: credential?.row?.last_verified_at || null, lastError: credential?.row?.last_error || null, lines: configured ? [{ id: provider, name: provider === 'sipuni' ? 'Sipuni' : 'Binotel', provider, configured: true }] : [] });
  if (url.pathname === '/api/telephony/test' && request.method === 'POST') { if (!credential) return json({ error: `${provider === 'sipuni' ? 'Sipuni' : 'Binotel'} не настроен для филиала` }, 400); return json({ ok: true, provider, branchId, configured: true, connected, outboundConfigured, mode: outboundConfigured ? 'callback' : 'webhook', lastVerifiedAt: credential.row.last_verified_at || null }); }
  if ((url.pathname === '/api/telephony/start' || url.pathname === '/api/telephony/calls') && request.method === 'POST') return startOutbound(request, provider, companyId, branchId, credential);
  return null;
}
