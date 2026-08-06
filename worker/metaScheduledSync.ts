import { handleMetaBackfillRequest, type MetaBackfillEnv } from './metaBackfill';
import type { WorkerScheduledController } from './integrations';

type ScheduledMetaResult = {
  ok?: boolean;
  error?: string;
  fetched?: number;
  written?: number;
  accounts?: number;
  chunks?: number;
};

function scheduledDays(controller: WorkerScheduledController): number {
  return controller.cron === '30 2 * * *' ? 30 : 3;
}

export async function runScheduledMetaSync(
  controller: WorkerScheduledController,
  env: MetaBackfillEnv,
): Promise<ScheduledMetaResult> {
  if (!env.META_ACCESS_TOKEN) {
    return { ok: true, fetched: 0, written: 0, accounts: 0, chunks: 0 };
  }

  const url = new URL('https://internal.invalid/api/integrations/meta/backfill');
  const request = new Request(url.toString(), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ days: scheduledDays(controller) }),
  });

  const response = await handleMetaBackfillRequest(request, env, url);
  if (!response) throw new Error('Scheduled Meta sync route is unavailable');

  const body = await response.text();
  let payload: ScheduledMetaResult = {};
  try {
    payload = body ? JSON.parse(body) as ScheduledMetaResult : {};
  } catch {
    throw new Error(body || `Scheduled Meta sync failed: ${response.status}`);
  }

  if (!response.ok) throw new Error(payload.error || `Scheduled Meta sync failed: ${response.status}`);
  return payload;
}
