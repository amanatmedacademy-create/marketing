import { resolveCompanyId, type PlatformRole } from './companyContext';
import { localDataJson, type LocalDataEnv } from './localData';

type Row = Record<string, unknown>;
type HealthStatus = 'connected' | 'warning' | 'error' | 'not_configured';
type HealthItem = {
  provider: string;
  label: string;
  status: HealthStatus;
  rawStatus: string | null;
  lastError: string | null;
  lastVerifiedAt: unknown;
  updatedAt: unknown;
  expiresAt: string | null;
};
export interface NotificationCenterEnv extends LocalDataEnv { CURRENT_COMPANY_ID?: string; DEFAULT_COMPANY_ID?: string }
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
const text = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
async function db<T>(env: NotificationCenterEnv, path: string, init: RequestInit = {}): Promise<T> { return localDataJson<T>(env, path, init, 'Notification center'); }

async function memberRole(env: NotificationCenterEnv, companyId: string, userId: string, platformRole?: PlatformRole) {
  if (platformRole === 'super_admin') return 'super_admin';
  const rows = await db<Row[]>(env, `crm_company_members?company_id=eq.${companyId}&user_id=eq.${userId}&status=eq.active&select=role&limit=1`);
  return text(rows[0]?.role);
}

async function createOnce(env: NotificationCenterEnv, row: { company_id: string; user_id: string; type: string; severity: string; title: string; body?: string; action_url?: string; dedupe_key: string; metadata?: Row }) {
  const found = await db<Row[]>(env, `crm_notifications?company_id=eq.${row.company_id}&user_id=eq.${row.user_id}&dedupe_key=eq.${encodeURIComponent(row.dedupe_key)}&select=id&limit=1`);
  if (found.length) return;
  await db(env, 'crm_notifications', { method: 'POST', headers: { prefer: 'return=minimal' }, body: JSON.stringify({ ...row, metadata: row.metadata || {} }) });
}

async function syncAlerts(env: NotificationCenterEnv, companyId: string, userId: string, platformRole?: PlatformRole) {
  const role = await memberRole(env, companyId, userId, platformRole);
  const admin = role === 'super_admin' || role === 'owner' || role === 'administrator';
  if (admin) {
    const pending = await db<Row[]>(env, `crm_company_onboarding?company_id=eq.${companyId}&status=eq.pending_approval&select=id,full_name,submitted_at&order=submitted_at.desc&limit=50`);
    for (const item of pending) await createOnce(env, {
      company_id: companyId, user_id: userId, type: 'team.join_request', severity: 'info',
      title: 'Новая заявка сотрудника', body: `${text(item.full_name) || 'Пользователь'} ожидает подтверждения доступа.`, action_url: '/settings?tab=users', dedupe_key: `onboarding:${text(item.id)}`,
    });

    const credentials = await db<Row[]>(env, `integration_credentials?company_id=eq.${companyId}&user_id=is.null&select=provider,status,last_error,updated_at&limit=100`).catch(() => [] as Row[]);
    for (const item of credentials) {
      const status = text(item.status).toLowerCase();
      if (!['error','disconnected','failed'].includes(status)) continue;
      const provider = text(item.provider) || 'integration';
      await createOnce(env, {
        company_id: companyId, user_id: userId, type: 'integration.error', severity: 'error',
        title: `Ошибка интеграции: ${provider}`, body: text(item.last_error) || 'Интеграция требует внимания.', action_url: '/integrations',
        dedupe_key: `integration:${provider}:${text(item.updated_at) || status}`, metadata: { provider, status },
      });
    }
  }

  const trial = await db<Row>(env, 'rpc/imds_marketing_trial_state', { method: 'POST', body: JSON.stringify({ target_company_id: companyId }) }).catch(() => null as unknown as Row);
  const status = text(trial?.status);
  const trialEnds = text(trial?.trialEndsAt || trial?.trial_ends_at);
  const remaining = trialEnds ? Date.parse(trialEnds) - Date.now() : Number.POSITIVE_INFINITY;
  if (status === 'trial' && remaining > 0 && remaining <= 24 * 60 * 60 * 1000) {
    await createOnce(env, { company_id: companyId, user_id: userId, type: 'billing.trial_ending', severity: 'warning', title: 'Trial заканчивается', body: `Пробный доступ BELES завершится ${new Date(trialEnds).toLocaleString('ru-RU')}.`, action_url: '/settings?tab=subscription', dedupe_key: `trial:${trialEnds}` });
  }
}

function normalizeHealth(provider: string, row?: Row) {
  const raw = text(row?.status).toLowerCase();
  let status: HealthStatus = 'not_configured';
  if (raw === 'connected' || raw === 'active' || raw === 'verified') status = 'connected';
  else if (raw === 'error' || raw === 'failed' || raw === 'disconnected') status = 'error';
  else if (row) status = 'warning';
  const summary = row?.config_summary && typeof row.config_summary === 'object' ? row.config_summary as Row : {};
  const expiresAt = text(summary.tokenExpiresAt || summary.token_expires_at || summary.expiresAt || summary.expires_at);
  if (status === 'connected' && expiresAt) {
    const remaining = Date.parse(expiresAt) - Date.now();
    if (Number.isFinite(remaining) && remaining > 0 && remaining <= 7 * 24 * 60 * 60 * 1000) status = 'warning';
  }
  return { provider, status, rawStatus: raw || null, lastError: text(row?.last_error) || null, lastVerifiedAt: row?.last_verified_at || null, updatedAt: row?.updated_at || null, expiresAt: expiresAt || null };
}

export async function handleNotificationCenterRequest(request: Request, env: NotificationCenterEnv, url: URL, userId: string, platformRole?: PlatformRole): Promise<Response | null> {
  if (!url.pathname.startsWith('/api/notifications') && url.pathname !== '/api/system-health') return null;
  try {
    const companyId = await resolveCompanyId(env, userId, platformRole);
    if (url.pathname === '/api/system-health' && request.method === 'GET') {
      const rows = await db<Row[]>(env, `integration_credentials?company_id=eq.${companyId}&user_id=is.null&select=provider,status,last_error,last_verified_at,updated_at,config_summary&limit=100`).catch(() => [] as Row[]);
      const map = new Map(rows.map((row) => [text(row.provider), row]));
      const definitions = [
        ['waba','WhatsApp Business'], ['zadarma','Телефония'], ['meta','Meta Ads'], ['google','Google'], ['mis','МИС'],
      ] as const;
      const items: HealthItem[] = definitions.map(([provider, label]) => ({ label, ...normalizeHealth(provider, map.get(provider)) }));
      for (const row of rows) if (!definitions.some(([provider]) => provider === text(row.provider))) items.push({ label: text(row.provider), ...normalizeHealth(text(row.provider), row) });
      return json({ companyId, items, healthy: items.filter((item) => item.status === 'connected').length, issues: items.filter((item) => item.status === 'error' || item.status === 'warning').length });
    }

    if (url.pathname === '/api/notifications' && request.method === 'GET') {
      await syncAlerts(env, companyId, userId, platformRole);
      const unreadOnly = url.searchParams.get('unread') === 'true';
      const filter = unreadOnly ? '&read_at=is.null' : '';
      const items = await db<Row[]>(env, `crm_notifications?company_id=eq.${companyId}&user_id=eq.${userId}${filter}&select=*&order=created_at.desc&limit=60`);
      const unread = await db<Row[]>(env, `crm_notifications?company_id=eq.${companyId}&user_id=eq.${userId}&read_at=is.null&select=id&limit=200`);
      return json({ items, unreadCount: unread.length });
    }
    if (url.pathname === '/api/notifications/read-all' && request.method === 'POST') {
      await db(env, `crm_notifications?company_id=eq.${companyId}&user_id=eq.${userId}&read_at=is.null`, { method: 'PATCH', headers: { prefer: 'return=minimal' }, body: JSON.stringify({ read_at: new Date().toISOString(), updated_at: new Date().toISOString() }) });
      return json({ ok: true });
    }
    const match = url.pathname.match(/^\/api\/notifications\/([0-9a-f-]+)\/read$/i);
    if (match && request.method === 'POST') {
      await db(env, `crm_notifications?id=eq.${match[1]}&company_id=eq.${companyId}&user_id=eq.${userId}`, { method: 'PATCH', headers: { prefer: 'return=minimal' }, body: JSON.stringify({ read_at: new Date().toISOString(), updated_at: new Date().toISOString() }) });
      return json({ ok: true });
    }
    return json({ error: 'Method not allowed' }, 405);
  } catch (error) { return json({ error: error instanceof Error ? error.message : String(error) }, 500); }
}
