import { requireCompanyId } from './tenantScope';

type Row = Record<string, unknown>;

type Env = {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  CURRENT_COMPANY_ID?: string;
  DEFAULT_COMPANY_ID?: string;
};

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});

function headers(env: Env): HeadersInit {
  return {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    accept: 'application/json',
  };
}

async function db<T>(env: Env, path: string): Promise<T> {
  const response = await fetch(`${env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/${path}`, { headers: headers(env), cache: 'no-store' });
  const body = await response.text();
  if (!response.ok) throw new Error(`Advertising connections ${response.status}: ${body.slice(0, 900)}`);
  return (body ? JSON.parse(body) : null) as T;
}

const record = (value: unknown): Row => value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {};
const text = (value: unknown): string => typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim();

function safeCredential(row: Row) {
  const summary = record(row.config_summary);
  const values = record(summary.values);
  const secretFields = record(summary.secretFields);
  return {
    provider: text(row.provider),
    configured: true,
    status: text(row.status) || 'configured',
    values,
    secretFields,
    updatedAt: row.updated_at || null,
    lastVerifiedAt: row.last_verified_at || null,
    lastError: row.last_error || null,
  };
}

export async function handleAdvertisingConnections(request: Request, env: Env, url: URL): Promise<Response | null> {
  if (url.pathname !== '/api/ads/connections') return null;
  if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405);

  try {
    const companyId = requireCompanyId(env);
    const providerFilter = encodeURIComponent('meta,tiktok,google_ads,yandex');
    const [credentials, runs] = await Promise.all([
      db<Row[]>(env, `integration_credentials?company_id=eq.${encodeURIComponent(companyId)}&user_id=is.null&provider=in.(${providerFilter})&select=provider,config_summary,status,last_error,last_verified_at,updated_at&order=provider.asc`),
      db<Row[]>(env, `integration_runs?company_id=eq.${encodeURIComponent(companyId)}&source=in.(${providerFilter})&select=source,status,fetched,written,error,started_at,finished_at&order=started_at.desc&limit=40`).catch(() => []),
    ]);

    const latestRuns = new Map<string, Row>();
    for (const run of runs) {
      const source = text(run.source);
      if (source && !latestRuns.has(source)) latestRuns.set(source, run);
    }

    return json({
      providers: credentials.map(safeCredential),
      runs: [...latestRuns.values()].map((run) => ({
        source: text(run.source),
        status: text(run.status),
        fetched: Number(run.fetched || 0),
        written: Number(run.written || 0),
        error: run.error || null,
        started_at: run.started_at || null,
        finished_at: run.finished_at || null,
      })),
    });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
}
