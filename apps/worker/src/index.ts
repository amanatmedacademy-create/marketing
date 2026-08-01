interface Env {
  ASSETS: Fetcher;
  APP_ENV: string;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  DEFAULT_COMPANY_ID?: string;
}

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

function assertSupabase(env: Env): asserts env is Env & {
  SUPABASE_SERVICE_ROLE_KEY: string;
  DEFAULT_COMPANY_ID: string;
} {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY || !env.DEFAULT_COMPANY_ID) {
    throw new Error('Supabase environment is not configured');
  }
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

type PipelineRow = { id: string; name: string; is_default: boolean; position: number };
type StageRow = { id: string; pipeline_id: string; name: string; position: number; color: string | null; stage_type: string };
type DealRow = {
  id: string; pipeline_id: string; stage_id: string; title: string; phone: string | null;
  email: string | null; source: string | null; amount: number | string; position: number | string;
  created_at: string; assignee_id: string | null;
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

async function getPipelines(env: Env) {
  assertSupabase(env);
  const company = env.DEFAULT_COMPANY_ID;
  const [pipelines, stages] = await Promise.all([
    supabaseRest<PipelineRow[]>(env, 'crm_pipelines', `select=id,name,is_default,position&company_id=eq.${company}&order=position.asc,created_at.asc`),
    supabaseRest<StageRow[]>(env, 'crm_pipeline_stages', `select=id,pipeline_id,name,position,color,stage_type&company_id=eq.${company}&order=position.asc`),
  ]);
  return pipelines.map((pipeline) => mapPipeline(pipeline, stages));
}

async function bootstrapPipeline(env: Env) {
  assertSupabase(env);
  const existing = await getPipelines(env);
  if (existing.length) return existing.find((pipeline) => pipeline.isDefault) ?? existing[0];

  const pipelineRows = await supabaseRest<PipelineRow[]>(env, 'crm_pipelines', 'select=*', {
    method: 'POST',
    body: JSON.stringify({ company_id: env.DEFAULT_COMPANY_ID, name: 'Основная воронка', is_default: true, position: 0 }),
  });
  const pipeline = pipelineRows[0];
  const stageInput = [
    { name: 'Новый лид', color: '#3B82F6', position: 0, probability: 10, stage_type: 'open' },
    { name: 'В работе', color: '#F59E0B', position: 1, probability: 30, stage_type: 'open' },
    { name: 'Назначена консультация', color: '#8B5CF6', position: 2, probability: 60, stage_type: 'open' },
    { name: 'Продажа', color: '#22C55E', position: 3, probability: 100, stage_type: 'won' },
    { name: 'Отказ', color: '#EF4444', position: 4, probability: 0, stage_type: 'lost' },
  ].map((stage) => ({ ...stage, company_id: env.DEFAULT_COMPANY_ID, pipeline_id: pipeline.id }));
  const stages = await supabaseRest<StageRow[]>(env, 'crm_pipeline_stages', 'select=*', {
    method: 'POST',
    body: JSON.stringify(stageInput),
  });
  return mapPipeline(pipeline, stages);
}

async function listDeals(env: Env, pipelineId?: string) {
  assertSupabase(env);
  const pipelineFilter = pipelineId ? `&pipeline_id=eq.${pipelineId}` : '';
  const rows = await supabaseRest<DealRow[]>(env, 'crm_deals', `select=id,pipeline_id,stage_id,title,phone,email,source,amount,position,created_at,assignee_id&company_id=eq.${env.DEFAULT_COMPANY_ID}&deleted_at=is.null${pipelineFilter}&order=position.asc,created_at.desc`);
  const items = rows.map(mapDeal);
  return { items, total: items.length, page: 1, pageSize: 100 };
}

async function createDeal(request: Request, env: Env) {
  assertSupabase(env);
  const body = await request.json() as { title?: string; stageId?: string; pipelineId?: string; phone?: string; email?: string; source?: string; amount?: number };
  if (!body.title?.trim() || !body.stageId || !body.pipelineId) {
    return json({ error: { code: 'VALIDATION_ERROR', message: 'title, stageId and pipelineId are required' } }, { status: 400 });
  }
  const stage = await supabaseRest<Array<{ id: string; stage_type: string }>>(env, 'crm_pipeline_stages', `select=id,stage_type&id=eq.${body.stageId}&pipeline_id=eq.${body.pipelineId}&company_id=eq.${env.DEFAULT_COMPANY_ID}&limit=1`);
  if (!stage.length) return json({ error: { code: 'INVALID_STAGE', message: 'Stage does not belong to this pipeline' } }, { status: 400 });
  const rows = await supabaseRest<DealRow[]>(env, 'crm_deals', 'select=*', {
    method: 'POST',
    body: JSON.stringify({
      company_id: env.DEFAULT_COMPANY_ID,
      pipeline_id: body.pipelineId,
      stage_id: body.stageId,
      title: body.title.trim(),
      phone: body.phone?.trim() || null,
      email: body.email?.trim() || null,
      source: body.source?.trim() || null,
      amount: Number(body.amount ?? 0),
      currency: 'KZT',
      status: stage[0].stage_type === 'won' ? 'won' : stage[0].stage_type === 'lost' ? 'lost' : 'open',
      position: Date.now(),
    }),
  });
  return json(mapDeal(rows[0]), { status: 201 });
}

async function moveDeal(request: Request, env: Env, dealId: string) {
  assertSupabase(env);
  const body = await request.json() as { stageId?: string; order?: number };
  if (!body.stageId) return json({ error: { code: 'VALIDATION_ERROR', message: 'stageId is required' } }, { status: 400 });
  const stages = await supabaseRest<Array<{ id: string; pipeline_id: string; stage_type: string }>>(env, 'crm_pipeline_stages', `select=id,pipeline_id,stage_type&id=eq.${body.stageId}&company_id=eq.${env.DEFAULT_COMPANY_ID}&limit=1`);
  if (!stages.length) return json({ error: { code: 'INVALID_STAGE', message: 'Stage not found' } }, { status: 400 });
  const stage = stages[0];
  const now = new Date().toISOString();
  const rows = await supabaseRest<DealRow[]>(env, 'crm_deals', `id=eq.${dealId}&company_id=eq.${env.DEFAULT_COMPANY_ID}&deleted_at=is.null&select=*`, {
    method: 'PATCH',
    body: JSON.stringify({
      stage_id: body.stageId,
      pipeline_id: stage.pipeline_id,
      position: Number(body.order ?? 0),
      status: stage.stage_type === 'won' ? 'won' : stage.stage_type === 'lost' ? 'lost' : 'open',
      won_at: stage.stage_type === 'won' ? now : null,
      lost_at: stage.stage_type === 'lost' ? now : null,
      updated_at: now,
    }),
  });
  if (!rows.length) return json({ error: { code: 'NOT_FOUND', message: 'Deal not found' } }, { status: 404 });
  return json(mapDeal(rows[0]));
}

async function listProjects(env: Env) {
  assertSupabase(env);
  const [projects, items] = await Promise.all([
    supabaseRest<ProjectRow[]>(env, 'crm_projects', `select=id,name,description,priority,budget,client_deal_id,client_name,starts_at,due_at,technical_spec,status,created_at&company_id=eq.${env.DEFAULT_COMPANY_ID}&status=neq.archived&order=created_at.desc`),
    supabaseRest<ProjectItemRow[]>(env, 'crm_project_items', `select=id,project_id,title,description,status,priority,due_at,position&company_id=eq.${env.DEFAULT_COMPANY_ID}&order=position.asc,created_at.asc`),
  ]);
  return projects.map((project) => mapProject(project, items));
}

async function createProject(request: Request, env: Env) {
  assertSupabase(env);
  const body = await request.json() as {
    name?: string; description?: string; priority?: string; budget?: number; clientDealId?: string;
    clientName?: string; startsAt?: string; dueAt?: string; technicalSpec?: string;
  };
  if (!body.name?.trim()) {
    return json({ error: { code: 'VALIDATION_ERROR', message: 'Project name is required' } }, { status: 400 });
  }
  const priority = ['low', 'medium', 'high', 'urgent'].includes(body.priority ?? '') ? body.priority : 'medium';
  const rows = await supabaseRest<ProjectRow[]>(env, 'crm_projects', 'select=*', {
    method: 'POST',
    body: JSON.stringify({
      company_id: env.DEFAULT_COMPANY_ID,
      name: body.name.trim(),
      description: body.description?.trim() || null,
      priority,
      budget: Number(body.budget ?? 0),
      client_deal_id: body.clientDealId || null,
      client_name: body.clientName?.trim() || null,
      starts_at: body.startsAt || null,
      due_at: body.dueAt || null,
      technical_spec: body.technicalSpec?.trim() || null,
      status: 'active',
    }),
  });
  return json(mapProject(rows[0], []), { status: 201 });
}

async function getDashboard(env: Env) {
  const [pipelines, deals] = await Promise.all([getPipelines(env), listDeals(env)]);
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
  if (request.method === 'GET' && url.pathname === '/api/dashboard') return json(await getDashboard(env));
  if (request.method === 'GET' && url.pathname === '/api/pipelines') return json(await getPipelines(env));
  if (request.method === 'POST' && url.pathname === '/api/pipelines/bootstrap') return json(await bootstrapPipeline(env), { status: 201 });
  if (request.method === 'GET' && url.pathname === '/api/deals') return json(await listDeals(env, url.searchParams.get('pipelineId') ?? undefined));
  if (request.method === 'POST' && url.pathname === '/api/deals') return createDeal(request, env);
  if (request.method === 'GET' && url.pathname === '/api/projects') return json(await listProjects(env));
  if (request.method === 'POST' && url.pathname === '/api/projects') return createProject(request, env);

  const moveMatch = url.pathname.match(/^\/api\/deals\/([^/]+)\/move$/);
  if (request.method === 'PATCH' && moveMatch) return moveDeal(request, env, moveMatch[1]);

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
