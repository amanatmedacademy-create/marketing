interface Env {
  ASSETS: Fetcher;
  APP_ENV: string;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
}

type AuthContext = {
  authUserId: string;
  marketingUserId: string;
  companyId: string;
  role: 'owner' | 'administrator' | 'manager' | 'viewer';
};

type PipelineRow = { id: string; company_id: string; name: string; is_default: boolean; position: number };
type StageRow = { id: string; company_id: string; pipeline_id: string; name: string; position: number; color: string | null; stage_type: 'open' | 'won' | 'lost' };
type DealRow = {
  id: string; company_id: string; pipeline_id: string; stage_id: string; title: string; phone: string | null;
  email: string | null; source: string | null; amount: number | string; position: number | string;
  created_at: string; assignee_id: string | null; deleted_at?: string | null;
};
type ProjectRow = {
  id: string; name: string; description: string | null; priority: string; budget: number | string;
  client_deal_id: string | null; client_name: string | null; starts_at: string | null; due_at: string | null;
  technical_spec: string | null; status: string; created_at: string;
};
type ProjectItemRow = {
  id: string; project_id: string; title: string; description: string | null; status: string;
  priority: string; due_at: string | null; position: number;
};

const json = (body: unknown, init: ResponseInit = {}) => new Response(JSON.stringify(body), {
  ...init,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    ...init.headers,
  },
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

function assertSupabase(env: Env): asserts env is Env & { SUPABASE_SERVICE_ROLE_KEY: string } {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('Supabase environment is not configured');
}

function bearerToken(request: Request) {
  const value = request.headers.get('authorization') ?? '';
  return value.startsWith('Bearer ') ? value.slice(7).trim() : '';
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

async function authenticate(request: Request, env: Env): Promise<AuthContext | Response> {
  assertSupabase(env);
  const token = bearerToken(request);
  if (!token) return json({ error: { code: 'UNAUTHORIZED', message: 'Authorization token is required' } }, { status: 401 });

  const authResponse = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${token}` },
  });
  if (!authResponse.ok) return json({ error: { code: 'UNAUTHORIZED', message: 'Invalid or expired session' } }, { status: 401 });
  const authUser = await authResponse.json() as { id?: string };
  if (!authUser.id) return json({ error: { code: 'UNAUTHORIZED', message: 'Invalid session payload' } }, { status: 401 });

  const users = await supabaseRest<Array<{ id: string }>>(env, 'marketing_users', `select=id&auth_user_id=eq.${authUser.id}&status=eq.active&limit=1`);
  if (!users.length) return json({ error: { code: 'PROFILE_NOT_FOUND', message: 'Marketing user profile is not configured' } }, { status: 403 });

  const memberships = await supabaseRest<Array<{ company_id: string; role: AuthContext['role'] }>>(
    env,
    'crm_company_members',
    `select=company_id,role&user_id=eq.${users[0].id}&status=eq.active&order=created_at.asc&limit=1`,
  );
  if (!memberships.length) return json({ error: { code: 'COMPANY_NOT_FOUND', message: 'Active company membership is required' } }, { status: 403 });

  return { authUserId: authUser.id, marketingUserId: users[0].id, companyId: memberships[0].company_id, role: memberships[0].role };
}

function requireEditor(context: AuthContext) {
  return context.role === 'owner' || context.role === 'administrator' || context.role === 'manager';
}

function mapPipeline(pipeline: PipelineRow, stages: StageRow[]) {
  return {
    id: pipeline.id,
    name: pipeline.name,
    isDefault: pipeline.is_default,
    order: pipeline.position,
    stages: stages.filter((stage) => stage.pipeline_id === pipeline.id).map((stage) => ({
      id: stage.id,
      pipelineId: stage.pipeline_id,
      name: stage.name,
      color: stage.color ?? '#4F6EF7',
      order: stage.position,
      isWon: stage.stage_type === 'won',
      isLost: stage.stage_type === 'lost',
      affectsRevenue: stage.stage_type !== 'lost',
    })),
  };
}

function mapDeal(row: DealRow) {
  return {
    id: row.id,
    pipelineId: row.pipeline_id,
    stageId: row.stage_id,
    title: row.title,
    phone: row.phone,
    email: row.email,
    oneTimeAmount: String(row.amount ?? 0),
    recurringAmount: null,
    order: Number(row.position ?? 0),
    contact: row.phone || row.email ? {
      id: row.id,
      firstName: row.title,
      lastName: null,
      phone: row.phone,
      email: row.email,
    } : null,
    manager: null,
    source: row.source,
    tags: [],
  };
}

function mapProject(row: ProjectRow, items: ProjectItemRow[]) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    priority: row.priority,
    budget: Number(row.budget ?? 0),
    clientDealId: row.client_deal_id,
    clientName: row.client_name,
    startsAt: row.starts_at,
    dueAt: row.due_at,
    technicalSpec: row.technical_spec,
    status: row.status,
    createdAt: row.created_at,
    items: items.filter((item) => item.project_id === row.id).map((item) => ({
      id: item.id,
      title: item.title,
      description: item.description,
      status: item.status,
      priority: item.priority,
      dueAt: item.due_at,
      position: item.position,
    })),
  };
}

async function getPipelines(env: Env, companyId: string) {
  const [pipelines, stages] = await Promise.all([
    supabaseRest<PipelineRow[]>(env, 'crm_pipelines', `select=id,company_id,name,is_default,position&company_id=eq.${companyId}&order=position.asc,created_at.asc`),
    supabaseRest<StageRow[]>(env, 'crm_pipeline_stages', `select=id,company_id,pipeline_id,name,position,color,stage_type&company_id=eq.${companyId}&order=position.asc`),
  ]);
  return pipelines.map((pipeline) => mapPipeline(pipeline, stages));
}

async function createPipeline(request: Request, env: Env, context: AuthContext) {
  if (!requireEditor(context)) return json({ error: { code: 'FORBIDDEN', message: 'Insufficient permissions' } }, { status: 403 });
  const body = await request.json() as { name?: string; isDefault?: boolean; stages?: Array<{ name?: string; color?: string; isWon?: boolean; isLost?: boolean }> };
  const stages = body.stages ?? [];
  if (!body.name?.trim() || stages.length < 2 || stages.some((stage) => !stage.name?.trim())) {
    return json({ error: { code: 'VALIDATION_ERROR', message: 'Pipeline name and at least two stages are required' } }, { status: 400 });
  }

  if (body.isDefault) {
    await supabaseRest(env, 'crm_pipelines', `company_id=eq.${context.companyId}`, {
      method: 'PATCH',
      body: JSON.stringify({ is_default: false, updated_at: new Date().toISOString() }),
    });
  }

  const pipelineRows = await supabaseRest<PipelineRow[]>(env, 'crm_pipelines', 'select=*', {
    method: 'POST',
    body: JSON.stringify({ company_id: context.companyId, name: body.name.trim(), is_default: Boolean(body.isDefault), position: Date.now() }),
  });
  const pipeline = pipelineRows[0];
  try {
    const stageRows = await supabaseRest<StageRow[]>(env, 'crm_pipeline_stages', 'select=*', {
      method: 'POST',
      body: JSON.stringify(stages.map((stage, index) => ({
        company_id: context.companyId,
        pipeline_id: pipeline.id,
        name: stage.name!.trim(),
        color: stage.color || '#64748B',
        position: index,
        probability: stage.isWon ? 100 : stage.isLost ? 0 : Math.min(90, 10 + index * 20),
        stage_type: stage.isWon ? 'won' : stage.isLost ? 'lost' : 'open',
      }))),
    });
    return json(mapPipeline(pipeline, stageRows), { status: 201 });
  } catch (error) {
    await supabaseRest(env, 'crm_pipelines', `id=eq.${pipeline.id}&company_id=eq.${context.companyId}`, { method: 'DELETE' });
    throw error;
  }
}

async function bootstrapPipeline(env: Env, context: AuthContext) {
  const existing = await getPipelines(env, context.companyId);
  if (existing.length) return existing.find((pipeline) => pipeline.isDefault) ?? existing[0];
  if (!requireEditor(context)) return null;
  const request = new Request('https://internal/api/pipelines', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'Основная воронка',
      isDefault: true,
      stages: [
        { name: 'Новый лид', color: '#3B82F6' },
        { name: 'В работе', color: '#F59E0B' },
        { name: 'Назначена консультация', color: '#8B5CF6' },
        { name: 'Продажа', color: '#22C55E', isWon: true },
        { name: 'Отказ', color: '#EF4444', isLost: true },
      ],
    }),
  });
  const response = await createPipeline(request, env, context);
  return response.json();
}

async function renamePipeline(request: Request, env: Env, context: AuthContext, pipelineId: string) {
  if (!requireEditor(context)) return json({ error: { code: 'FORBIDDEN', message: 'Insufficient permissions' } }, { status: 403 });
  const body = await request.json() as { name?: string };
  if (!body.name?.trim()) return json({ error: { code: 'VALIDATION_ERROR', message: 'Pipeline name is required' } }, { status: 400 });
  const rows = await supabaseRest<PipelineRow[]>(env, 'crm_pipelines', `id=eq.${pipelineId}&company_id=eq.${context.companyId}&select=*`, {
    method: 'PATCH',
    body: JSON.stringify({ name: body.name.trim(), updated_at: new Date().toISOString() }),
  });
  if (!rows.length) return json({ error: { code: 'NOT_FOUND', message: 'Pipeline not found' } }, { status: 404 });
  const stages = await supabaseRest<StageRow[]>(env, 'crm_pipeline_stages', `select=*&pipeline_id=eq.${pipelineId}&company_id=eq.${context.companyId}&order=position.asc`);
  return json(mapPipeline(rows[0], stages));
}

async function deletePipeline(env: Env, context: AuthContext, pipelineId: string) {
  if (!requireEditor(context)) return json({ error: { code: 'FORBIDDEN', message: 'Insufficient permissions' } }, { status: 403 });
  const pipelines = await supabaseRest<PipelineRow[]>(env, 'crm_pipelines', `select=*&id=eq.${pipelineId}&company_id=eq.${context.companyId}&limit=1`);
  if (!pipelines.length) return json({ error: { code: 'NOT_FOUND', message: 'Pipeline not found' } }, { status: 404 });
  const deals = await supabaseRest<Array<{ id: string }>>(env, 'crm_deals', `select=id&pipeline_id=eq.${pipelineId}&company_id=eq.${context.companyId}&deleted_at=is.null&limit=1`);
  if (deals.length) return json({ error: { code: 'PIPELINE_NOT_EMPTY', message: 'Move or delete all leads before deleting the pipeline' } }, { status: 409 });

  await supabaseRest(env, 'crm_pipeline_stages', `pipeline_id=eq.${pipelineId}&company_id=eq.${context.companyId}`, { method: 'DELETE' });
  await supabaseRest(env, 'crm_pipelines', `id=eq.${pipelineId}&company_id=eq.${context.companyId}`, { method: 'DELETE' });

  if (pipelines[0].is_default) {
    const remaining = await supabaseRest<PipelineRow[]>(env, 'crm_pipelines', `select=*&company_id=eq.${context.companyId}&order=position.asc&limit=1`);
    if (remaining.length) await supabaseRest(env, 'crm_pipelines', `id=eq.${remaining[0].id}`, { method: 'PATCH', body: JSON.stringify({ is_default: true }) });
  }
  return new Response(null, { status: 204 });
}

async function listDeals(env: Env, context: AuthContext, pipelineId?: string) {
  const pipelineFilter = pipelineId ? `&pipeline_id=eq.${pipelineId}` : '';
  const rows = await supabaseRest<DealRow[]>(env, 'crm_deals', `select=id,company_id,pipeline_id,stage_id,title,phone,email,source,amount,position,created_at,assignee_id&company_id=eq.${context.companyId}&deleted_at=is.null${pipelineFilter}&order=position.asc,created_at.desc`);
  const items = rows.map(mapDeal);
  return { items, total: items.length, page: 1, pageSize: 100 };
}

async function getDeal(env: Env, context: AuthContext, dealId: string) {
  const rows = await supabaseRest<DealRow[]>(env, 'crm_deals', `select=*&id=eq.${dealId}&company_id=eq.${context.companyId}&deleted_at=is.null&limit=1`);
  return rows.length ? json(mapDeal(rows[0])) : json({ error: { code: 'NOT_FOUND', message: 'Deal not found' } }, { status: 404 });
}

async function createDeal(request: Request, env: Env, context: AuthContext) {
  if (!requireEditor(context)) return json({ error: { code: 'FORBIDDEN', message: 'Insufficient permissions' } }, { status: 403 });
  const body = await request.json() as { title?: string; stageId?: string; pipelineId?: string; phone?: string; email?: string; source?: string; amount?: number };
  if (!body.title?.trim() || !body.stageId || !body.pipelineId) return json({ error: { code: 'VALIDATION_ERROR', message: 'title, stageId and pipelineId are required' } }, { status: 400 });
  const stage = await supabaseRest<Array<{ id: string; stage_type: string }>>(env, 'crm_pipeline_stages', `select=id,stage_type&id=eq.${body.stageId}&pipeline_id=eq.${body.pipelineId}&company_id=eq.${context.companyId}&limit=1`);
  if (!stage.length) return json({ error: { code: 'INVALID_STAGE', message: 'Stage does not belong to this pipeline' } }, { status: 400 });
  const rows = await supabaseRest<DealRow[]>(env, 'crm_deals', 'select=*', {
    method: 'POST',
    body: JSON.stringify({
      company_id: context.companyId,
      pipeline_id: body.pipelineId,
      stage_id: body.stageId,
      title: body.title.trim(),
      phone: body.phone?.trim() || null,
      email: body.email?.trim() || null,
      source: body.source?.trim() || null,
      amount: Number(body.amount ?? 0),
      currency: 'KZT',
      status: stage[0].stage_type,
      position: Date.now(),
      created_by: context.marketingUserId,
    }),
  });
  return json(mapDeal(rows[0]), { status: 201 });
}

async function updateDeal(request: Request, env: Env, context: AuthContext, dealId: string) {
  if (!requireEditor(context)) return json({ error: { code: 'FORBIDDEN', message: 'Insufficient permissions' } }, { status: 403 });
  const body = await request.json() as { title?: string; phone?: string | null; email?: string | null; source?: string | null; amount?: number; stageId?: string };
  const current = await supabaseRest<DealRow[]>(env, 'crm_deals', `select=*&id=eq.${dealId}&company_id=eq.${context.companyId}&deleted_at=is.null&limit=1`);
  if (!current.length) return json({ error: { code: 'NOT_FOUND', message: 'Deal not found' } }, { status: 404 });

  let stageId = current[0].stage_id;
  let pipelineId = current[0].pipeline_id;
  let status = 'open';
  if (body.stageId) {
    const stages = await supabaseRest<Array<{ id: string; pipeline_id: string; stage_type: string }>>(env, 'crm_pipeline_stages', `select=id,pipeline_id,stage_type&id=eq.${body.stageId}&company_id=eq.${context.companyId}&limit=1`);
    if (!stages.length) return json({ error: { code: 'INVALID_STAGE', message: 'Stage not found' } }, { status: 400 });
    stageId = stages[0].id;
    pipelineId = stages[0].pipeline_id;
    status = stages[0].stage_type;
  }

  const now = new Date().toISOString();
  const rows = await supabaseRest<DealRow[]>(env, 'crm_deals', `id=eq.${dealId}&company_id=eq.${context.companyId}&deleted_at=is.null&select=*`, {
    method: 'PATCH',
    body: JSON.stringify({
      title: body.title?.trim() || current[0].title,
      phone: body.phone === undefined ? current[0].phone : body.phone?.trim() || null,
      email: body.email === undefined ? current[0].email : body.email?.trim() || null,
      source: body.source === undefined ? current[0].source : body.source?.trim() || null,
      amount: body.amount === undefined ? current[0].amount : Number(body.amount),
      stage_id: stageId,
      pipeline_id: pipelineId,
      status,
      won_at: status === 'won' ? now : null,
      lost_at: status === 'lost' ? now : null,
      updated_at: now,
    }),
  });
  return json(mapDeal(rows[0]));
}

async function moveDeal(request: Request, env: Env, context: AuthContext, dealId: string) {
  const body = await request.json() as { stageId?: string; order?: number };
  if (!body.stageId) return json({ error: { code: 'VALIDATION_ERROR', message: 'stageId is required' } }, { status: 400 });
  return updateDeal(new Request(request.url, { method: 'PATCH', headers: request.headers, body: JSON.stringify({ stageId: body.stageId }) }), env, context, dealId).then(async (response) => {
    if (!response.ok) return response;
    await supabaseRest(env, 'crm_deals', `id=eq.${dealId}&company_id=eq.${context.companyId}`, { method: 'PATCH', body: JSON.stringify({ position: Number(body.order ?? 0) }) });
    return getDeal(env, context, dealId);
  });
}

async function deleteDeal(env: Env, context: AuthContext, dealId: string) {
  if (!requireEditor(context)) return json({ error: { code: 'FORBIDDEN', message: 'Insufficient permissions' } }, { status: 403 });
  const rows = await supabaseRest<DealRow[]>(env, 'crm_deals', `id=eq.${dealId}&company_id=eq.${context.companyId}&deleted_at=is.null&select=*`, {
    method: 'PATCH',
    body: JSON.stringify({ deleted_at: new Date().toISOString(), status: 'archived', updated_at: new Date().toISOString() }),
  });
  return rows.length ? new Response(null, { status: 204 }) : json({ error: { code: 'NOT_FOUND', message: 'Deal not found' } }, { status: 404 });
}

async function listProjects(env: Env, context: AuthContext) {
  const [projects, items] = await Promise.all([
    supabaseRest<ProjectRow[]>(env, 'crm_projects', `select=id,name,description,priority,budget,client_deal_id,client_name,starts_at,due_at,technical_spec,status,created_at&company_id=eq.${context.companyId}&status=neq.archived&order=created_at.desc`),
    supabaseRest<ProjectItemRow[]>(env, 'crm_project_items', `select=id,project_id,title,description,status,priority,due_at,position&company_id=eq.${context.companyId}&order=position.asc,created_at.asc`),
  ]);
  return projects.map((project) => mapProject(project, items));
}

async function createProject(request: Request, env: Env, context: AuthContext) {
  if (!requireEditor(context)) return json({ error: { code: 'FORBIDDEN', message: 'Insufficient permissions' } }, { status: 403 });
  const body = await request.json() as { name?: string; description?: string; priority?: string; budget?: number; clientDealId?: string; clientName?: string; startsAt?: string; dueAt?: string; technicalSpec?: string };
  if (!body.name?.trim()) return json({ error: { code: 'VALIDATION_ERROR', message: 'Project name is required' } }, { status: 400 });
  const priority = ['low', 'medium', 'high', 'urgent'].includes(body.priority ?? '') ? body.priority : 'medium';
  const rows = await supabaseRest<ProjectRow[]>(env, 'crm_projects', 'select=*', {
    method: 'POST',
    body: JSON.stringify({ company_id: context.companyId, name: body.name.trim(), description: body.description?.trim() || null, priority, budget: Number(body.budget ?? 0), client_deal_id: body.clientDealId || null, client_name: body.clientName?.trim() || null, starts_at: body.startsAt || null, due_at: body.dueAt || null, technical_spec: body.technicalSpec?.trim() || null, status: 'active' }),
  });
  return json(mapProject(rows[0], []), { status: 201 });
}

async function getDashboard(env: Env, context: AuthContext) {
  const [pipelines, deals] = await Promise.all([getPipelines(env, context.companyId), listDeals(env, context)]);
  const openDeals = deals.items.filter((deal) => {
    const stage = pipelines.flatMap((pipeline) => pipeline.stages).find((item) => item.id === deal.stageId);
    return !stage?.isWon && !stage?.isLost;
  });
  return {
    metrics: {
      amountInWork: openDeals.reduce((sum, deal) => sum + Number(deal.oneTimeAmount || 0), 0),
      newDeals: openDeals.length,
      openTasks: 0,
      unansweredConversations: 0,
    },
    stages: pipelines.flatMap((pipeline) => pipeline.stages),
  };
}

async function routeApi(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  if (request.method === 'GET' && url.pathname === '/api/config') return json({ environment: env.APP_ENV, supabaseConfigured: Boolean(env.SUPABASE_URL) });

  const auth = await authenticate(request, env);
  if (auth instanceof Response) return auth;

  if (request.method === 'GET' && url.pathname === '/api/dashboard') return json(await getDashboard(env, auth));
  if (request.method === 'GET' && url.pathname === '/api/pipelines') return json(await getPipelines(env, auth.companyId));
  if (request.method === 'POST' && url.pathname === '/api/pipelines') return createPipeline(request, env, auth);
  if (request.method === 'POST' && url.pathname === '/api/pipelines/bootstrap') return json(await bootstrapPipeline(env, auth), { status: 201 });
  if (request.method === 'GET' && url.pathname === '/api/deals') return json(await listDeals(env, auth, url.searchParams.get('pipelineId') ?? undefined));
  if (request.method === 'POST' && url.pathname === '/api/deals') return createDeal(request, env, auth);
  if (request.method === 'GET' && url.pathname === '/api/projects') return json(await listProjects(env, auth));
  if (request.method === 'POST' && url.pathname === '/api/projects') return createProject(request, env, auth);

  const pipelineMatch = url.pathname.match(/^\/api\/pipelines\/([^/]+)$/);
  if (pipelineMatch && request.method === 'PATCH') return renamePipeline(request, env, auth, pipelineMatch[1]);
  if (pipelineMatch && request.method === 'DELETE') return deletePipeline(env, auth, pipelineMatch[1]);

  const moveMatch = url.pathname.match(/^\/api\/deals\/([^/]+)\/move$/);
  if (request.method === 'PATCH' && moveMatch) return moveDeal(request, env, auth, moveMatch[1]);

  const dealMatch = url.pathname.match(/^\/api\/deals\/([^/]+)$/);
  if (dealMatch && request.method === 'GET') return getDeal(env, auth, dealMatch[1]);
  if (dealMatch && request.method === 'PATCH') return updateDeal(request, env, auth, dealMatch[1]);
  if (dealMatch && request.method === 'DELETE') return deleteDeal(env, auth, dealMatch[1]);

  if (request.method === 'GET' && url.pathname === '/api/tasks') return json([]);
  if (request.method === 'GET' && url.pathname === '/api/team') return json([]);
  if (request.method === 'GET' && url.pathname === '/api/accounting') return json({ summary: { income: 0, expense: 0, profit: 0, vat: 0 }, transactions: [] });
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
