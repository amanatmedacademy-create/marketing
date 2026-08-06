import { resolveCompanyId } from './companyContext';

type JsonRecord = Record<string, unknown>;

export interface MetaSelectionEnv {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  DEFAULT_COMPANY_ID?: string;
}

interface CredentialRow {
  id: string;
  config_summary?: JsonRecord;
}

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});
const record = (value: unknown): JsonRecord => value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {};
const text = (value: unknown): string => typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim();
const accountGraphId = (value: string): string => value.startsWith('act_') ? value : `act_${value}`;
const accountDbId = (value: string): string => value.replace(/^act_/, '');

async function supabase<T>(env: MetaSelectionEnv, path: string, init: RequestInit = {}): Promise<T> {
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
  if (!response.ok) throw new Error(`Meta selection Supabase: ${response.status} ${body}`);
  return (body ? JSON.parse(body) : null) as T;
}

function stringList(value: unknown, normalize: (item: string) => string): string[] {
  const items = Array.isArray(value) ? value : text(value).split(',');
  return [...new Set(items.map(text).map(normalize).filter(Boolean))];
}

export async function handleMetaSelectionRequest(request: Request, env: MetaSelectionEnv, url: URL): Promise<Response | null> {
  if (url.pathname !== '/api/integrations/meta/selection' || request.method !== 'POST') return null;
  try {
    const companyId = await resolveCompanyId(env);
    const rows = await supabase<CredentialRow[]>(env, `integration_credentials?company_id=eq.${encodeURIComponent(companyId)}&user_id=is.null&provider=eq.meta&select=id,config_summary&limit=1`);
    const credential = rows[0];
    if (!credential) return json({ error: 'Подключение Meta не найдено' }, 404);

    const body = record(await request.json().catch(() => ({})));
    const selectedAccountIds = stringList(body.selectedAccountIds, accountGraphId).filter((id) => /^act_\d+$/.test(id)).slice(0, 1000);
    const selectedAdIds = stringList(body.selectedAdIds, (value) => value).filter((id) => /^\d+$/.test(id)).slice(0, 5000);
    if (!selectedAccountIds.length) return json({ error: 'Выберите хотя бы один рекламный кабинет' }, 400);

    const summary = record(credential.config_summary);
    const values = record(summary.values);
    const secretFields = record(summary.secretFields);
    const verified = body.verified === true;

    await supabase<unknown>(env, `integration_credentials?id=eq.${encodeURIComponent(credential.id)}`, {
      method: 'PATCH',
      headers: { prefer: 'return=minimal' },
      body: JSON.stringify({
        config_summary: {
          ...summary,
          values: {
            ...values,
            adAccountIds: selectedAccountIds.join(','),
            selectedAdIds: selectedAdIds.join(','),
          },
          secretFields,
        },
        status: verified ? 'connected' : 'configured',
        last_verified_at: verified ? new Date().toISOString() : null,
        last_error: null,
        updated_at: new Date().toISOString(),
      }),
    });

    if (body.prune !== false) {
      const dbAccountIds = selectedAccountIds.map(accountDbId);
      await supabase<unknown>(env, `marketing_ads?company_id=eq.${encodeURIComponent(companyId)}&platform=eq.Meta&account_id=not.in.(${dbAccountIds.join(',')})`, { method: 'DELETE', headers: { prefer: 'return=minimal' } });
      if (selectedAdIds.length) {
        await supabase<unknown>(env, `marketing_ads?company_id=eq.${encodeURIComponent(companyId)}&platform=eq.Meta&account_id=in.(${dbAccountIds.join(',')})&ad_id=not.in.(${selectedAdIds.join(',')})`, { method: 'DELETE', headers: { prefer: 'return=minimal' } });
      }
      await supabase<unknown>(env, 'rpc/refresh_meta_daily_metrics', {
        method: 'POST',
        headers: { prefer: 'return=minimal' },
        body: JSON.stringify({ p_company_id: companyId }),
      });
    }

    return json({
      ok: true,
      selectedAccountIds,
      selectedAdIds,
      creativeSelectionMode: selectedAdIds.length ? 'selected' : 'all',
      verified,
    });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 400);
  }
}
