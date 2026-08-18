import { localDataJson, localDataRequest, type LocalDataEnv } from './localData';
import { branchScope, requireBranchId, requireCompanyId, type TenantScopedEnv } from './tenantScope';

type ScopedEnv = LocalDataEnv & TenantScopedEnv;
type Row = Record<string, unknown>;
const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });

function taskIdFromPath(pathname: string): string | null {
  const match = pathname.match(/^\/api\/tasks\/([0-9a-f-]+)(?:\/|$)/i);
  return match && UUID.test(match[1]) ? match[1] : null;
}

async function taskInScope(env: ScopedEnv, taskId: string): Promise<boolean> {
  const companyId = requireCompanyId(env);
  const scope = branchScope(env);
  if (scope.all) return true;
  if (!scope.branchId) return false;
  const rows = await localDataJson<Row[]>(env, `crm_tasks?id=eq.${encodeURIComponent(taskId)}&company_id=eq.${encodeURIComponent(companyId)}&branch_id=eq.${encodeURIComponent(scope.branchId)}&select=id&limit=1`, {}, 'Task branch scope');
  return Boolean(rows[0]);
}

export async function guardTaskBranch(request: Request, env: ScopedEnv, url: URL): Promise<Response | null> {
  if (!url.pathname.startsWith('/api/tasks')) return null;
  const scope = branchScope(env);
  if (url.pathname === '/api/tasks' && request.method === 'POST' && scope.all) {
    return json({ error: 'Для создания задачи выберите конкретный филиал', code: 'BRANCH_REQUIRED' }, 409);
  }
  const taskId = taskIdFromPath(url.pathname);
  if (taskId && !await taskInScope(env, taskId)) {
    return json({ error: 'Задача не найдена в текущем филиале', code: 'BRANCH_SCOPE_MISMATCH' }, 404);
  }
  return null;
}

export async function finalizeTaskBranchResponse(request: Request, env: ScopedEnv, url: URL, response: Response): Promise<Response> {
  if (!url.pathname.startsWith('/api/tasks') || !response.ok) return response;
  const scope = branchScope(env);
  if (scope.all) return response;
  const branchId = scope.branchId;
  if (!branchId) return response;
  const companyId = requireCompanyId(env);

  if (url.pathname === '/api/tasks' && request.method === 'POST') {
    const payload = await response.clone().json().catch(() => null) as { task?: { id?: string } } | null;
    const taskId = text(payload?.task?.id);
    if (UUID.test(taskId)) {
      await localDataRequest(env, `crm_tasks?id=eq.${encodeURIComponent(taskId)}&company_id=eq.${encodeURIComponent(companyId)}`, {
        method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ branch_id: requireBranchId(env), updated_at: new Date().toISOString() }),
      });
    }
    return response;
  }

  if (url.pathname === '/api/tasks' && request.method === 'GET') {
    const payload = await response.clone().json().catch(() => null) as { tasks?: Array<{ id?: string }> } | null;
    const tasks = Array.isArray(payload?.tasks) ? payload!.tasks! : [];
    const ids = tasks.map((task) => text(task.id)).filter((id) => UUID.test(id));
    if (!ids.length) return response;
    const allowed = await localDataJson<Row[]>(env, `crm_tasks?company_id=eq.${encodeURIComponent(companyId)}&branch_id=eq.${encodeURIComponent(branchId)}&id=in.(${ids.map(encodeURIComponent).join(',')})&select=id`, {}, 'Task branch filter');
    const allowedIds = new Set(allowed.map((row) => text(row.id)));
    return json({ ...(payload as object), tasks: tasks.filter((task) => allowedIds.has(text(task.id))) }, response.status);
  }
  return response;
}

function threadIdFromPath(pathname: string): string | null {
  const match = pathname.match(/^\/api\/callcenter\/threads\/([^/]+)/);
  const id = match ? decodeURIComponent(match[1]) : '';
  return UUID.test(id) ? id : null;
}

async function threadInScope(env: ScopedEnv, threadId: string): Promise<boolean> {
  const companyId = requireCompanyId(env); const scope = branchScope(env);
  if (scope.all) return true; if (!scope.branchId) return false;
  const rows = await localDataJson<Row[]>(env, `marketing_conversations?id=eq.${encodeURIComponent(threadId)}&company_id=eq.${encodeURIComponent(companyId)}&branch_id=eq.${encodeURIComponent(scope.branchId)}&select=id&limit=1`, {}, 'Inbox branch scope');
  return Boolean(rows[0]);
}

async function messageInScope(env: ScopedEnv, messageId: string): Promise<boolean> {
  const companyId=requireCompanyId(env); const scope=branchScope(env); if(scope.all)return true; if(!scope.branchId)return false;
  const rows=await localDataJson<Row[]>(env,`marketing_messages?id=eq.${encodeURIComponent(messageId)}&company_id=eq.${encodeURIComponent(companyId)}&branch_id=eq.${encodeURIComponent(scope.branchId)}&select=id&limit=1`,{},'Message branch scope');
  return Boolean(rows[0]);
}

export async function guardInboxBranch(request: Request, env: ScopedEnv, url: URL): Promise<Response | null> {
  if (!url.pathname.startsWith('/api/callcenter/')) return null;
  const scope=branchScope(env);
  if (url.pathname === '/api/callcenter/threads' && request.method === 'POST' && scope.all) return json({ error:'Для создания диалога выберите конкретный филиал', code:'BRANCH_REQUIRED' },409);
  const threadId=threadIdFromPath(url.pathname); if(threadId && !await threadInScope(env,threadId)) return json({error:'Диалог не найден в текущем филиале',code:'BRANCH_SCOPE_MISMATCH'},404);
  const attachment=url.pathname.match(/^\/api\/callcenter\/attachments\/([^/]+)$/); if(attachment){const id=decodeURIComponent(attachment[1]);if(UUID.test(id)&&!await messageInScope(env,id))return json({error:'Вложение не найдено в текущем филиале',code:'BRANCH_SCOPE_MISMATCH'},404);}
  return null;
}

export async function finalizeInboxBranchResponse(request: Request, env: ScopedEnv, url: URL, response: Response): Promise<Response> {
  if (!url.pathname.startsWith('/api/callcenter/') || !response.ok) return response;
  const scope=branchScope(env); if(scope.all)return response; const branchId=scope.branchId; if(!branchId)return response; const companyId=requireCompanyId(env);
  if(url.pathname==='/api/callcenter/threads'&&request.method==='POST'){
    const payload=await response.clone().json().catch(()=>null) as {id?:string}|null;const id=text(payload?.id);if(UUID.test(id))await localDataRequest(env,`marketing_conversations?id=eq.${encodeURIComponent(id)}&company_id=eq.${encodeURIComponent(companyId)}`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({branch_id:requireBranchId(env),updated_at:new Date().toISOString()})});return response;
  }
  if(url.pathname==='/api/callcenter/workspace'&&request.method==='GET'){
    const payload=await response.clone().json().catch(()=>null) as {threads?:Array<{id?:string}>}|null;const threads=Array.isArray(payload?.threads)?payload!.threads!:[];const ids=threads.map(t=>text(t.id)).filter(id=>UUID.test(id));if(!ids.length)return response;
    const allowed=await localDataJson<Row[]>(env,`marketing_conversations?company_id=eq.${encodeURIComponent(companyId)}&branch_id=eq.${encodeURIComponent(branchId)}&id=in.(${ids.map(encodeURIComponent).join(',')})&select=id`,{},'Inbox branch filter');const set=new Set(allowed.map(r=>text(r.id)));
    return json({...(payload as object),threads:threads.filter(t=>set.has(text(t.id)))},response.status);
  }
  const threadId=threadIdFromPath(url.pathname);
  if(threadId&&url.pathname.endsWith('/messages')&&request.method==='POST'){
    const payload=await response.clone().json().catch(()=>null) as {id?:string}|null;const messageId=text(payload?.id);if(UUID.test(messageId))await localDataRequest(env,`marketing_messages?id=eq.${encodeURIComponent(messageId)}&company_id=eq.${encodeURIComponent(companyId)}`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({branch_id:requireBranchId(env)})});
  }
  return response;
}
