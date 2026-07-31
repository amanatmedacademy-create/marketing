type JsonRecord = Record<string, unknown>;

export type CrmEnv = {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
};

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});

const headers = (env: CrmEnv, extra: HeadersInit = {}): HeadersInit => ({
  apikey: env.SUPABASE_SERVICE_ROLE_KEY,
  authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
  'content-type': 'application/json',
  ...extra,
});

async function rest(env: CrmEnv, path: string, init: RequestInit = {}) {
  return fetch(`${env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/${path}`, { ...init, headers: headers(env, init.headers) });
}

async function rows(response: Response): Promise<JsonRecord[]> {
  const text = await response.text();
  if (!response.ok) throw new Error(text || `Supabase error ${response.status}`);
  return text ? JSON.parse(text) as JsonRecord[] : [];
}

function userId(request: Request): string {
  const id = request.headers.get('x-amanat-auth-user') || '';
  if (!id) throw new Error('Authenticated user is missing');
  return id;
}

async function memberships(env: CrmEnv, id: string) {
  return rows(await rest(env, `crm_company_members?user_id=eq.${encodeURIComponent(id)}&status=eq.active&select=company_id,role`));
}

async function requireCompany(request: Request, env: CrmEnv): Promise<string> {
  const id = userId(request);
  const requested = request.headers.get('x-company-id');
  const memberRows = await memberships(env, id);
  const companyId = requested || String(memberRows[0]?.company_id || '');
  if (!companyId || !memberRows.some((row) => row.company_id === companyId)) throw new Error('NO_ACTIVE_COMPANY_MEMBERSHIP');
  return companyId;
}

function slugify(value: string) {
  const base = value.toLowerCase().trim().replace(/[^a-z0-9а-яё]+/gi, '-').replace(/^-|-$/g, '').slice(0, 50) || 'company';
  return `${base}-${crypto.randomUUID().slice(0, 6)}`;
}

export async function handleCrmRequest(request: Request, env: CrmEnv, url: URL): Promise<Response | null> {
  if (!url.pathname.startsWith('/api/crm/')) return null;
  const uid = userId(request);

  if (url.pathname === '/api/crm/bootstrap' && request.method === 'GET') {
    const memberRows = await memberships(env, uid);
    const ids = memberRows.map((row) => String(row.company_id)).filter(Boolean);
    const companies = ids.length ? await rows(await rest(env, `crm_companies?id=in.(${ids.join(',')})&select=id,name,slug,timezone,currency`)) : [];
    const data = companies.map((company) => ({ ...company, role: String(memberRows.find((row) => row.company_id === company.id)?.role || 'viewer') }));
    return json({ data: { requiresOnboarding: data.length === 0, companies: data } });
  }

  if (url.pathname === '/api/crm/companies' && request.method === 'POST') {
    const existing = await memberships(env, uid);
    if (existing.length) return json({ error: 'Компания уже создана' }, 409);
    const body = await request.json() as JsonRecord;
    const name = String(body.name || '').trim();
    if (name.length < 2) return json({ error: 'Название компании слишком короткое' }, 400);
    const company = (await rows(await rest(env, 'crm_companies', {
      method: 'POST', headers: { prefer: 'return=representation' },
      body: JSON.stringify({ name, slug: slugify(name), timezone: String(body.timezone || 'Asia/Almaty'), created_by: uid }),
    })))[0];
    await rows(await rest(env, 'crm_company_members', { method: 'POST', headers: { prefer: 'return=representation' }, body: JSON.stringify({ company_id: company.id, user_id: uid, role: 'owner', status: 'active' }) }));
    const pipeline = (await rows(await rest(env, 'crm_pipelines', { method: 'POST', headers: { prefer: 'return=representation' }, body: JSON.stringify({ company_id: company.id, name: 'Основная воронка', is_default: true, position: 0 }) })))[0];
    const defaults = [
      { name: 'Новый лид', color: '#3B82F6', position: 0, probability: 10, stage_type: 'open' },
      { name: 'Связались', color: '#8B5CF6', position: 1, probability: 30, stage_type: 'open' },
      { name: 'Записан', color: '#F59E0B', position: 2, probability: 60, stage_type: 'open' },
      { name: 'Продажа', color: '#10B981', position: 3, probability: 100, stage_type: 'won' },
      { name: 'Отказ', color: '#EF4444', position: 4, probability: 0, stage_type: 'lost' },
    ].map((stage) => ({ ...stage, company_id: company.id, pipeline_id: pipeline.id }));
    await rows(await rest(env, 'crm_pipeline_stages', { method: 'POST', headers: { prefer: 'return=representation' }, body: JSON.stringify(defaults) }));
    return json({ data: { company, pipeline } }, 201);
  }

  const companyId = await requireCompany(request, env);

  if (url.pathname === '/api/crm/pipelines' && request.method === 'GET') {
    const pipelines = await rows(await rest(env, `crm_pipelines?company_id=eq.${companyId}&select=*&order=position.asc`));
    const stages = await rows(await rest(env, `crm_pipeline_stages?company_id=eq.${companyId}&select=*&order=position.asc`));
    return json({ data: pipelines.map((pipeline) => ({ ...pipeline, stages: stages.filter((stage) => stage.pipeline_id === pipeline.id) })) });
  }

  if (url.pathname === '/api/crm/contacts' && request.method === 'GET') {
    const search = url.searchParams.get('search')?.trim();
    const filter = search ? `&or=(first_name.ilike.*${encodeURIComponent(search)}*,last_name.ilike.*${encodeURIComponent(search)}*,phone.ilike.*${encodeURIComponent(search)}*,email.ilike.*${encodeURIComponent(search)}*)` : '';
    return json({ data: await rows(await rest(env, `crm_contacts?company_id=eq.${companyId}&deleted_at=is.null&select=*&order=created_at.desc&limit=100${filter}`)) });
  }

  if (url.pathname === '/api/crm/contacts' && request.method === 'POST') {
    const body = await request.json() as JsonRecord;
    const contact = (await rows(await rest(env, 'crm_contacts', { method: 'POST', headers: { prefer: 'return=representation' }, body: JSON.stringify({ company_id: companyId, first_name: String(body.firstName || '').trim(), last_name: body.lastName || null, phone: body.phone || null, email: body.email || null, source: body.source || null, created_by: uid }) })))[0];
    return json({ data: contact }, 201);
  }

  if (url.pathname === '/api/crm/deals' && request.method === 'GET') {
    const pipelineId = url.searchParams.get('pipelineId');
    const extra = pipelineId ? `&pipeline_id=eq.${encodeURIComponent(pipelineId)}` : '';
    return json({ data: await rows(await rest(env, `crm_deals?company_id=eq.${companyId}&deleted_at=is.null${extra}&select=*&order=stage_id.asc,position.asc&limit=500`)) });
  }

  if (url.pathname === '/api/crm/deals' && request.method === 'POST') {
    const body = await request.json() as JsonRecord;
    const stageId = String(body.stageId || '');
    const stage = (await rows(await rest(env, `crm_pipeline_stages?id=eq.${stageId}&company_id=eq.${companyId}&select=*`)))[0];
    if (!stage) return json({ error: 'Стадия не найдена' }, 400);
    const last = await rows(await rest(env, `crm_deals?company_id=eq.${companyId}&stage_id=eq.${stageId}&deleted_at=is.null&select=position&order=position.desc&limit=1`));
    const position = Number(last[0]?.position || 0) + 1024;
    const deal = (await rows(await rest(env, 'crm_deals', { method: 'POST', headers: { prefer: 'return=representation' }, body: JSON.stringify({ company_id: companyId, pipeline_id: stage.pipeline_id, stage_id: stageId, contact_id: body.contactId || null, assignee_id: body.assigneeId || null, title: String(body.title || '').trim(), phone: body.phone || null, email: body.email || null, source: body.source || null, amount: Number(body.amount || 0), status: stage.stage_type === 'won' ? 'won' : stage.stage_type === 'lost' ? 'lost' : 'open', position, created_by: uid }) })))[0];
    return json({ data: deal }, 201);
  }

  const move = url.pathname.match(/^\/api\/crm\/deals\/([^/]+)\/move$/);
  if (move && request.method === 'POST') {
    const dealId = move[1];
    const body = await request.json() as JsonRecord;
    const targetStageId = String(body.targetStageId || '');
    const stage = (await rows(await rest(env, `crm_pipeline_stages?id=eq.${targetStageId}&company_id=eq.${companyId}&select=*`)))[0];
    if (!stage) return json({ error: 'Стадия не найдена' }, 404);
    const last = await rows(await rest(env, `crm_deals?company_id=eq.${companyId}&stage_id=eq.${targetStageId}&deleted_at=is.null&id=neq.${dealId}&select=position&order=position.desc&limit=1`));
    const updated = await rows(await rest(env, `crm_deals?id=eq.${dealId}&company_id=eq.${companyId}`, { method: 'PATCH', headers: { prefer: 'return=representation' }, body: JSON.stringify({ pipeline_id: stage.pipeline_id, stage_id: targetStageId, status: stage.stage_type === 'won' ? 'won' : stage.stage_type === 'lost' ? 'lost' : 'open', position: Number(last[0]?.position || 0) + 1024, updated_at: new Date().toISOString(), won_at: stage.stage_type === 'won' ? new Date().toISOString() : null, lost_at: stage.stage_type === 'lost' ? new Date().toISOString() : null }) }));
    return json({ data: updated[0] });
  }

  return json({ error: 'CRM route not found' }, 404);
}
