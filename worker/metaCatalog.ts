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

class MetaApiError extends Error {
  code: number;
  status: number;

  constructor(message: string, code = 0, status = 500) {
    super(message);
    this.name = 'MetaApiError';
    this.code = code;
    this.status = status;
  }
}

const MAX_CREATIVES_PER_ACCOUNT = 1000;

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});

const record = (value: unknown): JsonRecord => value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {};
const text = (value: unknown): string => typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim();
const number = (value: unknown): number => Number.isFinite(Number(value)) ? Number(value) : 0;
const csv = (value: unknown): string[] => text(value).split(',').map((item) => item.trim()).filter(Boolean);
const graphVersion = (env: MetaCatalogEnv): string => {
  const version = text(env.META_GRAPH_VERSION) || 'v23.0';
  return version.startsWith('v') ? version : `v${version}`;
};
const accountGraphId = (value: string): string => value.startsWith('act_') ? value : `act_${value}`;
const accountDbId = (value: string): string => value.replace(/^act_/, '');
const safeMetaId = (value: string): boolean => /^\d+$/.test(value.replace(/^act_/, ''));
const sleep = (milliseconds: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function mapWithConcurrency<T, R>(items: T[], limit: number, worker: (item: T, index: number) => Promise<R>): Promise<R[]> {
  if (!items.length) return [];
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(Math.max(limit, 1), items.length) }, async () => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

async function metaJson<T>(url: string, attempt = 0): Promise<T> {
  const response = await fetch(url, { headers: { accept: 'application/json' } });
  const body = await response.text();
  let payload: unknown = {};
  try { payload = body ? JSON.parse(body) : {}; } catch { payload = { error: { message: body } }; }
  const error = record(record(payload).error);
  if (!response.ok || Object.keys(error).length) {
    const code = number(error.code);
    const transient = error.is_transient === true || [2, 4, 17, 32, 613].includes(code) || response.status >= 500;
    if (transient && attempt < 2) {
      await sleep(600 * (attempt + 1));
      return metaJson<T>(url, attempt + 1);
    }
    throw new MetaApiError(text(error.message) || `Meta API: ${response.status}`, code, response.status);
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
    limit: '100',
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

async function fetchCreativePages(
  env: MetaCatalogEnv,
  accountId: string,
  fields: string,
  pageSize: number,
): Promise<JsonRecord[]> {
  const { accessToken, version } = requireMeta(env);
  const rows: JsonRecord[] = [];
  const params = new URLSearchParams({
    fields,
    limit: String(pageSize),
    access_token: accessToken,
  });
  let next: string | undefined = `https://graph.facebook.com/${version}/${accountGraphId(accountId)}/ads?${params}`;
  for (let page = 0; next && page < 200; page += 1) {
    const payload: { data?: JsonRecord[]; paging?: { next?: string } } = await metaJson(next);
    rows.push(...(payload.data || []));
    next = rows.length >= MAX_CREATIVES_PER_ACCOUNT ? undefined : payload.paging?.next;
  }
  return rows.slice(0, MAX_CREATIVES_PER_ACCOUNT);
}

async function listCreatives(env: MetaCatalogEnv, accountId: string): Promise<JsonRecord[]> {
  const profiles = [
    { fields: 'id,name,status,effective_status,creative', pageSize: 50 },
    { fields: 'id,name,status,effective_status', pageSize: 25 },
    { fields: 'id,name', pageSize: 10 },
  ];
  let lastError: unknown = null;
  for (const profile of profiles) {
    try {
      return await fetchCreativePages(env, accountId, profile.fields, profile.pageSize);
    } catch (error) {
      lastError = error;
      if (!(error instanceof MetaApiError) || error.code !== 1) throw error;
      console.warn(`Meta creative catalog query was too large for ${accountId}; retrying with fewer fields`, {
        fields: profile.fields,
        pageSize: profile.pageSize,
      });
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Meta не вернула список креативов');
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

  const counts = await mapWithConcurrency(accounts, 3, async (account) => {
    const id = accountGraphId(text(account.id || account.account_id));
    return [id, await creativeCount(env, id)] as const;
  });
  const countMap = new Map(counts);

  const creativeResults = requestedIds.length
    ? await mapWithConcurrency(requestedIds, 1, async (accountId) => {
        try {
          return { accountId, rows: await listCreatives(env, accountId), error: null as string | null };
        } catch (error) {
          return {
            accountId,
            rows: [] as JsonRecord[],
            error: error instanceof Error ? error.message : String(error),
          };
        }
      })
    : [];

  const failedCreativeLoads = creativeResults.filter((result) => result.error);
  if (requestedIds.length && failedCreativeLoads.length === requestedIds.length) {
    throw new Error(failedCreativeLoads[0].error || 'Meta не вернула креативы выбранных кабинетов');
  }

  const creatives = creativeResults.flatMap(({ accountId, rows }) => rows.map((item) => {
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
  }));

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
    creativeCatalogLimitPerAccount: MAX_CREATIVES_PER_ACCOUNT,
    creativeLoadWarnings: failedCreativeLoads.map((result) => ({ accountId: result.accountId, message: result.error })),
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
