import { BadGatewayException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Prisma } from '@imds/database';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { AdsTokenCryptoService } from './ads-token-crypto.service.js';
import type { ConfigureMetaAdsDto, MetaAdsRangeDto } from './dto/meta-ads.dto.js';

type MetaAdsSettings = {
  accessTokenEncrypted?: string;
  businessManagerId?: string;
  adAccountId?: string;
  pageId?: string;
  connectedAt?: string;
};

type CompanySettings = Record<string, unknown> & {
  integrations?: Record<string, unknown> & {
    metaAds?: MetaAdsSettings;
  };
};

type MetaListResponse<T> = {
  data?: T[];
  paging?: { next?: string };
  error?: { message?: string; type?: string; code?: number; error_subcode?: number };
};

@Injectable()
export class MetaAdsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly crypto: AdsTokenCryptoService,
  ) {}

  async getStatus(companyId: string) {
    const settings = await this.getSettings(companyId);
    const metaAds = settings.integrations?.metaAds;
    return {
      connected: Boolean(metaAds?.accessTokenEncrypted),
      businessManagerId: metaAds?.businessManagerId ?? null,
      adAccountId: metaAds?.adAccountId ?? null,
      pageId: metaAds?.pageId ?? null,
      connectedAt: metaAds?.connectedAt ?? null,
    };
  }

  async configure(companyId: string, dto: ConfigureMetaAdsDto) {
    const settings = await this.getSettings(companyId);
    const integrations = { ...(settings.integrations ?? {}) };
    integrations.metaAds = {
      accessTokenEncrypted: this.crypto.encrypt(dto.accessToken),
      businessManagerId: dto.businessManagerId,
      adAccountId: dto.adAccountId,
      pageId: dto.pageId,
      connectedAt: new Date().toISOString(),
    } satisfies MetaAdsSettings;

    await this.prisma.company.update({
      where: { id: companyId },
      data: { settings: { ...settings, integrations } as Prisma.InputJsonValue },
    });

    return this.getStatus(companyId);
  }

  async listAccounts(companyId: string) {
    const token = await this.getAccessToken(companyId);
    return this.graphList<Record<string, unknown>>('/me/adaccounts', token, {
      fields: 'id,name,account_status,currency,timezone_name,business_name,amount_spent,balance',
      limit: '100',
    });
  }

  async listCampaigns(companyId: string, adAccountId?: string) {
    const { token, accountId } = await this.resolveAccount(companyId, adAccountId);
    return this.graphList<Record<string, unknown>>(`/${accountId}/campaigns`, token, {
      fields: 'id,name,status,effective_status,objective,buying_type,daily_budget,lifetime_budget,created_time,updated_time,start_time,stop_time',
      limit: '100',
    });
  }

  async getInsights(companyId: string, range: MetaAdsRangeDto) {
    const { token, accountId } = await this.resolveAccount(companyId, range.adAccountId);
    const rows = await this.graphList<Record<string, unknown>>(`/${accountId}/insights`, token, {
      fields: 'campaign_id,campaign_name,impressions,reach,frequency,clicks,spend,cpc,cpm,ctr,actions,cost_per_action_type,date_start,date_stop',
      level: 'campaign',
      time_increment: '1',
      time_range: JSON.stringify({ since: range.since, until: range.until }),
      limit: '500',
    });

    const totals = rows.reduce((result, row) => {
      result.impressions += Number(row.impressions ?? 0);
      result.clicks += Number(row.clicks ?? 0);
      result.spend += Number(row.spend ?? 0);
      return result;
    }, { impressions: 0, clicks: 0, spend: 0 });

    return { totals, rows };
  }

  async listLeadForms(companyId: string) {
    const settings = await this.getMetaSettings(companyId);
    if (!settings.pageId) throw new NotFoundException('Meta Ads pageId is not configured');
    const token = this.crypto.decrypt(settings.accessTokenEncrypted!);
    return this.graphList<Record<string, unknown>>(`/${settings.pageId}/leadgen_forms`, token, {
      fields: 'id,name,status,created_time,leads_count,locale,questions',
      limit: '100',
    });
  }

  async getPerformanceReport(companyId: string, range: MetaAdsRangeDto) {
    const insights = await this.getInsights(companyId, range);
    const deals = await this.prisma.deal.findMany({
      where: {
        companyId,
        deletedAt: null,
        createdAt: {
          gte: new Date(`${range.since}T00:00:00.000Z`),
          lte: new Date(`${range.until}T23:59:59.999Z`),
        },
        OR: [
          { source: { contains: 'facebook', mode: 'insensitive' } },
          { source: { contains: 'meta', mode: 'insensitive' } },
          { source: { contains: 'instagram', mode: 'insensitive' } },
        ],
      },
      select: { id: true, status: true, amount: true, source: true, metadata: true },
    });

    const revenue = deals.reduce((sum, deal) => sum + Number(deal.amount), 0);
    const sales = deals.filter((deal) => deal.status === 'WON').length;
    const spend = insights.totals.spend;
    const profit = revenue - spend;
    const romi = spend > 0 ? (profit / spend) * 100 : 0;

    return {
      period: { since: range.since, until: range.until },
      spend,
      crmLeads: deals.length,
      sales,
      revenue,
      profit,
      romi,
      campaigns: insights.rows,
    };
  }

  private async getSettings(companyId: string): Promise<CompanySettings> {
    const company = await this.prisma.company.findFirst({
      where: { id: companyId, deletedAt: null },
      select: { settings: true },
    });
    if (!company) throw new NotFoundException('Company not found');
    return (company.settings && typeof company.settings === 'object' && !Array.isArray(company.settings)
      ? company.settings
      : {}) as CompanySettings;
  }

  private async getMetaSettings(companyId: string) {
    const settings = await this.getSettings(companyId);
    const metaAds = settings.integrations?.metaAds;
    if (!metaAds?.accessTokenEncrypted) throw new NotFoundException('Meta Ads is not connected');
    return metaAds;
  }

  private async getAccessToken(companyId: string) {
    const settings = await this.getMetaSettings(companyId);
    return this.crypto.decrypt(settings.accessTokenEncrypted!);
  }

  private async resolveAccount(companyId: string, requestedAccountId?: string) {
    const settings = await this.getMetaSettings(companyId);
    const rawAccountId = requestedAccountId ?? settings.adAccountId;
    if (!rawAccountId) throw new NotFoundException('Meta Ads adAccountId is not configured');
    return {
      token: this.crypto.decrypt(settings.accessTokenEncrypted!),
      accountId: rawAccountId.startsWith('act_') ? rawAccountId : `act_${rawAccountId}`,
    };
  }

  private async graphList<T>(path: string, token: string, params: Record<string, string>) {
    const version = this.config.get<string>('META_GRAPH_API_VERSION') ?? 'v23.0';
    const url = new URL(`https://graph.facebook.com/${version}${path}`);
    Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));

    const response = await fetch(url, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(20_000),
    });
    const payload = await response.json() as MetaListResponse<T>;
    if (!response.ok || payload.error) {
      throw new BadGatewayException(payload.error?.message ?? `Meta Graph API request failed: ${response.status}`);
    }
    return payload.data ?? [];
  }
}
