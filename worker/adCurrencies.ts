import type { Env } from './integrations';

type JsonRecord = Record<string, unknown>;

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
  const [meta, tiktok] = await Promise.allSettled([
    readMetaCurrencies(env),
    readTikTokCurrencies(env),
  ]);
  return [
    ...(meta.status === 'fulfilled' ? meta.value : []),
    ...(tiktok.status === 'fulfilled' ? tiktok.value : []),
  ];
}
