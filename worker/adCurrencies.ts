import type { Env } from './integrations';
import { requireCompanyId, type TenantScopedEnv } from './tenantScope';

type JsonRecord = Record<string, unknown>;
type ScopedEnv = Env & TenantScopedEnv;

export interface AdvertisingAccountCurrency {
  platform: 'Meta' | 'TikTok';
  account_id: string;
  account_name: string | null;
  currency: string;
}

const parseCsv = (value?: string): string[] => (value || '').split(',').map((item) => item.trim()).filter(Boolean);
const asRecord = (value: unknown): JsonRecord => value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {};
const asString = (value: unknown): string | null => typeof value === 'string' && value.trim() ? value.trim() : null;
const normalizeCurrency = (value: unknown): string => {
  const currency = (asString(value) || 'USD').toUpperCase();
  return /^[A-Z]{3}$/.test(currency) ? currency : 'USD';
};
const normalizePlatform = (value: unknown): 'Meta' | 'TikTok' | null => {
  const platform = (asString(value) || '').toLowerCase();
  if (platform.includes('meta') || platform.includes('facebook') || platform.includes('instagram')) return 'Meta';
  if (platform.includes('tiktok')) return 'TikTok';
  return null;
};
const accountKey = (platform: 'Meta' | 'TikTok', accountId: string) => `${platform}:${accountId.replace(/^act_/, '')}`;

async function readStoredCurrencies(env: Env): Promise<AdvertisingAccountCurrency[]> {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return [];
  const companyId = requireCompanyId(env as ScopedEnv);
  try {
    const response = await fetch(
      `${env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/marketing_ads?select=platform,account_id,account_name,currency,report_date&company_id=eq.${encodeURIComponent(companyId)}&account_id=not.is.null&order=report_date.desc&limit=5000`,
      {
        headers: {
          apikey: env.SUPABASE_SERVICE_ROLE_KEY,
          authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
          accept: 'application/json',
        },
      },
    );
    if (!response.ok) {
      console.error('Stored advertising currency lookup failed', response.status, await response.text());
      return [];
    }
    const rows = await response.json() as JsonRecord[];
    const result = new Map<string, AdvertisingAccountCurrency>();
    for (const row of rows) {
      const platform = normalizePlatform(row.platform);
      const accountId = asString(row.account_id)?.replace(/^act_/, '') || '';
      if (!platform || !accountId) continue;
      const key = accountKey(platform, accountId);
      if (result.has(key)) continue;
      result.set(key, {
        platform,
        account_id: accountId,
        account_name: asString(row.account_name),
        currency: normalizeCurrency(row.currency),
      });
    }
    return [...result.values()];
  } catch (error) {
    console.error('Stored advertising currency lookup failed', error);
    return [];
  }
}

async function readMetaCurrencies(env: Env): Promise<AdvertisingAccountCurrency[]> {
  if (!env.META_ACCESS_TOKEN || !env.META_GRAPH_VERSION) return [];
  const accountIds = parseCsv(env.META_AD_ACCOUNT_IDS).map((id) => id.replace(/^act_/, ''));
  const rows: AdvertisingAccountCurrency[] = [];

  for (const accountId of accountIds) {
    const params = new URLSearchParams({
      access_token: env.META_ACCESS_TOKEN,
      fields: 'id,name,currency',
    });
    const response = await fetch(`https://graph.facebook.com/${env.META_GRAPH_VERSION}/act_${accountId}?${params}`);
    const payload = asRecord(await response.json());
    if (!response.ok || payload.error) {
      console.error('Meta account currency lookup failed', response.status, payload);
      continue;
    }
    rows.push({
      platform: 'Meta',
      account_id: accountId,
      account_name: asString(payload.name),
      currency: normalizeCurrency(payload.currency),
    });
  }

  return rows;
}

async function readTikTokCurrencies(env: Env): Promise<AdvertisingAccountCurrency[]> {
  if (!env.TIKTOK_ACCESS_TOKEN) return [];
  const advertiserIds = parseCsv(env.TIKTOK_ADVERTISER_IDS);
  if (!advertiserIds.length) return [];
  const apiBase = (env.TIKTOK_API_BASE || 'https://business-api.tiktok.com/open_api/v1.3').replace(/\/$/, '');
  const params = new URLSearchParams({ advertiser_ids: JSON.stringify(advertiserIds) });
  const response = await fetch(`${apiBase}/advertiser/info/?${params}`, {
    headers: { 'Access-Token': env.TIKTOK_ACCESS_TOKEN },
  });
  const payload = asRecord(await response.json());
  if (!response.ok || Number(payload.code || 0) !== 0) {
    console.error('TikTok account currency lookup failed', response.status, payload);
    return [];
  }

  const data = asRecord(payload.data);
  const list = Array.isArray(data.list) ? data.list.map(asRecord) : [];
  return list.map((item) => ({
    platform: 'TikTok' as const,
    account_id: asString(item.advertiser_id) || '',
    account_name: asString(item.name),
    currency: normalizeCurrency(item.currency),
  })).filter((item) => item.account_id);
}

export async function detectAdvertisingCurrencies(env: Env): Promise<AdvertisingAccountCurrency[]> {
  const [stored, meta, tiktok] = await Promise.allSettled([
    readStoredCurrencies(env),
    readMetaCurrencies(env),
    readTikTokCurrencies(env),
  ]);

  const result = new Map<string, AdvertisingAccountCurrency>();
  const add = (items: AdvertisingAccountCurrency[], overwrite = false) => {
    for (const item of items) {
      const key = accountKey(item.platform, item.account_id);
      if (overwrite || !result.has(key)) result.set(key, item);
    }
  };

  // Stored values are a fallback for historical rows. Live provider metadata is
  // authoritative because older Meta backfills could persist a default USD code.
  add(stored.status === 'fulfilled' ? stored.value : []);
  add(meta.status === 'fulfilled' ? meta.value : [], true);
  add(tiktok.status === 'fulfilled' ? tiktok.value : [], true);

  return [...result.values()];
}
