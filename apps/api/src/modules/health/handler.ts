import type { Env } from '../../index';
import { json } from '../../shared/http';

export function handleHealth(env: Env): Response {
  return json({
    status: 'ok',
    service: 'imds-marketing-api',
    environment: env.APP_ENV ?? 'unknown',
    timestamp: new Date().toISOString()
  });
}
