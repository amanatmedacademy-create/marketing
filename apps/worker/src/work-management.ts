import type { AuthEnv, AuthSession } from './auth';

type Env = AuthEnv & { SUPABASE_SERVICE_ROLE_KEY?: string };

type TaskRow = {
  id: string;
  title: string;
  description: string | null;
  status: 'todo' | 'in_progress' | 'done' | 'cancelled';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  due_at: string | null;
  project_id: string | null;
  assignee_id: string | null;
  created_at: string;
  updated_at: string;
};

type ProjectRow = {
  id: string;
  name: string;
  description: string | null;
  priority: string;
  budget: number | string;
  client_name: string | null;
  starts_at: string | null;
  due_at: string | null;
  technical_spec: string | null;
  status: string;
  created_at: string;
};

type ProjectItemRow = {
  id: string;
  project_id: string;
  title: string;
  description: string | null;
  status: 'todo' | 'in_progress' | 'done';
  priority: string;
  due_at: string | null;
  position: number;
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});

function assertEnv(env: Env): asserts env is Env & { SUPABASE_SERVICE_ROLE_KEY: string } {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('Supabase environment is not configured');
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
  if (!response.ok) throw new Error(`Work management query failed: ${response.status} ${await response.text()}`);
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

const allowedStatus = new Set(['todo', 'in_progress', 'done', 'cancelled']);
const allowedPriority = new Set(['low', 'medium', 'high', 'urgent']);

async function listTasks(env: Env, session: AuthSession) {
  return rest<TaskRow[]>(env, `crm_tasks?select=id,title,description,status,priority,due_at,project_id,assignee_id,created_at,updated_at&company_id=eq.${session.companyId}&order=due_at.asc.nullslast,created_at.desc`);
}

async function createTask(request: Request, env: Env, session: AuthSession) {
  const body = await request.json() as Partial<TaskRow>;
  if (!body.title?.trim()) return json({ error: { code: 'VALIDATION_ERROR', message: 'Название задачи обязательно' } }, 400);
  const rows = await rest<TaskRow[]>(env, 'crm_tasks?select=id,title,description,status,priority,due_at,project_id,assignee_id,created_at,updated_at', {
    method: 'POST',
    body: JSON.stringify({
      company_id: session.companyId,
      title: body.title.trim(),
      description: body.description?.trim() || null,
      status: allowedStatus.has(body.status ?? '') ? body.status : 'todo',
      priority: allowedPriority.has(body.priority ?? '') ? body.priority : 'medium',
      due_at: body.due_at || null,
      project_id: body.project_id || null,
      assignee_id: body.assignee_id || null,
      created_by: session.user.id,
    }),
  });
  return json(rows[0], 201);
}

async function updateTask(request: Request, env: Env, session: AuthSession, id: string) {
  const body = await request.json() as Partial<TaskRow>;
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (typeof body.title === 'string') patch.title = body.title.trim();
  if (typeof body.description === 'string' || body.description === null) patch.description = body.description?.trim() || null;
  if (body.status && allowedStatus.has(body.status)) {
    patch.status = body.status;
    patch.completed_at = body.status === 'done' ? new Date().toISOString() : null;
  }
  if (body.priority && allowedPriority.has(body.priority)) patch.priority = body.priority;
  if ('due_at' in body) patch.due_at = body.due_at || null;
  if ('project_id' in body) patch.project_id = body.project_id || null;
  if ('assignee_id' in body) patch.assignee_id = body.assignee_id || null;

  const rows = await rest<TaskRow[]>(env, `crm_tasks?id=eq.${encodeURIComponent(id)}&company_id=eq.${session.companyId}&select=id,title,description,status,priority,due_at,project_id,assignee_id,created_at,updated_at`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
  if (!rows.length) return json({ error: { code: 'NOT_FOUND', message: 'Задача не найдена' } }, 404);
  return json(rows[0]);
}

async function listProjects(env: Env, session: AuthSession) {
  const [projects, items] = await Promise.all([
    rest<ProjectRow[]>(env, `crm_projects?select=id,name,description,priority,budget,client_name,starts_at,due_at,technical_spec,status,created_at&company_id=eq.${session.companyId}&status=neq.archived&order=created_at.desc`),
    rest<ProjectItemRow[]>(env, `crm_project_items?select=id,project_id,title,description,status,priority,due_at,position&company_id=eq.${session.companyId}&order=position.asc,created_at.asc`),
  ]);
  return projects.map(project => ({
    ...project,
    budget: Number(project.budget ?? 0),
    items: items.filter(item => item.project_id === project.id),
  }));
}

async function createProject(request: Request, env: Env, session: AuthSession) {
  const body = await request.json() as Partial<ProjectRow>;
  if (!body.name?.trim()) return json({ error: { code: 'VALIDATION_ERROR', message: 'Название проекта обязательно' } }, 400);
  const rows = await rest<ProjectRow[]>(env, 'crm_projects?select=id,name,description,priority,budget,client_name,starts_at,due_at,technical_spec,status,created_at', {
    method: 'POST',
    body: JSON.stringify({
      company_id: session.companyId,
      name: body.name.trim(),
      description: body.description?.trim() || null,
      priority: allowedPriority.has(body.priority ?? '') ? body.priority : 'medium',
      budget: Number(body.budget ?? 0),
      client_name: body.client_name?.trim() || null,
      starts_at: body.starts_at || null,
      due_at: body.due_at || null,
      technical_spec: body.technical_spec?.trim() || null,
      status: 'active',
    }),
  });
  return json({ ...rows[0], budget: Number(rows[0].budget ?? 0), items: [] }, 201);
}

export async function handleWorkManagementRequest(request: Request, env: Env, session: AuthSession) {
  const url = new URL(request.url);
  try {
    if (request.method === 'GET' && url.pathname === '/api/tasks') return json(await listTasks(env, session));
    if (request.method === 'POST' && url.pathname === '/api/tasks') return createTask(request, env, session);
    const taskMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)$/);
    if (request.method === 'PATCH' && taskMatch) return updateTask(request, env, session, taskMatch[1]);

    if (request.method === 'GET' && url.pathname === '/api/projects') return json(await listProjects(env, session));
    if (request.method === 'POST' && url.pathname === '/api/projects') return createProject(request, env, session);
    return null;
  } catch (error) {
    return json({ error: { code: 'WORK_MANAGEMENT_ERROR', message: error instanceof Error ? error.message : 'Ошибка задач и проектов' } }, 500);
  }
}
