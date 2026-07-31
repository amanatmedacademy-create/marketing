interface Env {
  ASSETS: Fetcher;
  APP_ENV: string;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  DEFAULT_COMPANY_ID?: string;
}

const json = (body: unknown, init: ResponseInit = {}) => new Response(JSON.stringify(body), {
  ...init,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...init.headers },
});
const securityHeaders = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
};
function secure(response: Response) {
  const secured = new Response(response.body, response);
  Object.entries(securityHeaders).forEach(([key, value]) => secured.headers.set(key, value));
  return secured;
}
function assertSupabase(env: Env): asserts env is Env & { SUPABASE_SERVICE_ROLE_KEY: string; DEFAULT_COMPANY_ID: string } {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY || !env.DEFAULT_COMPANY_ID) throw new Error('Supabase environment is not configured');
}
async function supabaseRest<T>(env: Env, table: string, query: string, init: RequestInit = {}): Promise<T> {
  assertSupabase(env);
  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}?${query}`, {
    ...init,
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      'content-type': 'application/json',
      prefer: 'return=representation',
      ...init.headers,
    },
  });
  if (!response.ok) throw new Error(`Supabase request failed: ${response.status} ${await response.text()}`);
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

async function getDashboard(env: Env) {
  assertSupabase(env);
  const company = `company_id=eq.${env.DEFAULT_COMPANY_ID}`;
  const [deals, tasks, stages] = await Promise.all([
    supabaseRest<Array<{ amount: number | string; status: string }>>(env, 'deals', `select=amount,status&${company}`),
    supabaseRest<Array<{ status: string }>>(env, 'tasks', `select=status&${company}`),
    supabaseRest<Array<{ id: string; name: string; position: number }>>(env, 'pipeline_stages', `select=id,name,position&${company}&order=position.asc`),
  ]);
  const openDeals = deals.filter((deal) => deal.status === 'open');
  return {
    metrics: {
      amountInWork: openDeals.reduce((sum, deal) => sum + Number(deal.amount || 0), 0),
      newDeals: openDeals.length,
      openTasks: tasks.filter((task) => !['done', 'cancelled'].includes(task.status)).length,
      unansweredConversations: 0,
    },
    stages,
  };
}

async function getPipelines(env: Env) {
  assertSupabase(env);
  const company = env.DEFAULT_COMPANY_ID;
  const [pipelines, stages] = await Promise.all([
    supabaseRest<Array<{ id: string; name: string; is_default: boolean }>>(env, 'pipelines', `select=id,name,is_default&company_id=eq.${company}&order=created_at.asc`),
    supabaseRest<Array<{ id: string; pipeline_id: string; name: string; position: number; color: string | null }>>(env, 'pipeline_stages', `select=id,pipeline_id,name,position,color&company_id=eq.${company}&order=position.asc`),
  ]);
  return pipelines.map((pipeline, index) => ({
    id: pipeline.id,
    name: pipeline.name,
    isDefault: pipeline.is_default,
    order: index,
    stages: stages.filter((stage) => stage.pipeline_id === pipeline.id).map((stage) => ({
      id: stage.id,
      pipelineId: stage.pipeline_id,
      name: stage.name,
      color: stage.color ?? '#4F6EF7',
      order: stage.position,
      isWon: false,
      isLost: false,
      affectsRevenue: true,
    })),
  }));
}

function mapDeal(row: { id: string; pipeline_id: string; stage_id: string; title: string; contact_name: string | null; phone: string | null; amount: number | string; created_at: string }) {
  const names = (row.contact_name ?? '').trim().split(/\s+/);
  return {
    id: row.id,
    pipelineId: row.pipeline_id,
    stageId: row.stage_id,
    title: row.title,
    oneTimeAmount: String(row.amount ?? 0),
    recurringAmount: null,
    order: new Date(row.created_at).getTime(),
    contact: row.contact_name || row.phone ? { id: row.id, firstName: names[0] || null, lastName: names.slice(1).join(' ') || null, phone: row.phone } : null,
    manager: null,
    tags: [],
  };
}
async function listDeals(env: Env, pipelineId?: string) {
  assertSupabase(env);
  const pipelineFilter = pipelineId ? `&pipeline_id=eq.${pipelineId}` : '';
  const rows = await supabaseRest<Array<Parameters<typeof mapDeal>[0]>>(env, 'deals', `select=id,pipeline_id,stage_id,title,contact_name,phone,amount,created_at&company_id=eq.${env.DEFAULT_COMPANY_ID}${pipelineFilter}&order=created_at.desc`);
  const items = rows.map(mapDeal);
  return { items, total: items.length, page: 1, pageSize: 100 };
}
async function createDeal(request: Request, env: Env) {
  assertSupabase(env);
  const body = await request.json() as { title?: string; stageId?: string; pipelineId?: string };
  if (!body.title || !body.stageId || !body.pipelineId) return json({ error: { code: 'VALIDATION_ERROR', message: 'title, stageId and pipelineId are required' } }, { status: 400 });
  const rows = await supabaseRest<Array<Parameters<typeof mapDeal>[0]>>(env, 'deals', 'select=*', {
    method: 'POST',
    body: JSON.stringify({ company_id: env.DEFAULT_COMPANY_ID, pipeline_id: body.pipelineId, stage_id: body.stageId, title: body.title, amount: 0, status: 'open' }),
  });
  return json(mapDeal(rows[0]), { status: 201 });
}
async function moveDeal(request: Request, env: Env, dealId: string) {
  assertSupabase(env);
  const body = await request.json() as { stageId?: string };
  if (!body.stageId) return json({ error: { code: 'VALIDATION_ERROR', message: 'stageId is required' } }, { status: 400 });
  const rows = await supabaseRest<Array<Parameters<typeof mapDeal>[0]>>(env, 'deals', `id=eq.${dealId}&company_id=eq.${env.DEFAULT_COMPANY_ID}&select=id,pipeline_id,stage_id,title,contact_name,phone,amount,created_at`, {
    method: 'PATCH',
    body: JSON.stringify({ stage_id: body.stageId, updated_at: new Date().toISOString() }),
  });
  if (!rows.length) return json({ error: { code: 'NOT_FOUND', message: 'Deal not found' } }, { status: 404 });
  return json(mapDeal(rows[0]));
}

async function listTasks(env: Env) {
  assertSupabase(env);
  return supabaseRest(env, 'tasks', `select=id,title,status,priority,due_at,deal_id,assignee_user_id&company_id=eq.${env.DEFAULT_COMPANY_ID}&order=due_at.asc.nullslast,created_at.desc`);
}
async function updateTask(request: Request, env: Env, taskId: string) {
  assertSupabase(env);
  const body = await request.json() as { status?: string; priority?: string; title?: string; dueAt?: string | null };
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (body.status !== undefined) patch.status = body.status;
  if (body.priority !== undefined) patch.priority = body.priority;
  if (body.title !== undefined) patch.title = body.title;
  if (body.dueAt !== undefined) patch.due_at = body.dueAt;
  const rows = await supabaseRest<unknown[]>(env, 'tasks', `id=eq.${taskId}&company_id=eq.${env.DEFAULT_COMPANY_ID}&select=id,title,status,priority,due_at,deal_id,assignee_user_id`, {
    method: 'PATCH', body: JSON.stringify(patch),
  });
  if (!rows.length) return json({ error: { code: 'NOT_FOUND', message: 'Task not found' } }, { status: 404 });
  return json(rows[0]);
}
async function listTeam(env: Env) {
  assertSupabase(env);
  const members = await supabaseRest<Array<{ user_id: string; role: string; department: string | null; is_online: boolean; last_seen_at: string | null }>>(
    env, 'company_members', `select=user_id,role,department,is_online,last_seen_at&company_id=eq.${env.DEFAULT_COMPANY_ID}&order=created_at.asc`,
  );
  const ids = members.map((member) => member.user_id);
  const profiles = ids.length
    ? await supabaseRest<Array<{ user_id: string; first_name: string; last_name: string; avatar_color: string }>>(env, 'user_profiles', `select=user_id,first_name,last_name,avatar_color&user_id=in.(${ids.join(',')})`)
    : [];
  return members.map((member) => {
    const profile = profiles.find((item) => item.user_id === member.user_id);
    return {
      userId: member.user_id,
      firstName: profile?.first_name ?? '',
      lastName: profile?.last_name ?? '',
      avatarColor: profile?.avatar_color ?? '#4F6EF7',
      role: member.role,
      department: member.department,
      isOnline: member.is_online,
      lastSeenAt: member.last_seen_at,
    };
  });
}
async function listProjects(env: Env) {
  assertSupabase(env);
  const [projects, items] = await Promise.all([
    supabaseRest<Array<{ id: string; name: string; description: string | null }>>(env, 'projects', `select=id,name,description&company_id=eq.${env.DEFAULT_COMPANY_ID}&order=created_at.desc`),
    supabaseRest<Array<{ id: string; project_id: string; title: string; status: string; position: number }>>(env, 'project_items', `select=id,project_id,title,status,position&company_id=eq.${env.DEFAULT_COMPANY_ID}&order=position.asc`),
  ]);
  return projects.map((project) => ({ ...project, items: items.filter((item) => item.project_id === project.id) }));
}
async function getAccounting(env: Env) {
  assertSupabase(env);
  const transactions = await supabaseRest<Array<{ id: string; account_id: string | null; type: string; amount: number | string; description: string; occurred_at: string }>>(
    env, 'finance_transactions', `select=id,account_id,type,amount,description,occurred_at&company_id=eq.${env.DEFAULT_COMPANY_ID}&order=occurred_at.desc`,
  );
  const accounts = await supabaseRest<Array<{ id: string; name: string }>>(env, 'finance_accounts', `select=id,name&company_id=eq.${env.DEFAULT_COMPANY_ID}`);
  const income = transactions.filter((item) => item.type === 'income').reduce((sum, item) => sum + Number(item.amount), 0);
  const expense = transactions.filter((item) => item.type === 'expense').reduce((sum, item) => sum + Number(item.amount), 0);
  return {
    summary: { income, expense, profit: income - expense, vat: income * 0.12 },
    transactions: transactions.map((item) => ({ ...item, amount: Number(item.amount), accountName: accounts.find((account) => account.id === item.account_id)?.name ?? 'Без счёта' })),
  };
}

async function routeApi(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  if (request.method === 'GET' && url.pathname === '/api/config') return json({ environment: env.APP_ENV, supabaseConfigured: Boolean(env.SUPABASE_URL) });
  if (request.method === 'GET' && url.pathname === '/api/dashboard') return json(await getDashboard(env));
  if (request.method === 'GET' && url.pathname === '/api/pipelines') return json(await getPipelines(env));
  if (request.method === 'GET' && url.pathname === '/api/deals') return json(await listDeals(env, url.searchParams.get('pipelineId') ?? undefined));
  if (request.method === 'POST' && url.pathname === '/api/deals') return createDeal(request, env);
  if (request.method === 'GET' && url.pathname === '/api/tasks') return json(await listTasks(env));
  if (request.method === 'GET' && url.pathname === '/api/team') return json(await listTeam(env));
  if (request.method === 'GET' && url.pathname === '/api/projects') return json(await listProjects(env));
  if (request.method === 'GET' && url.pathname === '/api/accounting') return json(await getAccounting(env));
  const moveMatch = url.pathname.match(/^\/api\/deals\/([^/]+)\/move$/);
  if (request.method === 'PATCH' && moveMatch) return moveDeal(request, env, moveMatch[1]);
  const taskMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)$/);
  if (request.method === 'PATCH' && taskMatch) return updateTask(request, env, taskMatch[1]);
  return json({ error: { code: 'NOT_FOUND', message: 'API route not found' } }, { status: 404 });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    try {
      if (url.pathname === '/health') return secure(json({ status: 'ok', service: 'imds-crm-edge', environment: env.APP_ENV, timestamp: new Date().toISOString() }));
      if (url.pathname.startsWith('/api/')) return secure(await routeApi(request, env));
      return secure(await env.ASSETS.fetch(request));
    } catch (error) {
      return secure(json({ error: { code: 'INTERNAL_ERROR', message: error instanceof Error ? error.message : 'Unknown error' } }, { status: 500 }));
    }
  },
} satisfies ExportedHandler<Env>;
