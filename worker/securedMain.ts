import app from './main';
import { authenticateRequest, authorizeApplicationRequest, isPublicApiPath, type AuthEnv } from './auth';
import { runAutomationEngine } from './automationEngine';
import { resolveCompanyId } from './companyContext';
import type { Env, WorkerExecutionContext, WorkerScheduledController } from './integrations';
import type { RecoveryEnv } from './recoveryEngine';
import { runScheduledRecovery } from './recoveryScheduler';
import { runScheduledTelephonyProcessing, type TelephonyProcessingSchedulerEnv } from './telephonyProcessingScheduler';
import { handleTaskNotifications, notifyAssignedTask, runTaskNotificationScan } from './taskNotifications';
import { handleTasks } from './tasks';

type SecuredEnv = AuthEnv & { FRONTEND_ADMIN_KEY?: string; CURRENT_COMPANY_ID?: string };

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});

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

function trustedRequest(request: Request, role: string, userId: string): Request {
  const headers = new Headers(request.headers);
  headers.delete('x-amanat-auth-role');
  headers.delete('x-amanat-auth-user');
  headers.set('x-amanat-auth-role', role);
  headers.set('x-amanat-auth-user', userId);
  return new Request(request, { headers });
}

export default {
  async fetch(request: Request, env: SecuredEnv, ctx?: WorkerExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/') && !bypassPermissionBoundary(url.pathname) && !isLegacyAdminRequest(request, env)) {
      const user = await authenticateRequest(request, env);
      if (!user) return json({ error: 'Необходим вход через Google', code: 'AUTH_REQUIRED' }, 401);
      if (user.status !== 'active') return json({ error: 'Пользователь не активен', code: 'USER_INACTIVE' }, 403);

      const denied = await authorizeApplicationRequest(request, env, user);
      if (denied) return denied;
      if (url.pathname.startsWith('/api/tasks')) {
        const trusted = trustedRequest(request, user.role, user.id);
        if (url.pathname.startsWith('/api/tasks/notifications')) {
          const response = await handleTaskNotifications(trusted, env as unknown as Env, url);
          if (response) return response;
        }
        const response = await handleTasks(trusted, env as unknown as Env, url);
        if (response) {
          if (url.pathname === '/api/tasks' && request.method === 'POST' && response.ok) {
            const body = await response.clone().json().catch(() => null) as { task?: { id?: string; title?: string; dueAt?: unknown } } | null;
            const task = body?.task;
            if (task?.id && task.title) {
              const requestedCompany = (request.headers.get('x-imds-company-id') || '').trim();
              const companyId = await resolveCompanyId(requestedCompany ? { ...env, CURRENT_COMPANY_ID: requestedCompany } : env, user.id);
              const notify = notifyAssignedTask(env as unknown as Env, { id: task.id, title: task.title, dueAt: task.dueAt }, companyId)
                .catch((error) => console.error('Task assigned notification failed', error));
              if (ctx) ctx.waitUntil(notify); else await notify;
            }
          }
          return response;
        }
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
