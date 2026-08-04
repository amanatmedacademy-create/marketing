import { createHash } from 'node:crypto';
import { createClient, ClickHouseClient } from '@clickhouse/client';
import { Body, Controller, Get, Injectable, Module, Post, Req } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiTags } from '@nestjs/swagger';
import { DataSource } from 'typeorm';
import { Public } from '../common/security';

type AaqlRequestDto = {
  provider: string;
  operation: 'create' | 'read' | 'update' | 'delete' | 'custom';
  asset: string;
  fields?: string[];
  group_by?: string[];
  filters?: Record<string, unknown>[];
  sort?: Record<string, 'asc' | 'desc'>;
  limit?: number;
  offset?: number;
};

type AaqlResponse = {
  status: 'ok' | 'error';
  code: number;
  results: Record<string, unknown>;
};

@Injectable()
class MetricsService {
  private readonly clickhouse: ClickHouseClient;
  constructor(config: ConfigService, private readonly postgres: DataSource) {
    this.clickhouse = createClient({
      url: config.getOrThrow<string>('CLICKHOUSE_URL'),
      username: config.get<string>('CLICKHOUSE_USER', 'default'),
      password: config.get<string>('CLICKHOUSE_PASSWORD', ''),
      database: config.get<string>('CLICKHOUSE_DATABASE', 'analytics'),
    });
  }

  async health(): Promise<Record<string, unknown>> {
    const result = await this.clickhouse.ping();
    return { status: result.success ? 'ok' : 'degraded', clickhouse: result.success };
  }

  private parseApiKey(authorization?: string): string | null {
    if (!authorization?.startsWith('Basic ')) return null;
    const decoded = Buffer.from(authorization.slice(6), 'base64').toString('utf8');
    const separator = decoded.indexOf(':');
    return separator >= 0 ? decoded.slice(separator + 1) : null;
  }

  private async resolveAgency(apiKey: string): Promise<string | null> {
    const hash = createHash('sha256').update(apiKey).digest('hex');
    const rows = await this.postgres.query('select analytics.resolve_api_key($1) as agency_id', [hash]);
    return rows[0]?.agency_id ?? null;
  }

  async execute(dto: Partial<AaqlRequestDto>, authorization?: string): Promise<AaqlResponse> {
    try {
      if (!dto.provider || !dto.operation || !dto.asset) {
        return { status: 'error', code: 400, results: { messages: { request: ['provider, operation and asset are required'] } } };
      }
      const apiKey = this.parseApiKey(authorization);
      if (!apiKey) return { status: 'error', code: 401, results: { messages: { authorization: ['Invalid Basic API key'] } } };
      const agencyId = await this.resolveAgency(apiKey);
      if (!agencyId) return { status: 'error', code: 401, results: { messages: { authorization: ['API key is invalid or revoked'] } } };
      if (dto.operation !== 'read') return { status: 'error', code: 400, results: { messages: { operation: ['Foundation release supports read operations only'] } } };

      const limit = dto.limit ?? 100;
      const offset = dto.offset ?? 0;
      const metricKeys = (dto.fields ?? ['impressions', 'clicks', 'spend']).filter(field => /^[a-z0-9_]+$/i.test(field));
      const query = `
        SELECT client_id, date, metric_key, sum(value) AS value
        FROM analytics.metrics_daily FINAL
        WHERE agency_id = {agencyId:UUID}
          AND metric_key IN ({metricKeys:Array(String)})
        GROUP BY client_id, date, metric_key
        ORDER BY date DESC
        LIMIT {limit:UInt32} OFFSET {offset:UInt32}
      `;
      const result = await this.clickhouse.query({ query, query_params: { agencyId, metricKeys, limit, offset }, format: 'JSONEachRow' });
      const rows = await result.json<Record<string, unknown>>();
      return {
        status: 'ok',
        code: rows.length ? 200 : 204,
        results: {
          metadata: { total_pages: rows.length < limit ? 1 : null, limit, offset },
          totals: {},
          rows,
          previous_period_metadata: {},
          previous_period_totals: {},
          previous_period_rows: [],
        },
      };
    } catch (error) {
      return { status: 'error', code: 500, results: { messages: { internal: [error instanceof Error ? error.message : 'Unknown error'] } } };
    }
  }
}

@ApiTags('Health')
@Controller()
class HealthController {
  constructor(private readonly metrics: MetricsService) {}
  @Public() @Get('health') health() { return this.metrics.health(); }
}

@ApiTags('AAQL')
@Controller()
class AaqlController {
  constructor(private readonly metrics: MetricsService) {}
  @Public()
  @Post('query')
  execute(@Body() dto: Record<string, unknown>, @Req() request: { headers: { authorization?: string } }) {
    return this.metrics.execute(dto as Partial<AaqlRequestDto>, request.headers.authorization);
  }
}

@Module({ controllers: [HealthController, AaqlController], providers: [MetricsService] })
export class MetricsModule {}
