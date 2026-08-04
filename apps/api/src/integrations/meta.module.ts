import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { BadRequestException, Body, Controller, Delete, Get, Injectable, Module, Param, Post, Query, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { createClient, ClickHouseClient } from '@clickhouse/client';
import { IsIn, IsOptional, IsString, Matches } from 'class-validator';
import { EntityManager } from 'typeorm';
import { CurrentAgency, CurrentPrincipal, Public, RequestPrincipal, TenantDbService } from '../common/security';

type MetaProduct = 'waba' | 'ads';
type AdAccount = { id: string; name?: string; account_status?: number; currency?: string; timezone_name?: string };
type MetaAction = { action_type?: string; value?: string };
type MetaInsight = {
  account_id?: string;
  campaign_id?: string;
  campaign_name?: string;
  adset_id?: string;
  adset_name?: string;
  ad_id?: string;
  ad_name?: string;
  date_start?: string;
  spend?: string;
  impressions?: string;
  reach?: string;
  clicks?: string;
  inline_link_clicks?: string;
  actions?: MetaAction[];
  action_values?: MetaAction[];
};
type MetaTokenResponse = { access_token?: string; token_type?: string; expires_in?: number; error?: { message?: string } };
type MetaProfile = { id?: string; name?: string; error?: { message?: string } };
type StoredConnection = {
  product: MetaProduct;
  status: string;
  meta_user_id: string | null;
  meta_user_name: string | null;
  business_id: string | null;
  waba_id: string | null;
  phone_number_id: string | null;
  ad_accounts: AdAccount[] | null;
  connected_at: Date;
  updated_at: Date;
};
type SecretConnection = StoredConnection & {
  token_ciphertext: Buffer;
  token_iv: Buffer;
  token_tag: Buffer;
};
type SyncTarget = { clientId: string; dataSourceId: string };

class ExchangeMetaDto {
  @IsString() code!: string;
  @IsIn(['waba', 'ads']) product!: MetaProduct;
  @IsOptional() @IsString() wabaId?: string;
  @IsOptional() @IsString() phoneNumberId?: string;
  @IsOptional() @IsString() businessId?: string;
  @IsOptional() @IsString() clientId?: string;
}

class SyncMetaAdsDto {
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) since?: string;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) until?: string;
  @IsOptional() @IsString() clientId?: string;
}

@Injectable()
class MetaIntegrationService {
  private readonly clickhouse: ClickHouseClient;

  constructor(private readonly config: ConfigService, private readonly tenantDb: TenantDbService) {
    this.clickhouse = createClient({
      url: config.getOrThrow<string>('CLICKHOUSE_URL'),
      username: config.get<string>('CLICKHOUSE_USER', 'default'),
      password: config.get<string>('CLICKHOUSE_PASSWORD', ''),
      database: config.get<string>('CLICKHOUSE_DATABASE', 'analytics'),
    });
  }

  publicConfig() {
    return {
      appId: this.config.get<string>('META_APP_ID') ?? null,
      graphVersion: this.graphVersion(),
      configurations: {
        waba: this.config.get<string>('META_WABA_CONFIG_ID') ?? null,
        ads: this.config.get<string>('META_ADS_CONFIG_ID') ?? null,
      },
      configured: {
        app: Boolean(this.config.get('META_APP_ID') && this.config.get('META_APP_SECRET')),
        waba: Boolean(this.config.get('META_WABA_CONFIG_ID')),
        ads: Boolean(this.config.get('META_ADS_CONFIG_ID')),
      },
    };
  }

  list(agencyId: string): Promise<StoredConnection[]> {
    return this.tenantDb.run(agencyId, async manager => manager.query(
      `select product,status,meta_user_id,meta_user_name,business_id,waba_id,phone_number_id,ad_accounts,connected_at,updated_at
       from analytics.meta_connections
       where agency_id=$1 and client_id is null
       order by product`,
      [agencyId],
    ) as Promise<StoredConnection[]>);
  }

  async exchange(agencyId: string, principal: RequestPrincipal, dto: ExchangeMetaDto) {
    const code = dto.code.trim();
    if (!code) throw new BadRequestException('Meta authorization code is required');
    const token = await this.exchangeCode(code);
    const assets = await this.loadAssets(dto.product, token.access_token!);
    const encrypted = this.encryptToken(token.access_token!);
    const now = new Date();

    await this.tenantDb.run(agencyId, async manager => {
      await manager.query(
        'delete from analytics.meta_connections where agency_id=$1 and client_id is null and product=$2',
        [agencyId, dto.product],
      );
      await manager.query(
        `insert into analytics.meta_connections(
          agency_id,client_id,product,status,meta_user_id,meta_user_name,business_id,waba_id,phone_number_id,ad_accounts,
          token_ciphertext,token_iv,token_tag,token_type,expires_at,connected_by_subject,connected_at,updated_at
        ) values ($1,null,$2,'connected',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$15)`,
        [
          agencyId,
          dto.product,
          assets.profile.id,
          assets.profile.name ?? null,
          dto.businessId?.trim() || null,
          dto.product === 'waba' ? dto.wabaId?.trim() || null : null,
          dto.product === 'waba' ? dto.phoneNumberId?.trim() || null : null,
          JSON.stringify(dto.product === 'ads' ? assets.adAccounts : []),
          encrypted.ciphertext,
          encrypted.iv,
          encrypted.tag,
          token.token_type ?? 'bearer',
          token.expires_in ? new Date(Date.now() + token.expires_in * 1000) : null,
          principal.subject,
          now,
        ],
      );
    });

    return {
      connection: {
        product: dto.product,
        status: 'connected',
        metaUser: { id: assets.profile.id, name: assets.profile.name ?? null },
        wabaId: dto.product === 'waba' ? dto.wabaId ?? null : null,
        phoneNumberId: dto.product === 'waba' ? dto.phoneNumberId ?? null : null,
        adAccounts: dto.product === 'ads' ? assets.adAccounts : [],
      },
    };
  }

  disconnect(agencyId: string, product: string) {
    if (product !== 'waba' && product !== 'ads') throw new BadRequestException('Unknown Meta product');
    return this.tenantDb.run(agencyId, async manager => {
      await manager.query('delete from analytics.meta_connections where agency_id=$1 and client_id is null and product=$2', [agencyId, product]);
      return { success: true, product };
    });
  }

  async syncAds(agencyId: string, dto: SyncMetaAdsDto) {
    const today = new Date().toISOString().slice(0, 10);
    const defaultSince = new Date(Date.now() - 29 * 86_400_000).toISOString().slice(0, 10);
    const since = dto.since ?? defaultSince;
    const until = dto.until ?? today;
    if (since > until) throw new BadRequestException('since must not be after until');

    const connection = await this.loadSecretConnection(agencyId);
    const token = this.decryptToken(connection);
    const target = await this.tenantDb.run(agencyId, manager => this.ensureSyncTarget(manager, agencyId, dto.clientId));
    const inserted: Record<string, unknown>[] = [];
    let sourceRows = 0;

    for (const account of connection.ad_accounts ?? []) {
      const insights = await this.fetchInsights(account.id, token, since, until);
      sourceRows += insights.length;
      const version = Date.now();
      for (const row of insights) {
        if (!row.date_start) continue;
        inserted.push({
          agency_id: agencyId,
          client_id: target.clientId,
          data_source_id: target.dataSourceId,
          ad_account_id: row.account_id ? `act_${row.account_id.replace(/^act_/, '')}` : account.id,
          campaign_id: row.campaign_id ?? '',
          campaign_name: row.campaign_name ?? '',
          adset_id: row.adset_id ?? '',
          adset_name: row.adset_name ?? '',
          ad_id: row.ad_id ?? '',
          ad_name: row.ad_name ?? '',
          insight_date: row.date_start,
          currency: account.currency ?? '',
          spend: Number(row.spend ?? 0),
          impressions: Number(row.impressions ?? 0),
          reach: Number(row.reach ?? 0),
          clicks: Number(row.clicks ?? 0),
          inline_link_clicks: Number(row.inline_link_clicks ?? 0),
          leads: this.actionValue(row.actions, ['lead', 'onsite_conversion.lead_grouped', 'offsite_conversion.fb_pixel_lead']),
          purchases: this.actionValue(row.actions, ['purchase', 'omni_purchase', 'offsite_conversion.fb_pixel_purchase']),
          purchase_value: this.actionValue(row.action_values, ['purchase', 'omni_purchase', 'offsite_conversion.fb_pixel_purchase']),
          raw: JSON.stringify(row),
          version,
          synced_at: new Date().toISOString().replace('T', ' ').replace('Z', ''),
        });
      }
    }

    if (inserted.length) {
      await this.clickhouse.insert({ table: 'analytics.meta_ads_insights_daily', values: inserted, format: 'JSONEachRow' });
    }
    await this.tenantDb.run(agencyId, async manager => {
      await manager.query("update analytics.data_sources set last_sync_at=now(),sync_error=null,status='connected',updated_at=now() where id=$1 and agency_id=$2", [target.dataSourceId, agencyId]);
    });

    return { success: true, since, until, accounts: connection.ad_accounts?.length ?? 0, rows: sourceRows, metrics: inserted.length };
  }

  async insights(agencyId: string, since?: string, until?: string, clientId?: string) {
    const target = await this.tenantDb.run(agencyId, manager => this.ensureSyncTarget(manager, agencyId, clientId));
    const query = `
      select ad_account_id,insight_date,currency,
        sum(spend) spend,sum(impressions) impressions,sum(reach) reach,sum(clicks) clicks,
        sum(inline_link_clicks) inline_link_clicks,sum(leads) leads,sum(purchases) purchases,
        sum(purchase_value) purchase_value,max(synced_at) synced_at
      from analytics.meta_ads_insights_daily final
      where agency_id={agencyId:UUID} and client_id={clientId:UUID}
        and insight_date >= {since:Date} and insight_date <= {until:Date}
      group by ad_account_id,insight_date,currency
      order by insight_date asc,ad_account_id asc
    `;
    const today = new Date().toISOString().slice(0, 10);
    const defaultSince = new Date(Date.now() - 29 * 86_400_000).toISOString().slice(0, 10);
    const result = await this.clickhouse.query({
      query,
      query_params: { agencyId, clientId: target.clientId, since: since ?? defaultSince, until: until ?? today },
      format: 'JSONEachRow',
    });
    const rows = await result.json<Record<string, unknown>>();
    return { insights: rows, range: { since: since ?? defaultSince, until: until ?? today } };
  }

  private graphVersion() {
    return this.config.get<string>('META_GRAPH_VERSION', 'v23.0').trim() || 'v23.0';
  }

  private requireMetaApp() {
    const appId = this.config.get<string>('META_APP_ID');
    const appSecret = this.config.get<string>('META_APP_SECRET');
    if (!appId || !appSecret) throw new ServiceUnavailableException('Meta application secrets are not configured');
    return { appId, appSecret };
  }

  private encryptionKey() {
    const raw = this.config.get<string>('META_TOKEN_ENCRYPTION_KEY');
    if (!raw) throw new ServiceUnavailableException('META_TOKEN_ENCRYPTION_KEY is not configured');
    const key = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
    if (key.length !== 32) throw new ServiceUnavailableException('META_TOKEN_ENCRYPTION_KEY must decode to 32 bytes');
    return key;
  }

  private encryptToken(token: string) {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.encryptionKey(), iv);
    const ciphertext = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
    return { ciphertext, iv, tag: cipher.getAuthTag() };
  }

  private decryptToken(connection: SecretConnection) {
    const decipher = createDecipheriv('aes-256-gcm', this.encryptionKey(), connection.token_iv);
    decipher.setAuthTag(connection.token_tag);
    return Buffer.concat([decipher.update(connection.token_ciphertext), decipher.final()]).toString('utf8');
  }

  private async exchangeCode(code: string) {
    const { appId, appSecret } = this.requireMetaApp();
    const params = new URLSearchParams({ client_id: appId, client_secret: appSecret, code });
    const response = await fetch(`https://graph.facebook.com/${this.graphVersion()}/oauth/access_token?${params.toString()}`, { headers: { accept: 'application/json' } });
    const payload = await response.json() as MetaTokenResponse;
    if (!response.ok || !payload.access_token) throw new BadRequestException(payload.error?.message || 'Meta authorization code exchange failed');
    return payload;
  }

  private async graphFetch<T>(path: string, accessToken: string) {
    const separator = path.includes('?') ? '&' : '?';
    const response = await fetch(`https://graph.facebook.com/${this.graphVersion()}/${path}${separator}access_token=${encodeURIComponent(accessToken)}`, { headers: { accept: 'application/json' } });
    const payload = await response.json() as T & { error?: { message?: string } };
    if (!response.ok) throw new BadRequestException(payload.error?.message || `Meta Graph API error (${response.status})`);
    return payload;
  }

  private async loadAssets(product: MetaProduct, token: string) {
    const profile = await this.graphFetch<MetaProfile>('me?fields=id,name', token);
    if (!profile.id) throw new BadRequestException(profile.error?.message || 'Meta profile is unavailable');
    let adAccounts: AdAccount[] = [];
    if (product === 'ads') {
      const accounts = await this.graphFetch<{ data?: AdAccount[] }>('me/adaccounts?fields=id,name,account_status,currency,timezone_name&limit=200', token);
      adAccounts = accounts.data ?? [];
    }
    return { profile, adAccounts };
  }

  private async loadSecretConnection(agencyId: string): Promise<SecretConnection> {
    return this.tenantDb.run(agencyId, async manager => {
      const rows = await manager.query(
        `select product,status,meta_user_id,meta_user_name,business_id,waba_id,phone_number_id,ad_accounts,
          token_ciphertext,token_iv,token_tag,connected_at,updated_at
         from analytics.meta_connections
         where agency_id=$1 and client_id is null and product='ads' and status='connected'
         limit 1`,
        [agencyId],
      ) as SecretConnection[];
      if (!rows[0]) throw new BadRequestException('Meta Ads is not connected');
      return rows[0];
    });
  }

  private async ensureSyncTarget(manager: EntityManager, agencyId: string, requestedClientId?: string): Promise<SyncTarget> {
    let clientId = requestedClientId;
    if (clientId) {
      const rows = await manager.query('select id from analytics.clients where id=$1 and agency_id=$2 and status=$3', [clientId, agencyId, 'active']);
      if (!rows[0]) throw new BadRequestException('Client does not belong to the current agency');
    } else {
      const rows = await manager.query("select id from analytics.clients where agency_id=$1 and status='active' order by created_at limit 1", [agencyId]);
      clientId = rows[0]?.id;
    }
    if (!clientId) {
      const rows = await manager.query(
        "insert into analytics.clients(agency_id,company,status) values($1,'IMDS Marketing','active') returning id",
        [agencyId],
      );
      clientId = rows[0].id;
    }

    await manager.query(
      "insert into analytics.integrations(slug,name,category,auth_type,badges) values('meta-ads','Meta Ads','Paid Ads','oauth2',array['POPULAR']) on conflict(slug) do nothing",
    );
    const integrationRows = await manager.query("select id from analytics.integrations where slug='meta-ads' limit 1");
    const integrationId = integrationRows[0].id;
    const sources = await manager.query(
      "select id from analytics.data_sources where agency_id=$1 and client_id=$2 and integration_id=$3 and external_identifier='agency-meta-ads' limit 1",
      [agencyId, clientId, integrationId],
    );
    if (sources[0]) return { clientId, dataSourceId: sources[0].id };
    const created = await manager.query(
      "insert into analytics.data_sources(agency_id,client_id,integration_id,label,external_identifier,status) values($1,$2,$3,'Meta Ads','agency-meta-ads','connected') returning id",
      [agencyId, clientId, integrationId],
    );
    return { clientId, dataSourceId: created[0].id };
  }

  private async fetchInsights(accountId: string, token: string, since: string, until: string) {
    const fields = ['account_id','campaign_id','campaign_name','adset_id','adset_name','ad_id','ad_name','date_start','spend','impressions','reach','clicks','inline_link_clicks','actions','action_values'].join(',');
    const params = new URLSearchParams({ fields, level: 'ad', time_increment: '1', time_range: JSON.stringify({ since, until }), limit: '500', access_token: token });
    const rows: MetaInsight[] = [];
    let next: string | undefined = `https://graph.facebook.com/${this.graphVersion()}/${accountId}/insights?${params.toString()}`;
    while (next) {
      const response = await fetch(next);
      const payload = await response.json() as { data?: MetaInsight[]; paging?: { next?: string }; error?: { message?: string } };
      if (!response.ok) throw new BadRequestException(payload.error?.message || `Meta insights error (${response.status})`);
      rows.push(...(payload.data ?? []));
      next = payload.paging?.next;
    }
    return rows;
  }

  private actionValue(actions: MetaAction[] | undefined, candidates: string[]) {
    const row = actions?.find(item => item.action_type && candidates.includes(item.action_type));
    return Number(row?.value ?? 0);
  }
}

@ApiTags('Meta integrations')
@ApiBearerAuth()
@Controller('integrations/meta')
class MetaIntegrationController {
  constructor(private readonly service: MetaIntegrationService) {}

  @Public()
  @Get('config')
  config() { return this.service.publicConfig(); }

  @Get()
  async list(@CurrentAgency() agencyId: string) { return { connections: await this.service.list(agencyId) }; }

  @Post('exchange')
  exchange(@CurrentAgency() agencyId: string, @CurrentPrincipal() principal: RequestPrincipal, @Body() dto: ExchangeMetaDto) {
    return this.service.exchange(agencyId, principal, dto);
  }

  @Delete(':product')
  disconnect(@CurrentAgency() agencyId: string, @Param('product') product: string) {
    return this.service.disconnect(agencyId, product);
  }

  @Post('ads/sync')
  syncAds(@CurrentAgency() agencyId: string, @Body() dto: SyncMetaAdsDto) {
    return this.service.syncAds(agencyId, dto);
  }

  @Get('ads/insights')
  insights(
    @CurrentAgency() agencyId: string,
    @Query('since') since?: string,
    @Query('until') until?: string,
    @Query('clientId') clientId?: string,
  ) {
    return this.service.insights(agencyId, since, until, clientId);
  }
}

@Module({ controllers: [MetaIntegrationController], providers: [MetaIntegrationService] })
export class MetaIntegrationModule {}
