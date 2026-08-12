import app from './main';
import { runAutomationEngine } from './automationEngine';
import type { AuthEnv } from './auth';
import type { Env, WorkerExecutionContext, WorkerScheduledController } from './integrations';
import type { RecoveryEnv } from './recoveryEngine';
import { runScheduledRecovery } from './recoveryScheduler';
import { runScheduledTelephonyProcessing, type TelephonyProcessingSchedulerEnv } from './telephonyProcessingScheduler';
import { runTaskNotificationScan } from './taskNotifications';

type SecuredEnv = AuthEnv & { FRONTEND_ADMIN_KEY?: string; CURRENT_COMPANY_ID?: string };

export default {
  async fetch(request: Request, env: SecuredEnv, ctx?: WorkerExecutionContext): Promise<Response> {
    return app.fetch(request, env, ctx);
  },

  async scheduled(controller: WorkerScheduledController, env: SecuredEnv, ctx: WorkerExecutionContext): Promise<void> {
    await app.scheduled(controller, env, ctx);
    ctx.waitUntil(
      runAutomationEngine(env)
        .then((result) => console.log('Scheduled journey automation completed', result))
        .catch((error) => console.error('Scheduled journey automation failed', error)),
    );
    ctx.waitUntil(
      runScheduledRecovery(env as unknown as RecoveryEnv)
        .then((result) => console.log('Scheduled Recovery scan completed', result))
        .catch((error) => console.error('Scheduled Recovery scan failed', error)),
    );
    ctx.waitUntil(
      runScheduledTelephonyProcessing(env as unknown as TelephonyProcessingSchedulerEnv)
        .then((result) => console.log('Scheduled telephony processing completed', result))
        .catch((error) => console.error('Scheduled telephony processing failed', error)),
    );
    ctx.waitUntil(
      runTaskNotificationScan(env as unknown as Env)
        .then((result) => console.log('Scheduled task notifications completed', result))
        .catch((error) => console.error('Scheduled task notifications failed', error)),
    );
  },
};
