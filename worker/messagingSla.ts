import type { Env } from './integrations';

type MessagingSlaScanResult = {
  scanned?: number;
  level1?: number;
  level2?: number;
  tasksCreated?: number;
};

function headers(env: Env): HeadersInit {
  return {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    'content-type': 'application/json',
  };
}

export async function runMessagingSlaScan(env: Env): Promise<MessagingSlaScanResult> {
  const response = await fetch(`${env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/rpc/run_messaging_sla_scan`, {
    method: 'POST',
    headers: headers(env),
    body: '{}',
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`Messaging SLA scan ${response.status}: ${body.slice(0, 1200)}`);
  if (!body) return {};
  return JSON.parse(body) as MessagingSlaScanResult;
}
