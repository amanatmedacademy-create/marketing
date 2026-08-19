import app from './main';
import { authenticateRequest, authorizeApplicationRequest, isPublicApiPath, type AuthEnv } from './auth';
import { runAutomationEngine } from './automationEngine';
import { handleBranchManagementRequest, resolveRequestedBranchId } from './branchManagement';
import { finalizeInboxBranchResponse, finalizeTaskBranchResponse, guardInboxBranch, guardTaskBranch } from './branchOperationalScope';
import { resolveCompanyId } from './companyContext';
import { handleContactAvatars } from './contactAvatars';
import type { Env, WorkerExecutionContext, WorkerScheduledController } from './integrations';
import { runMessagingSlaScan } from './messagingSla';
import { handleNotificationCenterRequest } from './notificationCenter';
import { handleOperatingOverviewRequest } from './operatingOverview';
import type { RecoveryEnv } from './recoveryEngine';
import { runScheduledRecovery } from './recoveryScheduler';
import { runScheduledTelephonyProcessing, type TelephonyProcessingSchedulerEnv } from './telephonyProcessingScheduler';
import { handleTaskNotifications, notifyAssignedTask, runTaskNotificationScan } from './taskNotifications';
import { handleTaskQuickActions } from './taskQuickActions';
import { assertTaskDependenciesComplete, handleTaskPhase2, runTaskRecurrenceScan } from './taskPhase2';
import { handleTaskSuite, runTaskAutomationScan } from './taskSuite';
import { handleTasks } from './tasks';

type SecuredEnv = AuthEnv & { CURRENT_COMPANY_ID?: string; CURRENT_BRANCH_ID?: string };
const INTERNAL_ROLE_HEADER = 'x-amanat-auth-role';
const INTERNAL_USER_HEADER = 'x-amanat-auth-user';
const INTERNAL_VERIFIED_HEADER = 'x-amanat-auth-verified';
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });

function bypassPermissionBoundary(pathname: string): boolean {
  return isPublicApiPath(pathname)
    || pathname === '/api/integrations/meta/callback'
    || pathname.startsWith('/api/telephony/zadarma/webhook/');
}
function sanitizedRequest(request: Request): Request {
  const headers = new Headers(request.headers);
  headers.delete(INTERNAL_ROLE_HEADER); headers.delete(INTERNAL_USER_HEADER); headers.delete(INTERNAL_VERIFIED_HEADER); headers.delete('x-admin-key');
  return new Request(request, { headers });
}
function effectiveRole(user: { role: string; platformRole?: string }): string { return user.platformRole === 'super_admin' ? 'administrator' : user.role; }
function trustedRequest(request: Request<any, any>, role: string, userId: string, branchId?: string | null): Request {
  const headers = new Headers(request.headers);
  headers.delete(INTERNAL_ROLE_HEADER); headers.delete(INTERNAL_USER_HEADER); headers.delete(INTERNAL_VERIFIED_HEADER); headers.delete('x-admin-key');
  headers.set(INTERNAL_ROLE_HEADER, role); headers.set(INTERNAL_USER_HEADER, userId); headers.set(INTERNAL_VERIFIED_HEADER, '1');
  if (branchId) headers.set('x-imds-branch-id', branchId); else headers.delete('x-imds-branch-id');
  return new Request(request, { headers });
}

async function scheduleAssignedNotification(request: Request, env: SecuredEnv, ctx: WorkerExecutionContext | undefined, userId: string, task: { id: string; title: string; dueAt?: unknown }): Promise<void> {
  try {
    const requestedCompany = (request.headers.get('x-imds-company-id') || '').trim();
    const companyId = await resolveCompanyId(requestedCompany ? { ...env, CURRENT_COMPANY_ID: requestedCompany } : env, userId);
    const notify = notifyAssignedTask(env as unknown as Env, task, companyId).catch((error) => console.error('Task assigned notification failed', error));
    if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(notify); else await notify;
  } catch (error) { console.error('Task assigned notification scheduling failed', error); }
}

export default {
  async fetch(request: Request, env: SecuredEnv, ctx?: WorkerExecutionContext): Promise<Response> {
    try {
      const cleanRequest = sanitizedRequest(request); const url = new URL(cleanRequest.url);
      let forwardedRequest: Request | null = null; let requestEnv: SecuredEnv = env;

      if (url.pathname.startsWith('/api/') && !bypassPermissionBoundary(url.pathname)) {
        const user = await authenticateRequest(cleanRequest, env);
        if (!user) return json({ error: 'Необходим вход в систему', code: 'AUTH_REQUIRED' }, 401);
        if (user.status !== 'active') return json({ error: 'Пользователь не активен', code: 'USER_INACTIVE' }, 403);
        const role = effectiveRole(user); const denied = await authorizeApplicationRequest(cleanRequest, env, { ...user, role }); if (denied) return denied;

        const requestedCompany = (cleanRequest.headers.get('x-imds-company-id') || '').trim();
        const companyId = await resolveCompanyId(requestedCompany ? { ...env, CURRENT_COMPANY_ID: requestedCompany } : env, user.id, user.platformRole);
        const companyEnv = { ...env, CURRENT_COMPANY_ID: companyId };
        let branchId: string | null = null;
        try { branchId = await resolveRequestedBranchId(cleanRequest, companyEnv, user.id, user.platformRole); }
        catch (error) { return json({ error: error instanceof Error ? error.message : String(error), code: 'BRANCH_ACCESS_DENIED' }, 403); }
        requestEnv = { ...companyEnv, CURRENT_BRANCH_ID: branchId || undefined };
        forwardedRequest = trustedRequest(cleanRequest.clone(), role, user.id, branchId);

        if (url.pathname.startsWith('/api/branches')) {
          const response = await handleBranchManagementRequest(cleanRequest, requestEnv, url, user.id, user.platformRole); if (response) return response;
        }
        if (url.pathname === '/api/operating-overview') {
          const response = await handleOperatingOverviewRequest(cleanRequest, requestEnv, url, user.id, user.platformRole); if (response) return response;
        }
        if (url.pathname.startsWith('/api/notifications') || url.pathname === '/api/system-health') {
          const response = await handleNotificationCenterRequest(cleanRequest, requestEnv, url, user.id, user.platformRole); if (response) return response;
        }
        if (url.pathname.startsWith('/api/contact-avatars/')) {
          const avatarResponse = await handleContactAvatars(forwardedRequest, requestEnv as unknown as Env, url); if (avatarResponse) return avatarResponse;
        }

        const inboxDenied = await guardInboxBranch(forwardedRequest, requestEnv, url); if (inboxDenied) return inboxDenied;

        if (url.pathname.startsWith('/api/tasks')) {
          const branchDenied = await guardTaskBranch(forwardedRequest, requestEnv, url); if (branchDenied) return branchDenied;
          if (url.pathname.startsWith('/api/tasks/notifications')) { const response = await handleTaskNotifications(forwardedRequest, requestEnv as unknown as Env, url); if (response) return response; }
          if (url.pathname.startsWith('/api/tasks/phase2')) { const response = await handleTaskPhase2(forwardedRequest, requestEnv as unknown as Env, url); if (response) return response; }
          if (url.pathname === '/api/tasks/suite/postpone') { const response = await handleTaskQuickActions(forwardedRequest, requestEnv as unknown as Env, url); if (response) return response; }
          if (url.pathname.startsWith('/api/tasks/suite')) { const response = await handleTaskSuite(forwardedRequest, requestEnv as unknown as Env, url); if (response) return response; }
          const dependencyDenied = await assertTaskDependenciesComplete(forwardedRequest, requestEnv as unknown as Env, url); if (dependencyDenied) return dependencyDenied;
          const response = await handleTasks(forwardedRequest, requestEnv as unknown as Env, url);
          if (response) {
            const scopedResponse = await finalizeTaskBranchResponse(forwardedRequest, requestEnv, url, response);
            if (url.pathname === '/api/tasks' && request.method === 'POST' && scopedResponse.ok) {
              const body = await scopedResponse.clone().json().catch(() => null) as { task?: { id?: string; title?: string; dueAt?: unknown } } | null; const task = body?.task;
              if (task?.id && task.title) await scheduleAssignedNotification(cleanRequest, requestEnv, ctx, user.id, { id: task.id, title: task.title, dueAt: task.dueAt });
            }
            return scopedResponse;
          }
        }
      }

      if (!forwardedRequest) forwardedRequest = cleanRequest;
      const response = await app.fetch(forwardedRequest, requestEnv, ctx);
      return finalizeInboxBranchResponse(forwardedRequest, requestEnv, url, response);
    } catch (error) {
      console.error('Secured worker runtime error', error);
      return json({ error: error instanceof Error ? error.message : String(error), code: 'WORKER_RUNTIME_ERROR' }, 500);
    }
  },

  async scheduled(controller: WorkerScheduledController, env: SecuredEnv, ctx: WorkerExecutionContext): Promise<void> {
    if (controller.cron === '*/5 * * * *') {
      ctx.waitUntil(runMessagingSlaScan(env as unknown as Env).then((result) => console.log('Scheduled Messaging SLA completed', result)).catch((error) => console.error('Scheduled Messaging SLA failed', error)));
      ctx.waitUntil(runTaskAutomationScan(env as unknown as Env).then((result) => console.log('Scheduled task automation completed', result)).catch((error) => console.error('Scheduled task automation failed', error)));
      ctx.waitUntil(runTaskRecurrenceScan(env as unknown as Env).then((result) => console.log('Scheduled recurring tasks completed', result)).catch((error) => console.error('Scheduled recurring tasks failed', error)));
      ctx.waitUntil(runTaskNotificationScan(env as unknown as Env).then((result) => console.log('Scheduled task notifications completed', result)).catch((error) => console.error('Scheduled task notifications failed', error)));
      return;
    }
    await app.scheduled(controller, env, ctx);
    ctx.waitUntil(runAutomationEngine(env).then((result) => console.log('Scheduled journey automation completed', result)).catch((error) => console.error('Scheduled journey automation failed', error)));
    ctx.waitUntil(runScheduledRecovery(env as unknown as RecoveryEnv).then((result) => console.log('Scheduled Recovery scan completed', result)).catch((error) => console.error('Scheduled Recovery scan failed', error)));
    ctx.waitUntil(runScheduledTelephonyProcessing(env as unknown as TelephonyProcessingSchedulerEnv).then((result) => console.log('Scheduled telephony processing completed', result)).catch((error) => console.error('Scheduled telephony processing failed', error)));
    ctx.waitUntil(runTaskNotificationScan(env as unknown as Env).then((result) => console.log('Scheduled task notifications completed', result)).catch((error) => console.error('Scheduled task notifications failed', error)));
  },
};
