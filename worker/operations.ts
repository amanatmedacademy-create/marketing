import type { Env } from './integrations';
import { handleWorkspaceBuilderRequest } from './workspaceBuilder';

type JsonRecord = Record<string, unknown>;
type Resource = { table: string; order: string };
type AuditStatus = 'success' | 'error' | 'warning';

const resources: Record<string, Resource> = {
  campaigns: { table: 'marketing_campaigns', order: 'starts_on.desc.nullslast,created_at.desc' },
  tasks: { table: 'marketing_tasks', order: 'done.asc,due_on.asc.nullslast,created_at.desc' },
  content: { table: 'marketing_content_plan', order: 'publish_on.asc.nullslast,created_at.desc' },
  automations: { table: 'marketing_automations', order: 'created_at.desc' },
  forms: { table: 'marketing_lead_forms', order: 'created_at.desc' },
  links: { table: 'marketing_tracking_links', order: 'created_at.desc' },
  'media-plan': { table: 'marketing_media_plan', order: 'month.desc,created_at.desc' },
  activity: { table: 'marketing_activity_log', order: 'created_at.desc' },
};

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});

const headers = (env: Env, extra: HeadersInit = {}): HeadersInit => ({
  apikey: env.SUPABASE_SERVICE_ROLE_KEY,
  authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
  'content-type': 'application/json',
  ...extra,
});

async function supabaseRequest(env: Env, path: string, init: RequestInit = {}) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return json({ error: 'Supabase is not configured' }, 503);
  return fetch(`${env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/${path}`, { ...init, headers: headers(env, init.headers) });
}

async function proxy(response: Response) {
  const body = await response.text();
  return new Response(body || null, {
    status: response.status,
    headers: { 'content-type': response.headers.get('content-type') || 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

function actorFromRequest(request: Request) {
  const actorEmail = request.headers.get('cf-access-authenticated-user-email')
    || request.headers.get('x-authenticated-user-email')
    || request.headers.get('x-user-email')
    || null;
  return {
    actor_id: request.headers.get('x-user-id') || actorEmail,
    actor_email: actorEmail,
    actor_name: request.headers.get('x-user-name') || actorEmail,
    request_id: request.headers.get('cf-ray') || crypto.randomUUID(),
    ip_address: request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for'),
    user_agent: request.headers.get('user-agent'),
  };
}

async function parseRows(response: Response): Promise<JsonRecord[]> {
  const body = await response.clone().text();
  if (!body) return [];
  try {
    const parsed = JSON.parse(body);
    return Array.isArray(parsed) ? parsed as JsonRecord[] : [parsed as JsonRecord];
  } catch {
    return [];
  }
}

async function readEntity(env: Env, resource: Resource, id: string): Promise<JsonRecord | null> {
  const response = await supabaseRequest(env, `${resource.table}?id=eq.${encodeURIComponent(id)}&select=*&limit=1`);
  if (!response.ok) return null;
  return (await parseRows(response))[0] || null;
}

async function logActivity(
  request: Request,
  env: Env,
  input: {
    eventType: string;
    message: string;
    module: string;
    action: string;
    status?: AuditStatus;
    entityType?: string;
    entityId?: string;
    oldValues?: JsonRecord | null;
    newValues?: JsonRecord | null;
    metadata?: JsonRecord;
  },
) {
  const actor = actorFromRequest(request);
  const payload = {
    event_type: input.eventType,
    message: input.message,
    entity_type: input.entityType || null,
    entity_id: input.entityId || null,
    module: input.module,
    action: input.action,
    status: input.status || 'success',
    old_values: input.oldValues || null,
    new_values: input.newValues || null,
    metadata: input.metadata || {},
    ...actor,
  };
  const response = await supabaseRequest(env, 'marketing_activity_log', {
    method: 'POST',
    headers: { prefer: 'return=minimal' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) console.error('[audit] failed to write activity log', response.status, await response.text());
}

function addActivityFilters(params: URLSearchParams, url: URL) {
  const eventType = url.searchParams.get('event_type');
  const module = url.searchParams.get('module');
  const action = url.searchParams.get('action');
  const status = url.searchParams.get('status');
  const actor = url.searchParams.get('actor');
  const entityType = url.searchParams.get('entity_type');
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  const search = url.searchParams.get('search');
  if (eventType) params.set('event_type', `eq.${eventType}`);
  if (module) params.set('module', `eq.${module}`);
  if (action) params.set('action', `eq.${action}`);
  if (status) params.set('status', `eq.${status}`);
  if (actor) params.set('actor_email', `ilike.*${actor.replace(/[,*()]/g, '')}*`);
  if (entityType) params.set('entity_type', `eq.${entityType}`);
  if (from) params.set('created_at', `gte.${from}T00:00:00Z`);
  if (to) params.append('created_at', `lte.${to}T23:59:59Z`);
  if (search) {
    const safe = search.replace(/[,*()]/g, ' ').trim();
    if (safe) params.set('or', `(message.ilike.*${safe}*,event_type.ilike.*${safe}*,actor_email.ilike.*${safe}*)`);
  }
}

export async function handleOperationsRequest(request: Request, env: Env, url: URL): Promise<Response | null> {
  const workspaceResponse = await handleWorkspaceBuilderRequest(request, env, url);
  if (workspaceResponse) return workspaceResponse;
  if (!url.pathname.startsWith('/api/operations/')) return null;

  const parts = url.pathname.split('/').filter(Boolean);
  const resourceName = parts[2];
  const id = parts[3];
  const resource = resources[resourceName];
  if (!resource) return json({ error: 'Operations resource not found' }, 404);

  if (request.method === 'GET') {
    const limit = Math.min(Math.max(Number(url.searchParams.get('limit') || 200), 1), 1000);
    const params = new URLSearchParams({ select: '*', order: resource.order, limit: String(limit) });
    if (resourceName === 'activity') addActivityFilters(params, url);
    return proxy(await supabaseRequest(env, `${resource.table}?${params.toString()}`));
  }

  if (resourceName === 'activity') return json({ error: 'Audit log is read-only' }, 405);

  if (request.method === 'POST' && !id) {
    const payload = (await request.json()) as JsonRecord;
    const response = await supabaseRequest(env, resource.table, {
      method: 'POST',
      headers: { prefer: 'return=representation' },
      body: JSON.stringify(payload),
    });
    const rows = await parseRows(response);
    const created = rows[0] || null;
    await logActivity(request, env, {
      eventType: `${resourceName}.created`,
      message: response.ok ? `Создан объект: ${String(payload.name || payload.title || resourceName)}` : `Ошибка создания объекта ${resourceName}`,
      module: resourceName,
      action: 'create',
      status: response.ok ? 'success' : 'error',
      entityType: resourceName,
      entityId: created?.id ? String(created.id) : undefined,
      newValues: created || payload,
      metadata: { http_status: response.status },
    });
    return proxy(response);
  }

  if (request.method === 'PATCH' && id) {
    const oldValues = await readEntity(env, resource, id);
    const payload = (await request.json()) as JsonRecord;
    const response = await supabaseRequest(env, `${resource.table}?id=eq.${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { prefer: 'return=representation' },
      body: JSON.stringify({ ...payload, updated_at: new Date().toISOString() }),
    });
    const rows = await parseRows(response);
    await logActivity(request, env, {
      eventType: `${resourceName}.updated`,
      message: response.ok ? `Обновлён объект ${id}` : `Ошибка обновления объекта ${id}`,
      module: resourceName,
      action: 'update',
      status: response.ok ? 'success' : 'error',
      entityType: resourceName,
      entityId: id,
      oldValues,
      newValues: rows[0] || payload,
      metadata: { http_status: response.status, changed_fields: Object.keys(payload) },
    });
    return proxy(response);
  }

  if (request.method === 'DELETE' && id) {
    const oldValues = await readEntity(env, resource, id);
    const response = await supabaseRequest(env, `${resource.table}?id=eq.${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: { prefer: 'return=representation' },
    });
    await logActivity(request, env, {
      eventType: `${resourceName}.deleted`,
      message: response.ok ? `Удалён объект ${id}` : `Ошибка удаления объекта ${id}`,
      module: resourceName,
      action: 'delete',
      status: response.ok ? 'success' : 'error',
      entityType: resourceName,
      entityId: id,
      oldValues,
      metadata: { http_status: response.status },
    });
    return proxy(response);
  }

  return json({ error: 'Method not allowed' }, 405);
}
