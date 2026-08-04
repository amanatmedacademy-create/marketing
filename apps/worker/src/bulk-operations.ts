import type { AuthEnv, AuthSession } from './auth';

type Env = AuthEnv & { SUPABASE_SERVICE_ROLE_KEY?: string };
type TargetType = 'reports' | 'dashboards';
type Action = 'add' | 'apply_template' | 'download' | 'remove' | 'edit_email' | 'edit_schedule';

type ClientRow = { id: string; name: string; status: string };
type TemplateRow = { id: string; target_type: TargetType; name: string; description: string | null; category: string; config: Record<string, unknown> };
type OperationRow = { id: string; target_type: TargetType; action: Action; status: string; total_items: number; processed_items: number; succeeded_items: number; failed_items: number; parameters: Record<string, unknown>; output: Record<string, unknown>; error_message: string | null; created_at: string; completed_at: string | null };

type ExecuteBody = {
  targetType?: TargetType;
  action?: Action;
  clientIds?: string[];
  templateId?: string;
  title?: string;
  emailSubject?: string;
  emailMessage?: string;
  scheduleStatus?: 'active' | 'paused';
  schedule?: Record<string, unknown>;
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});

function assertEnv(env: Env): asserts env is Env & { SUPABASE_SERVICE_ROLE_KEY: string } {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('Bulk Operations environment is not configured');
}

async function rest<T>(env: Env, path: string, init: RequestInit = {}): Promise<T> {
  assertEnv(env);
  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      'content-type': 'application/json',
      prefer: 'return=representation',
      ...init.headers,
    },
  });
  if (!response.ok) throw new Error(`Bulk Operations query failed: ${response.status} ${await response.text()}`);
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

function canExecute(session: AuthSession) {
  return ['owner', 'admin', 'administrator', 'manager'].includes(session.role);
}

function canRemove(session: AuthSession) {
  return ['owner', 'admin', 'administrator'].includes(session.role);
}

async function getBootstrap(env: Env, session: AuthSession) {
  const [clients, templates, operations] = await Promise.all([
    rest<ClientRow[]>(env, `marketing_clients?select=id,name,status&company_id=eq.${session.companyId}&status=eq.active&order=name.asc`),
    rest<TemplateRow[]>(env, `reporting_templates?select=id,target_type,name,description,category,config&company_id=eq.${session.companyId}&order=target_type.asc,name.asc`),
    rest<OperationRow[]>(env, `bulk_operations?select=id,target_type,action,status,total_items,processed_items,succeeded_items,failed_items,parameters,output,error_message,created_at,completed_at&company_id=eq.${session.companyId}&order=created_at.desc&limit=50`),
  ]);
  return json({ clients, templates, operations, permissions: { execute: canExecute(session), remove: canRemove(session) } });
}

async function createOperation(env: Env, session: AuthSession, body: ExecuteBody, clients: ClientRow[]) {
  const rows = await rest<OperationRow[]>(env, 'bulk_operations?select=id,target_type,action,status,total_items,processed_items,succeeded_items,failed_items,parameters,output,error_message,created_at,completed_at', {
    method: 'POST',
    body: JSON.stringify({
      company_id: session.companyId,
      target_type: body.targetType,
      action: body.action,
      status: 'running',
      total_items: clients.length,
      parameters: body,
      created_by: session.user.id,
      started_at: new Date().toISOString(),
    }),
  });
  const operation = rows[0];
  if (clients.length) {
    await rest(env, 'bulk_operation_items', {
      method: 'POST',
      body: JSON.stringify(clients.map(client => ({
        company_id: session.companyId,
        operation_id: operation.id,
        target_type: 'client',
        target_id: client.id,
        target_name: client.name,
        status: 'running',
        started_at: new Date().toISOString(),
      }))),
    });
  }
  return operation;
}

async function existingTargets(env: Env, session: AuthSession, targetType: TargetType, clientIds: string[]) {
  const table = targetType === 'reports' ? 'reporting_reports' : 'reporting_dashboard_sections';
  const quoted = clientIds.map(id => `\"${id.replace(/\"/g, '')}\"`).join(',');
  return rest<Array<{ id: string; client_id: string; title: string }>>(env, `${table}?select=id,client_id,title&company_id=eq.${session.companyId}&client_id=in.(${quoted})&deleted_at=is.null`);
}

async function executeForClient(env: Env, session: AuthSession, operationId: string, client: ClientRow, body: ExecuteBody, template?: TemplateRow) {
  const targetTable = body.targetType === 'reports' ? 'reporting_reports' : 'reporting_dashboard_sections';
  const now = new Date().toISOString();
  try {
    if (body.action === 'add') {
      const title = body.title?.trim() || template?.name || (body.targetType === 'reports' ? 'Новый отчёт' : 'Новый dashboard');
      const record = body.targetType === 'reports'
        ? { company_id: session.companyId, client_id: client.id, template_id: template?.id ?? null, title, report_type: template?.category ?? 'custom', config: template?.config ?? {}, created_by: session.user.id, updated_by: session.user.id }
        : { company_id: session.companyId, client_id: client.id, template_id: template?.id ?? null, title, dashboard_type: template?.category ?? 'custom', config: template?.config ?? {}, created_by: session.user.id, updated_by: session.user.id };
      await rest(env, targetTable, { method: 'POST', body: JSON.stringify(record) });
    } else {
      const targets = await existingTargets(env, session, body.targetType!, [client.id]);
      if (!targets.length) throw new Error('Нет объектов для выполнения операции');
      const ids = targets.map(item => `\"${item.id}\"`).join(',');
      if (body.action === 'apply_template') {
        if (!template) throw new Error('Шаблон не выбран');
        await rest(env, `${targetTable}?id=in.(${ids})&company_id=eq.${session.companyId}`, { method: 'PATCH', body: JSON.stringify({ template_id: template.id, config: template.config, updated_by: session.user.id, updated_at: now }) });
      }
      if (body.action === 'remove') {
        await rest(env, `${targetTable}?id=in.(${ids})&company_id=eq.${session.companyId}`, { method: 'PATCH', body: JSON.stringify({ deleted_at: now, status: 'archived', updated_by: session.user.id, updated_at: now }) });
      }
      if (body.action === 'edit_email') {
        if (body.targetType !== 'reports') throw new Error('Email доступен только для отчётов');
        await rest(env, `${targetTable}?id=in.(${ids})&company_id=eq.${session.companyId}`, { method: 'PATCH', body: JSON.stringify({ email_subject: body.emailSubject?.trim() || null, email_message: body.emailMessage?.trim() || null, updated_by: session.user.id, updated_at: now }) });
      }
      if (body.action === 'edit_schedule') {
        if (body.targetType !== 'reports') throw new Error('Расписание доступно только для отчётов');
        await rest(env, `${targetTable}?id=in.(${ids})&company_id=eq.${session.companyId}`, { method: 'PATCH', body: JSON.stringify({ schedule_status: body.scheduleStatus ?? 'active', schedule: body.schedule ?? { frequency: 'monthly', timezone: 'Asia/Almaty' }, updated_by: session.user.id, updated_at: now }) });
      }
      if (body.action === 'download') {
        await rest(env, `bulk_operations?id=eq.${operationId}`, { method: 'PATCH', body: JSON.stringify({ output: { format: 'csv', generated: true } }) });
      }
    }
    await rest(env, `bulk_operation_items?operation_id=eq.${operationId}&target_id=eq.${client.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'completed', completed_at: now, result: { ok: true } }) });
    return true;
  } catch (error) {
    await rest(env, `bulk_operation_items?operation_id=eq.${operationId}&target_id=eq.${client.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'failed', completed_at: now, error_message: error instanceof Error ? error.message : 'Unknown error' }) });
    return false;
  }
}

async function execute(request: Request, env: Env, session: AuthSession) {
  if (!canExecute(session)) return json({ error: { code: 'FORBIDDEN', message: 'Недостаточно прав для массовых операций' } }, 403);
  const body = await request.json() as ExecuteBody;
  const targetTypes = new Set<TargetType>(['reports', 'dashboards']);
  const actions = new Set<Action>(['add', 'apply_template', 'download', 'remove', 'edit_email', 'edit_schedule']);
  if (!body.targetType || !targetTypes.has(body.targetType) || !body.action || !actions.has(body.action)) return json({ error: { code: 'VALIDATION_ERROR', message: 'Выберите объект и операцию' } }, 400);
  if (body.action === 'remove' && !canRemove(session)) return json({ error: { code: 'FORBIDDEN', message: 'Удаление доступно только администратору' } }, 403);
  const clientIds = [...new Set((body.clientIds ?? []).filter(Boolean))];
  if (!clientIds.length) return json({ error: { code: 'VALIDATION_ERROR', message: 'Выберите минимум одного клиента' } }, 400);
  const quoted = clientIds.map(id => `\"${id.replace(/\"/g, '')}\"`).join(',');
  const clients = await rest<ClientRow[]>(env, `marketing_clients?select=id,name,status&company_id=eq.${session.companyId}&id=in.(${quoted})&status=eq.active`);
  if (!clients.length) return json({ error: { code: 'NOT_FOUND', message: 'Выбранные клиенты не найдены' } }, 404);
  const template = body.templateId ? (await rest<TemplateRow[]>(env, `reporting_templates?select=id,target_type,name,description,category,config&company_id=eq.${session.companyId}&id=eq.${body.templateId}&limit=1`))[0] : undefined;
  const operation = await createOperation(env, session, body, clients);
  const results = await Promise.all(clients.map(client => executeForClient(env, session, operation.id, client, body, template)));
  const succeeded = results.filter(Boolean).length;
  const failed = results.length - succeeded;
  const status = failed === 0 ? 'completed' : succeeded === 0 ? 'failed' : 'partial';
  const [updated] = await rest<OperationRow[]>(env, `bulk_operations?id=eq.${operation.id}&company_id=eq.${session.companyId}&select=id,target_type,action,status,total_items,processed_items,succeeded_items,failed_items,parameters,output,error_message,created_at,completed_at`, {
    method: 'PATCH',
    body: JSON.stringify({ status, processed_items: results.length, succeeded_items: succeeded, failed_items: failed, completed_at: new Date().toISOString() }),
  });
  return json(updated, 201);
}

export async function handleBulkOperationsRequest(request: Request, env: Env, session: AuthSession) {
  const path = new URL(request.url).pathname;
  try {
    if (request.method === 'GET' && path === '/api/bulk-operations/bootstrap') return getBootstrap(env, session);
    if (request.method === 'POST' && path === '/api/bulk-operations/execute') return execute(request, env, session);
    return null;
  } catch (error) {
    return json({ error: { code: 'BULK_OPERATIONS_ERROR', message: error instanceof Error ? error.message : 'Ошибка массовых операций' } }, 500);
  }
}
