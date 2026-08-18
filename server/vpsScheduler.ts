import worker from '../worker/securedMain';
import type { AssetFetcher, WorkerExecutionContext, WorkerScheduledController } from '../worker/integrations';
import { runBillingLifecycleTick } from './billingControlPlane';

type RuntimeEnv = Record<string, string | undefined> & { ASSETS: AssetFetcher };

const assets: AssetFetcher = {
  async fetch(): Promise<Response> {
    return new Response('Scheduler has no assets', { status: 404 });
  },
};

const env: RuntimeEnv = { ...process.env, ASSETS: assets };
let lastMinute = '';

function currentCronExpressions(date: Date): string[] {
  const minute = date.getUTCMinutes();
  const hour = date.getUTCHours();
  const expressions: string[] = [];
  if (minute % 5 === 0) expressions.push('*/5 * * * *');
  if (minute === 15) expressions.push('15 * * * *');
  if (hour === 2 && minute === 30) expressions.push('30 2 * * *');
  return expressions;
}

async function runCron(cron: string, date: Date): Promise<void> {
  const pending: Promise<unknown>[] = [];
  const ctx: WorkerExecutionContext = {
    waitUntil(task) {
      pending.push(task);
    },
  };
  const controller: WorkerScheduledController = { cron, scheduledTime: date.getTime() };
  console.log(JSON.stringify({ area: 'scheduler', event: 'start', cron, at: date.toISOString() }));
  await worker.scheduled(controller, env as never, ctx);
  if (cron === '15 * * * *') await runBillingLifecycleTick(env);
  const results = await Promise.allSettled(pending);
  const rejected = results.filter((item) => item.status === 'rejected');
  if (rejected.length) console.error(JSON.stringify({ area: 'scheduler', event: 'background-failures', cron, count: rejected.length }));
  console.log(JSON.stringify({ area: 'scheduler', event: 'complete', cron, at: new Date().toISOString() }));
}

async function tick(): Promise<void> {
  const date = new Date();
  const minuteKey = date.toISOString().slice(0, 16);
  if (minuteKey === lastMinute) return;
  lastMinute = minuteKey;
  for (const cron of currentCronExpressions(date)) {
    try {
      await runCron(cron, date);
    } catch (error) {
      console.error(JSON.stringify({ area: 'scheduler', event: 'failed', cron, error: error instanceof Error ? error.message : String(error) }));
    }
  }
}

console.log('IMDS Marketing VPS scheduler started (Cloudflare cron compatibility, UTC)');
void tick();
setInterval(() => void tick(), 20_000);
