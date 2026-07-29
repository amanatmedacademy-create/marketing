import type { Env } from './integrations';

type JsonRecord = Record<string, unknown>;

type Resource = {
  table: string;
  order: string;
};

const resources: Record<string, Resource> = {
  campaigns: { table: 'marketing_campaigns', order: 'starts_on.desc.nullslast,created_at.desc' },
  tasks: { table: 'marketing_tasks', order: 'done.asc,due_on.asc.nullslast,created_at.desc' },
  content: { table: 'marketing_content_plan', order: 'publish_on.asc.nullslast,created_at.desc' },
  automations: { table: 'marketing_automations', order: 'created_at.desc' },
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

async function logActivity(env: Env, eventType: string, message: string, entityType?: string, entityId?: string) {
  await supabaseRequest(env, 'marketing_activity_log', {
    method: 'POST',
    headers: { prefer: 'return=minimal' },
    body: JSON.stringify({ event_type: eventType, message, entity_type: entityType || null, entity_id: entityId || null }),
  });
}

export async function handleOperationsRequest(request: Request, env: Env, url: URL): Promise<Response | null> {
  if (!url.pathname.startsWith('/api/operations/')) return null;

  const parts = url.pathname.split('/').filter(Boolean);
  const resourceName = parts[2];
  const id = parts[3];
  const resource = resources[resourceName];
  if (!resource) return json({ error: 'Operations resource not found' }, 404);

  if (request.method === 'GET') {
    const limit = Math.min(Math.max(Number(url.searchParams.get('limit') || 200), 1), 500);
    return proxy(await requestSupabaseList(env, resource, limit));
  }

  if (request.method === 'POST' && !id) {
    const payload = (await request.json()) as JsonRecord;
    const response = await supabaseRequest(env, resource.table, {
      method: 'POST',
      headers: { prefer: 'return=representation' },
      body: JSON.stringify(payload),
    });
    if (response.ok) await logActivity(env, `${resourceName}.created`, `Создан объект: ${String(payload.name || payload.title || resourceName)}`, resourceName);
    return proxy(response);
  }

  if (request.method === 'PATCH' && id) {
    const payload = (await request.json()) as JsonRecord;
    const response = await supabaseRequest(env, `${resource.table}?id=eq.${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { prefer: 'return=representation' },
      body: JSON.stringify({ ...payload, updated_at: new Date().toISOString() }),
    });
    if (response.ok) await logActivity(env, `${resourceName}.updated`, `Обновлён объект ${id}`, resourceName, id);
    return proxy(response);
  }

  if (request.method === 'DELETE' && id) {
    const response = await supabaseRequest(env, `${resource.table}?id=eq.${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: { prefer: 'return=representation' },
    });
    if (response.ok) await logActivity(env, `${resourceName}.deleted`, `Удалён объект ${id}`, resourceName, id);
    return proxy(response);
  }

  return json({ error: 'Method not allowed' }, 405);
}

function requestSupabaseList(env: Env, resource: Resource, limit: number) {
  const params = new URLSearchParams({ select: '*', order: resource.order, limit: String(limit) });
  return supabaseRequest(env, `${resource.table}?${params.toString()}`);
}
