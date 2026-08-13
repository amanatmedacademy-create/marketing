import app from './main';
import { authenticateRequest, authorizeApplicationRequest, isPublicApiPath, type AuthEnv } from './auth';
import { runAutomationEngine } from './automationEngine';
import { resolveCompanyId } from './companyContext';
import { handleContactAvatars } from './contactAvatars';
import type { Env, WorkerExecutionContext, WorkerScheduledController } from './integrations';
import { runMessagingSlaScan } from './messagingSla';
import type { RecoveryEnv } from './recoveryEngine';
import { runScheduledRecovery } from './recoveryScheduler';
import { runScheduledTelephonyProcessing, type TelephonyProcessingSchedulerEnv } from './telephonyProcessingScheduler';
import { handleTaskNotifications, notifyAssignedTask, runTaskNotificationScan } from './taskNotifications';
import { handleTaskQuickActions } from './taskQuickActions';
import { assertTaskDependenciesComplete, handleTaskPhase2, runTaskRecurrenceScan } from './taskPhase2';
import { handleTaskSuite, runTaskAutomationScan } from './taskSuite';
import { handleTasks } from './tasks';

type SecuredEnv = AuthEnv & { FRONTEND_ADMIN_KEY?: string; CURRENT_COMPANY_ID?: string };

const INTERNAL_ROLE_HEADER = 'x-amanat-auth-role';
const INTERNAL_USER_HEADER = 'x-amanat-auth-user';
const INTERNAL_VERIFIED_HEADER = 'x-amanat-auth-verified';

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

function sanitizedRequest(request: Request): Request {
  const headers = new Headers(request.headers);
  headers.delete(INTERNAL_ROLE_HEADER);
  headers.delete(INTERNAL_USER_HEADER);
  headers.delete(INTERNAL_VERIFIED_HEADER);
  return new Request(request, { headers });
}

function trustedRequest(request: Request, role: string, userId: string): Request {
  const headers = new Headers(request.headers);
  headers.delete(INTERNAL_ROLE_HEADER);
  headers.delete(INTERNAL_USER_HEADER);
  headers.delete(INTERNAL_VERIFIED_HEADER);
  headers.set(INTERNAL_ROLE_HEADER, role);
  headers.set(INTERNAL_USER_HEADER, userId);
  headers.set(INTERNAL_VERIFIED_HEADER, '1');
  return new Request(request, { headers });
}

async function scheduleAssignedNotification(
  request: Request,
  env: SecuredEnv,
  ctx: WorkerExecutionContext | undefined,
  userId: string,
  task: { id: string; title: string; dueAt?: unknown },
): Promise<void> {
  try {
    const requestedCompany = (request.headers.get('x-imds-company-id') || '').trim();
    const companyId = await resolveCompanyId(requestedCompany ? { ...env, CURRENT_COMPANY_ID: requestedCompany } : env, userId);
    const notify = notifyAssignedTask(env as unknown as Env, task, companyId)
      .catch((error) => console.error('Task assigned notification failed', error));
    if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(notify);
    else await notify;
  } catch (error) {
    console.error('Task assigned notification scheduling failed', error);
  }
}

export default {
  async fetch(request: Request, env: SecuredEnv, ctx?: WorkerExecutionContext): Promise<Response> {
    try {
      const url = new URL(request.url);
      let forwardedRequest: Request | null = null;
      if (url.pathname.startsWith('/api/') && !bypassPermissionBoundary(url.pathname) && !isLegacyAdminRequest(request, env)) {
        const user = await authenticateRequest(request, env);
        if (!user) return json({ error: 'Необходим вход через Google', code: 'AUTH_REQUIRED' }, 401);
        if (user.status !== 'active') return json({ error: 'Пользователь не активен', code: 'USER_INACTIVE' }, 403);

        const denied = await authorizeApplicationRequest(request, env, user);
        if (denied) return denied;
        forwardedRequest = trustedRequest(request, user.role, user.id);

        if (url.pathname.startsWith('/api/contact-avatars/')) {
          const requestedCompany = (request.headers.get('x-imds-company-id') || '').trim();
          const avatarCompanyId = await resolveCompanyId(requestedCompany ? { ...env, CURRENT_COMPANY_ID: requestedCompany } : env, user.id);
          const avatarResponse = await handleContactAvatars(forwardedRequest, { ...env, CURRENT_COMPANY_ID: avatarCompanyId } as unknown as Env, url);
          if (avatarResponse) return avatarResponse;
        }

        if (url.pathname.startsWith('/api/tasks')) {
          if (url.pathname.startsWith('/api/tasks/notifications')) {
            const response = await handleTaskNotifications(forwardedRequest, env as unknown as Env, url);
            if (response) return response;
          }
          if (url.pathname.startsWith('/api/tasks/phase2')) {
            const response = await handleTaskPhase2(forwardedRequest, env as unknown as Env, url);
            if (response) return response;
          }
          if (url.pathname === '/api/tasks/suite/postpone') {
            const response = await handleTaskQuickActions(forwardedRequest, env as unknown as Env, url);
            if (response) return response;
          }
          if (url.pathname.startsWith('/api/tasks/suite')) {
            const response = await handleTaskSuite(forwardedRequest, env as unknown as Env, url);
            if (response) return response;
          }
          const dependencyDenied = await assertTaskDependenciesComplete(forwardedRequest, env as unknown as Env, url);
          if (dependencyDenied) return dependencyDenied;
          const response = await handleTasks(forwardedRequest, env as unknown as Env, url);
          if (response) {
            if (url.pathname === '/api/tasks' && request.method === 'POST' && response.ok) {
              const body = await response.clone().json().catch(() => null) as { task?: { id?: string; title?: string; dueAt?: unknown } } | null;
              const task = body?.task;
              if (task?.id && task.title) {
                await scheduleAssignedNotification(request, env, ctx, user.id, { id: task.id, title: task.title, dueAt: task.dueAt });
              }
            }
            return response;
          }
        }
      }
      if (!forwardedRequest) forwardedRequest = sanitizedRequest(request);
      return app.fetch(forwardedRequest, env, ctx);
    } catch (error) {
      console.error('Secured worker runtime error', error);
      return json({
        error: error instanceof Error ? error.message : String(error),
        code: 'WORKER_RUNTIME_ERROR',
      }, 500);
    }
  },

  async scheduled(controller: WorkerScheduledController, env: SecuredEnv, ctx: WorkerExecutionContext): Promise<void> {
    if (controller.cron === '*/5 * * * *') {
      ctx.waitUntil(
        runMessagingSlaScan(env as unknown as Env)
          .then((result) => console.log('Scheduled Messaging SLA completed', result))
          .catch((error) => console.error('Scheduled Messaging SLA failed', error)),
      );
      ctx.waitUntil(
        runTaskAutomationScan(env as unknown as Env)
          .then((result) => console.log('Scheduled task automation completed', result))
          .catch((error) => console.error('Scheduled task automation failed', error)),
      );
      ctx.waitUntil(
        runTaskRecurrenceScan(env as unknown as Env)
          .then((result) => console.log('Scheduled recurring tasks completed', result))
          .catch((error) => console.error('Scheduled recurring tasks failed', error)),
      );
      ctx.waitUntil(
        runTaskNotificationScan(env as unknown as Env)
          .then((result) => console.log('Scheduled task notifications completed', result))
          .catch((error) => console.error('Scheduled task notifications failed', error)),
      );
      return;
    }

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