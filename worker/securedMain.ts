import app from './main';
import { authenticateRequest, authorizeApplicationRequest, isPublicApiPath, type AuthEnv } from './auth';
import { runAutomationEngine } from './automationEngine';
import type { WorkerExecutionContext, WorkerScheduledController } from './integrations';
import type { RecoveryEnv } from './recoveryEngine';
import { runScheduledRecovery } from './recoveryScheduler';

type SecuredEnv = AuthEnv & { FRONTEND_ADMIN_KEY?: string };

function secureEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let result = 0;
  for (let index = 0; index < left.length; index += 1) result |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return result === 0;
}

function suppliedAdminKey(request: Request): string {
  const authorization = request.headers.get('authorization') || '';
  const bearer = authorization.toLowerCase().startsWith('bearer ') ? authorization.slice(7).trim() : '';
  return bearer || request.headers.get('x-admin-key') || '';
}

function isLegacyAdminRequest(request: Request, env: SecuredEnv): boolean {
  const supplied = suppliedAdminKey(request);
  return Boolean(env.FRONTEND_ADMIN_KEY && supplied && secureEqual(supplied, env.FRONTEND_ADMIN_KEY));
}

function bypassPermissionBoundary(pathname: string): boolean {
  return isPublicApiPath(pathname)
    || pathname === '/api/integrations/meta/callback'
    || pathname.startsWith('/api/telephony/zadarma/webhook/');
}

export default {
  async fetch(request: Request, env: SecuredEnv, ctx?: WorkerExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/') && !bypassPermissionBoundary(url.pathname) && !isLegacyAdminRequest(request, env)) {
      const user = await authenticateRequest(request, env);
      if (user && user.status === 'active') {
        const denied = await authorizeApplicationRequest(request, env, user);
        if (denied) return denied;
      }
    }
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
  },
};
