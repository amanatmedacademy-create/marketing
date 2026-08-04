import { createClient } from '@clickhouse/client';
import { Job, Worker } from 'bullmq';
import IORedis from 'ioredis';

type DateRange = { from: string; to: string };
type MetricRow = {
  agency_id: string;
  client_id: string;
  data_source_id: string;
  integration: string;
  entity_type: string;
  entity_id: string;
  entity_name: string;
  date: string;
  metric_key: string;
  value: number;
  version: number;
};
type SyncJob = {
  agencyId: string;
  clientId: string;
  dataSourceId: string;
  connector: string;
  entity: string;
  dateRange: DateRange;
  credentials: Record<string, unknown>;
  rows?: Array<Record<string, unknown>>;
};

interface Connector {
  readonly slug: string;
  fetch(job: SyncJob, cursor?: string): Promise<{ rows: Array<Record<string, unknown>>; nextCursor?: string }>;
  normalize(rows: Array<Record<string, unknown>>, job: SyncJob): MetricRow[];
}

class ConnectorRegistry {
  private readonly items = new Map<string, Connector>();
  register(connector: Connector): void { this.items.set(connector.slug, connector); }
  get(slug: string): Connector {
    const connector = this.items.get(slug);
    if (!connector) throw new Error(`Connector not registered: ${slug}`);
    return connector;
  }
}

class InlineConnector implements Connector {
  readonly slug = 'inline-rows';
  async fetch(job: SyncJob, cursor?: string) {
    return { rows: cursor ? [] : (job.rows ?? []) };
  }
  normalize(rows: Array<Record<string, unknown>>, job: SyncJob): MetricRow[] {
    return rows.map(row => ({
      agency_id: job.agencyId,
      client_id: job.clientId,
      data_source_id: job.dataSourceId,
      integration: job.connector,
      entity_type: String(row.entity_type ?? 'account'),
      entity_id: String(row.entity_id ?? 'unknown'),
      entity_name: String(row.entity_name ?? 'Unknown'),
      date: String(row.date),
      metric_key: String(row.metric_key),
      value: Number(row.value ?? 0),
      version: Date.now(),
    }));
  }
}

const redis = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', { maxRetriesPerRequest: null });
const clickhouse = createClient({
  url: process.env.CLICKHOUSE_URL ?? 'http://localhost:8123',
  username: process.env.CLICKHOUSE_USER ?? 'default',
  password: process.env.CLICKHOUSE_PASSWORD ?? '',
  database: process.env.CLICKHOUSE_DATABASE ?? 'analytics',
});
const registry = new ConnectorRegistry();
registry.register(new InlineConnector());

async function synchronize(job: Job<SyncJob>): Promise<{ inserted: number }> {
  const connector = registry.get(job.data.connector);
  let cursor: string | undefined;
  let inserted = 0;
  do {
    const page = await connector.fetch(job.data, cursor);
    const rows = connector.normalize(page.rows, job.data);
    if (rows.length) {
      await clickhouse.insert({ table: 'analytics.metrics_daily', values: rows, format: 'JSONEachRow' });
      inserted += rows.length;
    }
    cursor = page.nextCursor;
  } while (cursor);
  return { inserted };
}

const worker = new Worker<SyncJob>('connector-sync', synchronize, {
  connection: redis,
  concurrency: Number(process.env.SYNC_CONCURRENCY ?? 8),
  limiter: { max: Number(process.env.SYNC_RATE_LIMIT ?? 30), duration: 1000 },
});
worker.on('completed', (job, result) => console.log(JSON.stringify({ event: 'sync.completed', jobId: job.id, ...result })));
worker.on('failed', (job, error) => console.error(JSON.stringify({ event: 'sync.failed', jobId: job?.id, message: error.message })));

async function shutdown(): Promise<void> {
  await worker.close();
  await redis.quit();
  await clickhouse.close();
}
process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());
