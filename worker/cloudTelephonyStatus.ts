import type { UniversalTelephonyEnv } from './telephonyGateway';
import { loadTelephonyProviderCredential, markTelephonyProviderStatus } from './telephonyProviderCredentials';
import { requireCompanyId } from './tenantScope';

type Row = Record<string, unknown>;
type CloudProvider = 'binotel' | 'sipuni';

const text = (value: unknown) => typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim();
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
function headers(env: UniversalTelephonyEnv) { return { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, accept: 'application/json' }; }
async function activeProvider(env: UniversalTelephonyEnv): Promise<CloudProvider | null> {
  const companyId = requireCompanyId(env);
  const response = await fetch(`${env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/telephony_settings?company_id=eq.${encodeURIComponent(companyId)}&select=provider&limit=1`, { headers: headers(env), cache: 'no-store' });
  if (!response.ok) return null;
  const rows = await response.json() as Row[];
  const provider = text(rows[0]?.provider).toLowerCase();
  return provider === 'binotel' || provider === 'sipuni' ? provider : null;
}

function capabilities(provider: CloudProvider): string[] {
  const common = ['inbound', 'outbound_events', 'call_history', 'missed_calls', 'recording_archive', 'transcription', 'call_analytics'];
  return provider === 'sipuni' ? [...common, 'realtime_http_events'] : [...common, 'webhook_events'];
}

export async function handleCloudTelephonyStatus(request: Request, env: UniversalTelephonyEnv, url: URL): Promise<Response | null> {
  if (!['/api/telephony/status', '/api/telephony/test', '/api/telephony/start'].includes(url.pathname)) return null;
  const provider = await activeProvider(env);
  if (!provider) return null;
  const companyId = requireCompanyId(env);
  const credential = await loadTelephonyProviderCredential(env, provider);
  const configured = Boolean(credential);
  const connected = credential?.row?.status === 'connected' && !credential?.row?.last_error;

  if (url.pathname === '/api/telephony/status' && request.method === 'GET') {
    return json({
      provider,
      providerLabel: provider === 'sipuni' ? 'Sipuni' : 'Binotel',
      configured,
      connected,
      credentialScope: 'organization',
      capabilities: capabilities(provider),
      lastVerifiedAt: credential?.row?.last_verified_at || null,
      lastError: credential?.row?.last_error || null,
    });
  }

  if (url.pathname === '/api/telephony/test' && request.method === 'POST') {
    if (!credential) return json({ error: `${provider === 'sipuni' ? 'Sipuni' : 'Binotel'} не настроен` }, 400);
    // Webhook-based cloud telephony is considered connected after the provider
    // delivers a signed tenant-scoped event. Until then credentials are configured.
    return json({ ok: true, provider, configured: true, connected, mode: 'webhook', lastVerifiedAt: credential.row.last_verified_at || null });
  }

  if (url.pathname === '/api/telephony/start' && request.method === 'POST') {
    return json({
      error: provider === 'binotel'
        ? 'Исходящий Binotel click-to-call будет включён после подтверждения REST endpoint вашего Binotel API.'
        : 'Исходящий Sipuni callback будет включён отдельным API-адаптером; события и история уже принимаются через webhook.',
      provider,
      code: 'PROVIDER_OUTBOUND_NOT_CONFIGURED',
    }, 409);
  }

  return null;
}

export async function markCloudTelephonyWebhookHealthy(env: UniversalTelephonyEnv, companyId: string, provider: CloudProvider): Promise<void> {
  await markTelephonyProviderStatus(env, companyId, provider, true).catch((error) => console.error(`${provider} status update failed`, error));
}
