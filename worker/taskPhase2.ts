import { resolveCompanyId } from './companyContext';
import type { Env } from './integrations';

type Row = Record<string, unknown>;

class Phase2Error extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const userId = (request: Request) => text(request.headers.get('x-amanat-auth-user'));
const role = (request: Request) => text(request.headers.get('x-amanat-auth-role'));

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});

function headers(env: Env, extra: HeadersInit = {}): HeadersInit {
  return {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    'content-type': 'application/json',
    ...(extra as Record<string, string>),
  };
}

async function db<T>(env: Env, path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/${path}`, {
    ...init,
    headers: headers(env, init.headers || {}),
  });
  const body = await response.text();
  if (!response.ok) throw new Phase2Error(502, `Task phase2 database ${response.status}: ${body.slice(0, 700)}`);
  return (body ? JSON.parse(body) : null) as T;
}

async function context(request: Request, env: Env) {
  const id = userId(request);
  if (!uuid.test(id)) throw new Phase2Error(401, 'Не удалось определить пользователя');
  const requested = text(request.headers.get('x-imds-company-id'));
  const scoped = requested ? { ...env, CURRENT_COMPANY_ID: requested } : env;
  return { companyId: await resolveCompanyId(scoped, id), userId: id };
}

async function taskRow(env: Env, companyId: string, id: string) {
  const rows = await db<Row[]>(env, `crm_tasks?company_id=eq.${companyId}&id=eq.${id}&source=eq.work_tasks&select=id,title,status,created_by,due_at,workflow_key,stage_key,priority,description,sla_minutes,assignment_mode,link_type,link_id,link_label&limit=1`);
  if (!rows[0]) throw new Phase2Error(404, 'Задача не найдена');
  return rows[0];
}

function canManage(request: Request, row: Row, ctx: { userId: string }) {
  return role(request) === 'administrator' || text(row.created_by) === ctx.userId;
}

async function dependencies(request: Request, env: Env, url: URL) {
  const ctx = await context(request, env);
  const taskId = text(url.searchParams.get('taskId'));
  if (!uuid.test(taskId)) throw new Phase2Error(400, 'Некорректный taskId');
  const task = await taskRow(env, ctx.companyId, taskId);

  if (request.method === 'GET') {
    const rows = await db<Row[]>(env, `crm_task_dependencies?company_id=eq.${ctx.companyId}&task_id=eq.${taskId}&select=id,depends_on_task_id,dependency_type,created_at&order=created_at.asc`);
    const depIds = rows.map((row) => text(row.depends_on_task_id)).filter(Boolean);
    const linked = depIds.length
      ? await db<Row[]>(env, `crm_tasks?company_id=eq.${ctx.companyId}&id=in.(${depIds.join(',')})&select=id,title,status,due_at,priority`)
      : [];
    const linkedById = new Map(linked.map((row) => [text(row.id), row]));
    return json({
      dependencies: rows.map((row) => {
        const linkedTask = linkedById.get(text(row.depends_on_task_id)) || {};
        return {
          id: text(row.id),
          taskId: text(row.depends_on_task_id),
          title: text(linkedTask.title) || 'Задача',
          status: text(linkedTask.status) || 'todo',
          dueAt: linkedTask.due_at || null,
          priority: text(linkedTask.priority) || 'medium',
          dependencyType: text(row.dependency_type) || 'blocks',
        };
      }),
    });
  }

  if (request.method === 'POST') {
    if (!canManage(request, task, ctx)) throw new Phase2Error(403, 'Зависимости может менять постановщик или администратор');
    const body = await request.json().catch(() => ({})) as Row;
    const dependsOnTaskId = text(body.dependsOnTaskId);
    if (!uuid.test(dependsOnTaskId) || dependsOnTaskId === taskId) throw new Phase2Error(400, 'Некорректная зависимость');
    await taskRow(env, ctx.companyId, dependsOnTaskId);
    const existing = await db<Row[]>(env, `crm_task_dependencies?company_id=eq.${ctx.companyId}&task_id=eq.${taskId}&depends_on_task_id=eq.${dependsOnTaskId}&select=id&limit=1`);
    if (existing[0]) return json({ dependency: existing[0] });
    const rows = await db<Row[]>(env, 'crm_task_dependencies', {
      method: 'POST',
      headers: { prefer: 'return=representation' },
      body: JSON.stringify({
        company_id: ctx.companyId,
        task_id: taskId,
        depends_on_task_id: dependsOnTaskId,
        dependency_type: 'blocks',
        created_by: ctx.userId,
      }),
    });
    return json({ dependency: rows[0] || null }, 201);
  }

  if (request.method === 'DELETE') {
    if (!canManage(request, task, ctx)) throw new Phase2Error(403, 'Зависимости может менять постановщик или администратор');
    const dependencyId = text(url.searchParams.get('dependencyId'));
    if (!uuid.test(dependencyId)) throw new Phase2Error(400, 'Некорректный dependencyId');
    await db(env, `crm_task_dependencies?company_id=eq.${ctx.companyId}&task_id=eq.${taskId}&id=eq.${dependencyId}`, {
      method: 'DELETE',
      headers: { prefer: 'return=minimal' },
    });
    return json({ ok: true });
  }

  return json({ error: 'Method not allowed' }, 405);
}

async function recurrence(request: Request, env: Env, url: URL) {
  const ctx = await context(request, env);
  const taskId = text(url.searchParams.get('taskId'));
  if (!uuid.test(taskId)) throw new Phase2Error(400, 'Некорректный taskId');
  const task = await taskRow(env, ctx.companyId, taskId);

  if (request.method === 'GET') {
    const rows = await db<Row[]>(env, `crm_task_recurrence_rules?company_id=eq.${ctx.companyId}&source_task_id=eq.${taskId}&select=*&limit=1`);
    const row = rows[0];
    return json({
      rule: row ? {
        id: text(row.id),
        frequency: text(row.frequency),
        intervalCount: Number(row.interval_count) || 1,
        nextRunAt: row.next_run_at,
        enabled: Boolean(row.enabled),
        lastRunAt: row.last_run_at || null,
      } : null,
    });
  }

  if (!canManage(request, task, ctx)) throw new Phase2Error(403, 'Повторение может менять постановщик или администратор');

  if (request.method === 'DELETE') {
    await db(env, `crm_task_recurrence_rules?company_id=eq.${ctx.companyId}&source_task_id=eq.${taskId}`, {
      method: 'PATCH',
      headers: { prefer: 'return=minimal' },
      body: JSON.stringify({ enabled: false, updated_at: new Date().toISOString() }),
    });
    return json({ ok: true });
  }

  if (request.method === 'PUT') {
    if (text(task.assignment_mode) === 'individual') {
      throw new Phase2Error(400, 'Повторение индивидуальных задач будет добавлено отдельным режимом. Сейчас используйте общую задачу.');
    }
    const body = await request.json().catch(() => ({})) as Row;
    const frequency = text(body.frequency);
    if (!['daily', 'weekly', 'monthly'].includes(frequency)) throw new Phase2Error(400, 'frequency: daily, weekly или monthly');
    const intervalCount = Math.max(1, Math.min(365, Number(body.intervalCount) || 1));
    const nextRunAt = text(body.nextRunAt);
    if (!nextRunAt || Number.isNaN(new Date(nextRunAt).getTime())) throw new Phase2Error(400, 'Укажите дату следующего запуска');
    const existing = await db<Row[]>(env, `crm_task_recurrence_rules?company_id=eq.${ctx.companyId}&source_task_id=eq.${taskId}&select=id&limit=1`);
    const payload = {
      frequency,
      interval_count: intervalCount,
      next_run_at: new Date(nextRunAt).toISOString(),
      enabled: true,
      updated_at: new Date().toISOString(),
    };
    const rows = existing[0]
      ? await db<Row[]>(env, `crm_task_recurrence_rules?company_id=eq.${ctx.companyId}&id=eq.${text(existing[0].id)}`, {
          method: 'PATCH', headers: { prefer: 'return=representation' }, body: JSON.stringify(payload),
        })
      : await db<Row[]>(env, 'crm_task_recurrence_rules', {
          method: 'POST', headers: { prefer: 'return=representation' },
          body: JSON.stringify({ company_id: ctx.companyId, source_task_id: taskId, created_by: ctx.userId, ...payload }),
        });
    return json({ rule: rows[0] || null });
  }

  return json({ error: 'Method not allowed' }, 405);
}

async function calendar(request: Request, env: Env, url: URL) {
  const ctx = await context(request, env);
  const from = text(url.searchParams.get('from'));
  const to = text(url.searchParams.get('to'));
  if (!from || !to || Number.isNaN(new Date(from).getTime()) || Number.isNaN(new Date(to).getTime())) {
    throw new Phase2Error(400, 'Укажите from и to');
  }
  const rows = await db<Row[]>(env, `crm_tasks?company_id=eq.${ctx.companyId}&source=eq.work_tasks&due_at=gte.${encodeURIComponent(new Date(from).toISOString())}&due_at=lte.${encodeURIComponent(new Date(to).toISOString())}&select=id,title,status,stage_key,workflow_key,priority,due_at,link_type,link_id,link_label&order=due_at.asc&limit=1000`);
  return json({
    items: rows.map((row) => ({
      id: text(row.id),
      title: text(row.title),
      status: text(row.status),
      stageKey: text(row.stage_key),
      workflowKey: text(row.workflow_key),
      priority: text(row.priority),
      dueAt: row.due_at,
      linkType: row.link_type || null,
      linkId: row.link_id || null,
      linkLabel: row.link_label || null,
    })),
  });
}

export async function assertTaskDependenciesComplete(request: Request, env: Env, url: URL): Promise<Response | null> {
  if (request.method !== 'PATCH') return null;
  const match = url.pathname.match(/^\/api\/tasks\/([0-9a-f-]+)(?:\/execution)?$/i);
  if (!match) return null;
  const body = await request.clone().json().catch(() => ({})) as Row;
  const completing = text(body.status) === 'done' || Boolean(text(body.resultCode));
  if (!completing) return null;
  const ctx = await context(request, env);
  const taskId = match[1];
  const deps = await db<Row[]>(env, `crm_task_dependencies?company_id=eq.${ctx.companyId}&task_id=eq.${taskId}&select=depends_on_task_id`);
  if (!deps.length) return null;
  const ids = deps.map((row) => text(row.depends_on_task_id)).filter(Boolean);
  const tasks = await db<Row[]>(env, `crm_tasks?company_id=eq.${ctx.companyId}&id=in.(${ids.join(',')})&select=id,title,status`);
  const blocked = tasks.filter((row) => text(row.status) !== 'done');
  if (!blocked.length) return null;
  return json({
    error: 'Сначала завершите зависимые задачи',
    code: 'TASK_DEPENDENCY_BLOCKED',
    blockedBy: blocked.map((row) => ({ id: text(row.id), title: text(row.title), status: text(row.status) })),
  }, 409);
}

function nextRun(current: Date, frequency: string, interval: number) {
  const date = new Date(current);
  if (frequency === 'daily') date.setUTCDate(date.getUTCDate() + interval);
  else if (frequency === 'weekly') date.setUTCDate(date.getUTCDate() + 7 * interval);
  else date.setUTCMonth(date.getUTCMonth() + interval);
  return date;
}

function firstStage(workflowKey: string) {
  if (workflowKey === 'call_center') return 'new';
  if (workflowKey === 'marketing') return 'planned';
  if (workflowKey === 'content') return 'idea';
  return 'todo';
}

async function cloneRule(env: Env, rule: Row) {
  const companyId = text(rule.company_id);
  const sourceId = text(rule.source_task_id);
  const runAt = new Date(String(rule.next_run_at));
  if (!companyId || !sourceId || Number.isNaN(runAt.getTime())) return false;
  const source = await taskRow(env, companyId, sourceId);
  if (text(source.assignment_mode) === 'individual') return false;

  const ruleId = text(rule.id);
  const dueAt = runAt.toISOString();
  const exists = await db<Row[]>(env, `crm_tasks?company_id=eq.${companyId}&recurrence_rule_id=eq.${ruleId}&due_at=eq.${encodeURIComponent(dueAt)}&select=id&limit=1`);
  if (exists[0]) return false;

  const sla = Number(source.sla_minutes) || null;
  let inserted: Row[];
  try {
    inserted = await db<Row[]>(env, 'crm_tasks', {
      method: 'POST',
      headers: { prefer: 'return=representation' },
      body: JSON.stringify({
        company_id: companyId,
        title: text(source.title),
        description: source.description || null,
        status: 'todo',
        stage_key: firstStage(text(source.workflow_key)),
        workflow_key: text(source.workflow_key) || 'general',
        priority: text(source.priority) || 'medium',
        due_at: dueAt,
        sla_minutes: sla,
        sla_due_at: sla ? new Date(runAt.getTime() + sla * 60000).toISOString() : null,
        source: 'work_tasks',
        created_by: source.created_by || null,
        assignment_mode: 'shared',
        link_type: source.link_type || null,
        link_id: source.link_id || null,
        link_label: source.link_label || null,
        recurrence_source_task_id: sourceId,
        recurrence_rule_id: ruleId,
      }),
    });
  } catch (error) {
    if (error instanceof Phase2Error && error.message.includes('23505')) return false;
    throw error;
  }

  const taskId = text(inserted[0]?.id);
  if (!taskId) return false;
  const [targets, checklist, watchers] = await Promise.all([
    db<Row[]>(env, `crm_task_targets?company_id=eq.${companyId}&task_id=eq.${sourceId}&select=target_type,target_value,target_label`),
    db<Row[]>(env, `crm_task_checklist?company_id=eq.${companyId}&task_id=eq.${sourceId}&select=title,sort_order`),
    db<Row[]>(env, `crm_task_watchers?company_id=eq.${companyId}&task_id=eq.${sourceId}&select=user_id`),
  ]);

  if (targets.length) {
    await db(env, 'crm_task_targets', {
      method: 'POST', headers: { prefer: 'return=minimal' },
      body: JSON.stringify(targets.map((target) => ({
        company_id: companyId,
        task_id: taskId,
        target_type: target.target_type,
        target_value: target.target_value || null,
        target_label: target.target_label || 'Исполнитель',
      }))),
    });
  }
  if (checklist.length) {
    await db(env, 'crm_task_checklist', {
      method: 'POST', headers: { prefer: 'return=minimal' },
      body: JSON.stringify(checklist.map((item) => ({
        company_id: companyId,
        task_id: taskId,
        title: item.title,
        sort_order: item.sort_order || 0,
        created_by: source.created_by || null,
      }))),
    });
  }
  if (watchers.length) {
    await db(env, 'crm_task_watchers', {
      method: 'POST', headers: { prefer: 'return=minimal' },
      body: JSON.stringify(watchers.map((watcher) => ({
        company_id: companyId,
        task_id: taskId,
        user_id: watcher.user_id,
      }))),
    });
  }
  await db(env, 'crm_task_history', {
    method: 'POST', headers: { prefer: 'return=minimal' },
    body: JSON.stringify({
      company_id: companyId,
      task_id: taskId,
      actor_id: source.created_by || null,
      event_type: 'recurrence_created',
      from_value: sourceId,
      to_value: ruleId,
      meta: { dueAt },
    }),
  });
  return true;
}

export async function runTaskRecurrenceScan(env: Env) {
  const now = new Date().toISOString();
  const rules = await db<Row[]>(env, `crm_task_recurrence_rules?enabled=eq.true&next_run_at=lte.${encodeURIComponent(now)}&select=*&order=next_run_at.asc&limit=200`);
  let created = 0;
  for (const rule of rules) {
    try {
      if (await cloneRule(env, rule)) created += 1;
      const current = new Date(String(rule.next_run_at));
      let next = nextRun(current, text(rule.frequency), Math.max(1, Number(rule.interval_count) || 1));
      while (next.getTime() <= Date.now()) next = nextRun(next, text(rule.frequency), Math.max(1, Number(rule.interval_count) || 1));
      await db(env, `crm_task_recurrence_rules?id=eq.${text(rule.id)}`, {
        method: 'PATCH', headers: { prefer: 'return=minimal' },
        body: JSON.stringify({
          last_run_at: current.toISOString(),
          next_run_at: next.toISOString(),
          updated_at: new Date().toISOString(),
        }),
      });
    } catch (error) {
      console.error('Recurring task generation failed', rule.id, error);
    }
  }
  return { scanned: rules.length, created };
}

export async function handleTaskPhase2(request: Request, env: Env, url: URL): Promise<Response | null> {
  try {
    if (url.pathname === '/api/tasks/phase2/dependencies') return await dependencies(request, env, url);
    if (url.pathname === '/api/tasks/phase2/recurrence') return await recurrence(request, env, url);
    if (url.pathname === '/api/tasks/phase2/calendar' && request.method === 'GET') return await calendar(request, env, url);
    return null;
  } catch (error) {
    if (error instanceof Phase2Error) return json({ error: error.message }, error.status);
    console.error('Task phase2 error', error);
    return json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
}
