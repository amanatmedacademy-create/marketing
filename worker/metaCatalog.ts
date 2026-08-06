import { resolveCompanyId } from './companyContext';

type JsonRecord = Record<string, unknown>;

export interface MetaCatalogEnv {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  DEFAULT_COMPANY_ID?: string;
  META_ACCESS_TOKEN?: string;
  META_AD_ACCOUNT_IDS?: string;
  META_GRAPH_VERSION?: string;
}

interface MetaAccount {
  id?: string;
  account_id?: string;
  name?: string;
  account_status?: string | number;
  currency?: string;
  timezone_name?: string;
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
const csv = (value: unknown): string[] => text(value).split(',').map((item) => item.trim()).filter(Boolean);
const graphVersion = (env: MetaCatalogEnv): string => {
  const version = text(env.META_GRAPH_VERSION) || 'v23.0';
  return version.startsWith('v') ? version : `v${version}`;
};
const accountGraphId = (value: string): string => value.startsWith('act_') ? value : `act_${value}`;
const accountDbId = (value: string): string => value.replace(/^act_/, '');
const safeMetaId = (value: string): boolean => /^\d+$/.test(value.replace(/^act_/, ''));

async function metaJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { headers: { accept: 'application/json' } });
  const body = await response.text();
  let payload: unknown = {};
  try { payload = body ? JSON.parse(body) : {}; } catch { payload = { error: { message: body } }; }
  if (!response.ok || record(payload).error) {
    const error = record(record(payload).error);
    throw new Error(text(error.message) || `Meta API: ${response.status}`);
  }
  return payload as T;
}

async function supabase<T>(env: MetaCatalogEnv, path: string, init: RequestInit = {}): Promise<T> {
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
  if (!response.ok) throw new Error(`Meta catalog Supabase: ${response.status} ${body}`);
  return (body ? JSON.parse(body) : null) as T;
}

function requireMeta(env: MetaCatalogEnv): { accessToken: string; version: string } {
  const accessToken = text(env.META_ACCESS_TOKEN);
  if (!accessToken) throw new Error('Meta access token не найден. Повторите OAuth-подключение.');
  return { accessToken, version: graphVersion(env) };
}

async function credentialRow(env: MetaCatalogEnv, companyId: string): Promise<CredentialRow> {
  const rows = await supabase<CredentialRow[]>(env, `integration_credentials?company_id=eq.${encodeURIComponent(companyId)}&user_id=is.null&provider=eq.meta&select=id,config_summary&limit=1`);
  if (!rows[0]) throw new Error('Подключение Meta не найдено');
  return rows[0];
}

async function listAccounts(env: MetaCatalogEnv): Promise<MetaAccount[]> {
  const { accessToken, version } = requireMeta(env);
  const accounts: MetaAccount[] = [];
  const params = new URLSearchParams({
    fields: 'id,account_id,name,account_status,currency,timezone_name',
    limit: '200',
    access_token: accessToken,
  });
  let next: string | undefined = `https://graph.facebook.com/${version}/me/adaccounts?${params}`;
  for (let page = 0; next && page < 20; page += 1) {
    const payload: { data?: MetaAccount[]; paging?: { next?: string } } = await metaJson(next);
    accounts.push(...(payload.data || []));
    next = payload.paging?.next;
  }
  return accounts;
}

async function creativeCount(env: MetaCatalogEnv, accountId: string): Promise<number> {
  const { accessToken, version } = requireMeta(env);
  const params = new URLSearchParams({ fields: 'id', limit: '1', summary: 'true', access_token: accessToken });
  try {
    const payload = await metaJson<{ summary?: { total_count?: number } }>(`https://graph.facebook.com/${version}/${accountGraphId(accountId)}/ads?${params}`);
    return Number(payload.summary?.total_count || 0);
  } catch (error) {
    console.error(`Unable to count Meta creatives for ${accountId}`, error);
    return 0;
  }
}

async function listCreatives(env: MetaCatalogEnv, accountId: string): Promise<JsonRecord[]> {
  const { accessToken, version } = requireMeta(env);
  const rows: JsonRecord[] = [];
  const params = new URLSearchParams({
    fields: 'id,name,status,effective_status,creative{id,name,title,thumbnail_url,image_url}',
    limit: '200',
    access_token: accessToken,
  });
  let next: string | undefined = `https://graph.facebook.com/${version}/${accountGraphId(accountId)}/ads?${params}`;
  for (let page = 0; next && page < 50; page += 1) {
    const payload: { data?: JsonRecord[]; paging?: { next?: string } } = await metaJson(next);
    rows.push(...(payload.data || []));
    next = payload.paging?.next;
    if (rows.length >= 5000) break;
  }
  return rows;
}

async function catalog(env: MetaCatalogEnv, url: URL): Promise<Response> {
  const companyId = await resolveCompanyId(env);
  const credential = await credentialRow(env, companyId);
  const summary = record(credential.config_summary);
  const values = record(summary.values);
  const selectedAccountIds = csv(values.adAccountIds || env.META_AD_ACCOUNT_IDS).map(accountGraphId);
  const selectedAdIds = csv(values.selectedAdIds).filter((id) => /^\d+$/.test(id));
  const accounts = await listAccounts(env);
  const requested = csv(url.searchParams.get('account_ids')).map(accountGraphId).filter(safeMetaId);
  const accessibleIds = new Set(accounts.map((account) => accountGraphId(text(account.id || account.account_id))).filter(safeMetaId));
  const requestedIds = requested.filter((id) => accessibleIds.has(id));

  const counts = await Promise.all(accounts.map(async (account) => {
    const id = accountGraphId(text(account.id || account.account_id));
    return [id, await creativeCount(env, id)] as const;
  }));
  const countMap = new Map(counts);

  const creatives = requestedIds.length
    ? (await Promise.all(requestedIds.map(async (accountId) => {
        const rows = await listCreatives(env, accountId);
        return rows.map((item) => {
          const creative = record(item.creative);
          return {
            id: text(item.id),
            accountId,
            name: text(item.name) || `Объявление ${text(item.id)}`,
            status: text(item.effective_status || item.status) || 'UNKNOWN',
            creativeId: text(creative.id) || null,
            creativeName: text(creative.name || creative.title) || null,
            thumbnailUrl: text(creative.thumbnail_url || creative.image_url) || null,
            selected: selectedAdIds.includes(text(item.id)),
          };
        });
      }))).flat()
    : [];

  return json({
    accounts: accounts.map((account) => {
      const id = accountGraphId(text(account.id || account.account_id));
      return {
        id,
        accountId: accountDbId(id),
        name: text(account.name) || id,
        status: text(account.account_status) || 'UNKNOWN',
        currency: text(account.currency) || null,
        timezone: text(account.timezone_name) || null,
        creativeCount: countMap.get(id) || 0,
        selected: selectedAccountIds.includes(id),
      };
    }),
    creatives,
    selectedAccountIds,
    selectedAdIds,
    creativeSelectionMode: selectedAdIds.length ? 'selected' : 'all',
  });
}

async function refreshMetaDailyMetrics(env: MetaCatalogEnv, companyId: string): Promise<void> {
  await supabase<unknown>(env, 'rpc/refresh_meta_daily_metrics', {
    method: 'POST',
    headers: { prefer: 'return=minimal' },
    body: JSON.stringify({ p_company_id: companyId }),
  });
}

async function deleteRows(env: MetaCatalogEnv, path: string): Promise<void> {
  await supabase<unknown>(env, path, { method: 'DELETE', headers: { prefer: 'return=minimal' } });
}

async function updateSelection(request: Request, env: MetaCatalogEnv): Promise<Response> {
  const companyId = await resolveCompanyId(env);
  const credential = await credentialRow(env, companyId);
  const body = record(await request.json().catch(() => ({})));
  const selectedAdIds = Array.isArray(body.selectedAdIds)
    ? body.selectedAdIds.map(text).filter((id) => /^\d+$/.test(id)).slice(0, 5000)
    : csv(body.selectedAdIds).filter((id) => /^\d+$/.test(id)).slice(0, 5000);
  const verified = body.verified === true;
  const prune = body.prune !== false;
  const summary = record(credential.config_summary);
  const values = record(summary.values);
  const secretFields = record(summary.secretFields);
  const selectedAccounts = csv(values.adAccountIds || env.META_AD_ACCOUNT_IDS)
    .map(accountDbId)
    .filter((id) => /^\d+$/.test(id));
  if (!selectedAccounts.length) return json({ error: 'Выберите хотя бы один рекламный кабинет' }, 400);

  await supabase<unknown>(env, `integration_credentials?id=eq.${encodeURIComponent(credential.id)}`, {
    method: 'PATCH',
    headers: { prefer: 'return=minimal' },
    body: JSON.stringify({
      config_summary: { ...summary, values: { ...values, selectedAdIds: selectedAdIds.join(',') }, secretFields },
      status: verified ? 'connected' : 'configured',
      last_verified_at: verified ? new Date().toISOString() : null,
      last_error: null,
      updated_at: new Date().toISOString(),
    }),
  });

  if (prune) {
    const accountList = selectedAccounts.join(',');
    await deleteRows(env, `marketing_ads?company_id=eq.${encodeURIComponent(companyId)}&platform=eq.Meta&account_id=not.in.(${accountList})`);
    if (selectedAdIds.length) {
      await deleteRows(env, `marketing_ads?company_id=eq.${encodeURIComponent(companyId)}&platform=eq.Meta&account_id=in.(${accountList})&ad_id=not.in.(${selectedAdIds.join(',')})`);
    }
    await refreshMetaDailyMetrics(env, companyId);
  }

  return json({
    ok: true,
    selectedAccountIds: selectedAccounts.map(accountGraphId),
    selectedAdIds,
    creativeSelectionMode: selectedAdIds.length ? 'selected' : 'all',
    verified,
  });
}

export async function handleMetaCatalogRequest(request: Request, env: MetaCatalogEnv, url: URL): Promise<Response | null> {
  if (url.pathname === '/api/integrations/meta/catalog' && request.method === 'GET') {
    try { return await catalog(env, url); }
    catch (error) { return json({ error: error instanceof Error ? error.message : String(error) }, 400); }
  }
  if (url.pathname === '/api/integrations/meta/selection' && request.method === 'POST') {
    try { return await updateSelection(request, env); }
    catch (error) { return json({ error: error instanceof Error ? error.message : String(error) }, 400); }
  }
  return null;
}
