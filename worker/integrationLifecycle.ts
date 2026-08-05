import { isFrontendAdmin } from './credentials';

type JsonRecord = Record<string, unknown>;

type LifecycleEnv = {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  FRONTEND_ADMIN_KEY?: string;
};

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});

const headers = (env: LifecycleEnv, extra: HeadersInit = {}): HeadersInit => ({
  apikey: env.SUPABASE_SERVICE_ROLE_KEY,
  authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
  'content-type': 'application/json',
  ...extra,
});

async function rest(env: LifecycleEnv, path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/${path}`, {
    ...init,
    headers: headers(env, init.headers),
  });
}

async function readJson(response: Response): Promise<unknown> {
  const body = await response.text();
  if (!response.ok) throw new Error(`Supabase ${response.status}: ${body}`);
  return body ? JSON.parse(body) : null;
}

function providerPlatform(provider: string): string | null {
  if (provider === 'meta') return 'Meta';
  if (provider === 'tiktok') return 'TikTok';
  return null;
}

async function connectedAdvertisingPlatforms(env: LifecycleEnv): Promise<Set<string>> {
  const response = await rest(env, 'integration_credentials?user_id=is.null&status=eq.connected&provider=in.(meta,tiktok)&select=provider');
  const rows = await readJson(response) as Array<{ provider?: string }>;
  return new Set(rows.map((row) => providerPlatform(String(row.provider || ''))).filter((value): value is string => Boolean(value)));
}

function isAdvertisingPlatform(value: unknown): boolean {
  const platform = String(value || '').toLowerCase();
  return platform === 'meta' || platform === 'tiktok';
}

function allowedMetricRow(row: JsonRecord, connected: Set<string>): boolean {
  const platform = String(row.platform || '');
  if (!isAdvertisingPlatform(platform)) return true;
  return [...connected].some((item) => item.toLowerCase() === platform.toLowerCase());
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function readDateFilter(url: URL, key: 'from' | 'to'): string | null {
  const value = url.searchParams.get(key);
  if (!value) return null;
  if (!ISO_DATE.test(value)) throw new Error(`Некорректный параметр ${key}. Ожидается YYYY-MM-DD`);
  return value;
}

async function visibleDailyMetrics(env: LifecycleEnv, url?: URL): Promise<JsonRecord[]> {
  const connected = await connectedAdvertisingPlatforms(env);
  const params = new URLSearchParams({
    select: 'date,source,platform,leads,target_leads,arrived,sales,spend,revenue',
    order: 'date.asc',
  });
  if (url) {
    const from = readDateFilter(url, 'from');
    const to = readDateFilter(url, 'to');
    if (from) params.append('date', `gte.${from}`);
    if (to) params.append('date', `lte.${to}`);
  }
  const response = await rest(env, `marketing_daily_metrics?${params.toString()}`);
  const rows = await readJson(response) as JsonRecord[];
  return rows.filter((row) => allowedMetricRow(row, connected));
}

function numeric(row: JsonRecord, key: string): number {
  return Number(row[key] || 0);
}

async function handleDashboard(env: LifecycleEnv, url: URL): Promise<Response> {
  const grouped = new Map<string, JsonRecord>();
  for (const row of await visibleDailyMetrics(env, url)) {
    const date = String(row.date || '');
    const current = grouped.get(date) || { date, leads: 0, target_leads: 0, arrived: 0, sales: 0, spend: 0, revenue: 0 };
    current.leads = numeric(current, 'leads') + numeric(row, 'leads');
    current.target_leads = numeric(current, 'target_leads') + numeric(row, 'target_leads');
    current.arrived = numeric(current, 'arrived') + numeric(row, 'arrived');
    current.sales = numeric(current, 'sales') + numeric(row, 'sales');
    current.spend = numeric(current, 'spend') + numeric(row, 'spend');
    current.revenue = numeric(current, 'revenue') + numeric(row, 'revenue');
    grouped.set(date, current);
  }
  return json([...grouped.values()].sort((a, b) => String(a.date).localeCompare(String(b.date))));
}

async function handleSources(env: LifecycleEnv): Promise<Response> {
  const grouped = new Map<string, JsonRecord>();
  for (const row of await visibleDailyMetrics(env)) {
    const source = String(row.source || 'Не определено');
    const platform = String(row.platform || 'Не определено');
    const key = `${source}\u0000${platform}`;
    const current = grouped.get(key) || { source, platform, leads: 0, target_leads: 0, arrived: 0, sales: 0, spend: 0, revenue: 0 };
    current.leads = numeric(current, 'leads') + numeric(row, 'leads');
    current.target_leads = numeric(current, 'target_leads') + numeric(row, 'target_leads');
    current.arrived = numeric(current, 'arrived') + numeric(row, 'arrived');
    current.sales = numeric(current, 'sales') + numeric(row, 'sales');
    current.spend = numeric(current, 'spend') + numeric(row, 'spend');
    current.revenue = numeric(current, 'revenue') + numeric(row, 'revenue');
    grouped.set(key, current);
  }
  return json([...grouped.values()].sort((a, b) => numeric(b, 'revenue') - numeric(a, 'revenue')));
}

async function handleAds(env: LifecycleEnv): Promise<Response> {
  const connected = await connectedAdvertisingPlatforms(env);
  if (!connected.size) return json([]);
  const platforms = [...connected].map((item) => `\"${item}\"`).join(',');
  const summary = await rest(env, `marketing_ads_summary?select=*&platform=in.(${platforms})&order=revenue.desc`);
  if (summary.ok) return new Response(await summary.text(), { status: 200, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
  const fallback = await rest(env, `marketing_ads?select=row_key:id,*&platform=in.(${platforms})&order=report_date.desc,revenue.desc`);
  return new Response(await fallback.text(), { status: fallback.status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
}

async function handleCurrencies(env: LifecycleEnv): Promise<Response> {
  const connected = await connectedAdvertisingPlatforms(env);
  if (!connected.size) return json({ accounts: [] });
  const platforms = [...connected].map((item) => `\"${item}\"`).join(',');
  const response = await rest(env, `marketing_ads?select=platform,account_id,account_name,currency&platform=in.(${platforms})&account_id=not.is.null`);
  const rows = await readJson(response) as JsonRecord[];
  const unique = new Map<string, JsonRecord>();
  for (const row of rows) {
    const key = `${row.platform}:${row.account_id}`;
    if (!unique.has(key)) unique.set(key, row);
  }
  return json({ accounts: [...unique.values()] });
}

async function disconnectProvider(request: Request, env: LifecycleEnv, url: URL): Promise<Response> {
  if (!isFrontendAdmin(request, env)) return json({ error: 'Настройки интеграций доступны только администратору' }, 403);

  const provider = url.pathname.split('/').pop()?.toLowerCase() || '';
  if (!['bitrix', 'meta', 'tiktok', 'n8n'].includes(provider)) return json({ error: 'Неизвестная интеграция' }, 404);
  const purge = url.searchParams.get('purge') === 'true';
  let dataResult: unknown = null;
  let warning: string | null = null;

  if (provider === 'meta' || provider === 'tiktok') {
    const rpc = await rest(env, 'rpc/manage_ad_provider_data', {
      method: 'POST',
      body: JSON.stringify({ p_provider: provider, p_purge: purge }),
    });
    if (rpc.ok) {
      dataResult = await readJson(rpc);
    } else {
      const details = await rpc.text();
      if (purge) return json({ error: `Не удалось удалить данные ${provider}: ${rpc.status} ${details}` }, 502);
      warning = `Реквизиты отключены, но архивирование данных не выполнено: ${rpc.status} ${details}`;
    }
  }

  const deleted = await rest(env, `integration_credentials?user_id=is.null&provider=eq.${encodeURIComponent(provider)}`, {
    method: 'DELETE',
    headers: { prefer: 'return=minimal' },
  });
  await readJson(deleted);

  return json({ ok: true, provider, mode: purge ? 'purged' : 'archived', data: dataResult, warning });
}

export async function handleIntegrationLifecycle(request: Request, env: LifecycleEnv, url: URL): Promise<Response | null> {
  if (request.method === 'DELETE' && url.pathname.startsWith('/api/integrations/config/')) return disconnectProvider(request, env, url);
  if (request.method !== 'GET') return null;
  if (url.pathname === '/api/dashboard') {
    try { return await handleDashboard(env, url); }
    catch (error) { return json({ error: error instanceof Error ? error.message : String(error) }, 400); }
  }
  if (url.pathname === '/api/sources') return handleSources(env);
  if (url.pathname === '/api/ads') return handleAds(env);
  if (url.pathname === '/api/ads/currencies') return handleCurrencies(env);
  return null;
}
