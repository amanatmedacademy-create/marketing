import { localDataJson, type LocalDataEnv } from './localData';
import { requireCompanyId, type TenantScopedEnv } from './tenantScope';

type QualityEnv = LocalDataEnv & TenantScopedEnv;
type Row = Record<string, unknown>;

type SyncItem = {
  source: string;
  status: string;
  started_at: string | null;
  finished_at: string | null;
  date_from: string | null;
  date_to: string | null;
  fetched: number;
  written: number;
  error: string | null;
};

type CredentialItem = {
  provider: string;
  status: string;
  last_verified_at: string | null;
  last_error: string | null;
  updated_at: string | null;
};

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});

const text = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
const num = (value: unknown): number => Number.isFinite(Number(value)) ? Number(value) : 0;

async function read<T>(env: QualityEnv, path: string, label: string): Promise<T> {
  return localDataJson<T>(env, path, {}, label);
}

function latestBySource(rows: Row[]): SyncItem[] {
  const found = new Set<string>();
  const result: SyncItem[] = [];
  for (const row of rows) {
    const source = text(row.source) || 'unknown';
    if (found.has(source)) continue;
    found.add(source);
    result.push({
      source,
      status: text(row.status) || 'unknown',
      started_at: text(row.started_at) || null,
      finished_at: text(row.finished_at) || null,
      date_from: text(row.date_from) || null,
      date_to: text(row.date_to) || null,
      fetched: num(row.fetched),
      written: num(row.written),
      error: text(row.error) || null,
    });
  }
  return result;
}

function credentials(rows: Row[]): CredentialItem[] {
  return rows.map((row) => ({
    provider: text(row.provider) || 'unknown',
    status: text(row.status) || 'unknown',
    last_verified_at: text(row.last_verified_at) || null,
    last_error: text(row.last_error) || null,
    updated_at: text(row.updated_at) || null,
  }));
}

export async function handleAnalyticsQuality(request: Request, env: QualityEnv, url: URL): Promise<Response | null> {
  if (url.pathname !== '/api/analytics/quality') return null;
  if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405);

  const companyId = requireCompanyId(env);
  const companyFilter = `company_id=eq.${encodeURIComponent(companyId)}`;
  const unavailable: string[] = [];

  const settled = await Promise.allSettled([
    read<Row[]>(env, `integration_runs?${companyFilter}&select=source,status,started_at,finished_at,date_from,date_to,fetched,written,error&order=started_at.desc&limit=100`, 'Analytics quality integration runs'),
    read<Row[]>(env, `integration_credentials?${companyFilter}&user_id=is.null&select=provider,status,last_verified_at,last_error,updated_at&order=provider.asc`, 'Analytics quality credentials'),
    read<Row[]>(env, `crm_companies?id=eq.${encodeURIComponent(companyId)}&select=timezone&limit=1`, 'Analytics quality clinic'),
    read<Row[]>(env, `marketing_leads?${companyFilter}&select=lead_created_at,updated_at,source&order=updated_at.desc.nullslast,lead_created_at.desc.nullslast&limit=1`, 'Analytics quality CRM freshness'),
    read<Row[]>(env, `marketing_ads?${companyFilter}&select=report_date,updated_at,platform&order=updated_at.desc.nullslast,report_date.desc&limit=1`, 'Analytics quality ads freshness'),
  ]);

  const value = (index: number, resource: string): Row[] => {
    const item = settled[index];
    if (item.status === 'fulfilled') return item.value;
    unavailable.push(resource);
    console.error(`[analytics-quality] ${resource}:`, item.reason);
    return [];
  };

  const runRows = value(0, 'integration_runs');
  const credentialRows = value(1, 'integration_credentials');
  const companyRows = value(2, 'crm_companies_timezone');
  const crmRows = value(3, 'marketing_leads_freshness');
  const adsRows = value(4, 'marketing_ads_freshness');

  const crm = crmRows[0] || {};
  const ads = adsRows[0] || {};

  return json({
    company_id: companyId,
    generated_at: new Date().toISOString(),
    timezone: text(companyRows[0]?.timezone) || 'Asia/Almaty',
    data_complete: unavailable.length === 0,
    unavailable,
    latest: {
      crm_at: text(crm.updated_at) || text(crm.lead_created_at) || null,
      crm_source: text(crm.source) || null,
      ads_at: text(ads.updated_at) || text(ads.report_date) || null,
      ads_platform: text(ads.platform) || null,
    },
    syncs: latestBySource(runRows),
    credentials: credentials(credentialRows),
  });
}
