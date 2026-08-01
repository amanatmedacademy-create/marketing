import type { AuthEnv } from './auth';

type Env = AuthEnv & { DEFAULT_COMPANY_ID?: string };

type DealRow = {
  id: string;
  pipeline_id: string;
  stage_id: string;
  title: string;
  phone: string | null;
  email: string | null;
  source: string | null;
  amount: number | string;
  position: number | string;
  created_at: string;
  updated_at: string;
  assignee_id: string | null;
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});

function assertEnv(env: Env): asserts env is Env & { SUPABASE_SERVICE_ROLE_KEY: string; DEFAULT_COMPANY_ID: string } {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY || !env.DEFAULT_COMPANY_ID) {
    throw new Error('Supabase environment is not configured');
  }
}

async function rest<T>(env: Env, table: string, query: string, init: RequestInit = {}): Promise<T> {
  assertEnv(env);
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
  return response.json() as Promise<T>;
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
    phone: row.phone,
    email: row.email,
    source: row.source,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    contact: row.phone || row.email ? {
      id: row.id,
      firstName: row.title,
      lastName: null,
      phone: row.phone,
      email: row.email,
    } : null,
    manager: null,
    tags: [],
  };
}

export async function handleDealDetails(request: Request, env: Env) {
  const url = new URL(request.url);
  const match = url.pathname.match(/^\/api\/deals\/([^/]+)$/);
  if (!match) return null;
  const dealId = match[1];
  assertEnv(env);

  if (request.method === 'GET') {
    const rows = await rest<DealRow[]>(env, 'crm_deals', `select=id,pipeline_id,stage_id,title,phone,email,source,amount,position,created_at,updated_at,assignee_id&id=eq.${dealId}&company_id=eq.${env.DEFAULT_COMPANY_ID}&deleted_at=is.null&limit=1`);
    if (!rows.length) return json({ error: { code: 'NOT_FOUND', message: 'Сделка не найдена' } }, 404);
    return json(mapDeal(rows[0]));
  }

  if (request.method === 'PATCH') {
    const body = await request.json() as {
      title?: string;
      phone?: string | null;
      email?: string | null;
      source?: string | null;
      amount?: number;
      stageId?: string;
    };
    const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (typeof body.title === 'string' && body.title.trim()) update.title = body.title.trim();
    if ('phone' in body) update.phone = body.phone?.trim() || null;
    if ('email' in body) update.email = body.email?.trim() || null;
    if ('source' in body) update.source = body.source?.trim() || null;
    if (typeof body.amount === 'number' && Number.isFinite(body.amount) && body.amount >= 0) update.amount = body.amount;

    if (body.stageId) {
      const stages = await rest<Array<{ id: string; pipeline_id: string; stage_type: string }>>(env, 'crm_pipeline_stages', `select=id,pipeline_id,stage_type&id=eq.${body.stageId}&company_id=eq.${env.DEFAULT_COMPANY_ID}&limit=1`);
      if (!stages.length) return json({ error: { code: 'INVALID_STAGE', message: 'Этап не найден' } }, 400);
      update.stage_id = stages[0].id;
      update.pipeline_id = stages[0].pipeline_id;
      update.status = stages[0].stage_type === 'won' ? 'won' : stages[0].stage_type === 'lost' ? 'lost' : 'open';
      update.won_at = stages[0].stage_type === 'won' ? new Date().toISOString() : null;
      update.lost_at = stages[0].stage_type === 'lost' ? new Date().toISOString() : null;
    }

    const rows = await rest<DealRow[]>(env, 'crm_deals', `id=eq.${dealId}&company_id=eq.${env.DEFAULT_COMPANY_ID}&deleted_at=is.null&select=id,pipeline_id,stage_id,title,phone,email,source,amount,position,created_at,updated_at,assignee_id`, {
      method: 'PATCH',
      body: JSON.stringify(update),
    });
    if (!rows.length) return json({ error: { code: 'NOT_FOUND', message: 'Сделка не найдена' } }, 404);
    return json(mapDeal(rows[0]));
  }

  return null;
}
