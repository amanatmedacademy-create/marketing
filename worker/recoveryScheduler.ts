import type { Env } from './integrations';
import { runRecoveryForCurrentCompany, type RecoveryEnv } from './recoveryEngine';

type Row = Record<string, unknown>;

type RecoverySchedulerEnv = Env & RecoveryEnv;

function headers(env: Env): Headers {
  const next = new Headers();
  next.set('apikey', env.SUPABASE_SERVICE_ROLE_KEY);
  next.set('authorization', `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`);
  next.set('accept', 'application/json');
  return next;
}

async function db<T>(env: Env, path: string): Promise<T> {
  const response = await fetch(`${env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/${path}`, {
    headers: headers(env),
    cache: 'no-store',
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`Recovery Scheduler DB ${response.status}: ${body.slice(0, 1200)}`);
  return (body ? JSON.parse(body) : null) as T;
}

export async function runScheduledRecovery(env: RecoverySchedulerEnv): Promise<Array<Record<string, unknown>>> {
  const rows = await db<Row[]>(env, 'growth_recovery_settings?enabled=eq.true&select=company_id&order=company_id.asc&limit=1000');
  const results: Array<Record<string, unknown>> = [];
  for (const row of rows) {
    const companyId = typeof row.company_id === 'string' ? row.company_id.trim() : '';
    if (!companyId) continue;
    try {
      const result = await runRecoveryForCurrentCompany({ ...env, CURRENT_COMPANY_ID: companyId });
      results.push({ companyId, ok: true, ...result });
    } catch (error) {
      results.push({ companyId, ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return results;
}
