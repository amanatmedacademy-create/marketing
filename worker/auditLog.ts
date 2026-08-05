import type { Env } from './integrations';

// FR-060: аудит действий и реестр ошибок.
// audit_logs — кто/что/когда с before/after; error_logs — дедуплицированные
// ошибки с числом повторов и повторной обработкой.
// Секреты и персональные данные маскируются до записи.

type Row = Record<string, unknown>;
type JsonValue = unknown;

export type AuditEntry = {
  userId?: string | null;
  action: string;
  entityType?: string | null;
  entityId?: string | null;
  before?: JsonValue;
  after?: JsonValue;
  ip?: string | null;
  userAgent?: string | null;
  correlationId?: string | null;
};

export type AuditPlan = {
  action: string;
  entityType: string;
  entityId: string | null;
  captureBody: boolean;
};

const ROLE_HEADER = 'x-amanat-auth-role';
const USER_HEADER = 'x-amanat-auth-user';
const CORRELATION_HEADER = 'x-correlation-id';

const SECRET_KEY_PATTERN = /token|secret|password|api[_-]?key|authorization|credential|signature|cookie|refresh|access[_-]?key/i;
const PERSONAL_KEY_PATTERN = /phone|email|iin|passport|birth/i;
const BEARER_PATTERN = /bearer\s+[a-z0-9._-]+/gi;
const JWT_PATTERN = /eyJ[a-zA-Z0-9_-]{8,}\.[a-zA-Z0-9_-]{8,}\.[a-zA-Z0-9_-]{4,}/g;
const EMAIL_PATTERN = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
const LONG_DIGITS_PATTERN = /\+?\d[\d\s()-]{8,}\d/g;

const isUuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

// ---------------------------------------------------------------------------
// Маскирование
// ---------------------------------------------------------------------------

function maskPersonalString(value: string): string {
  if (value.length <= 4) return '***';
  return `***${value.slice(-4)}`;
}

export function maskText(value: string): string {
  return value
    .replace(BEARER_PATTERN, 'Bearer ***')
    .replace(JWT_PATTERN, '***jwt***')
    .replace(EMAIL_PATTERN, (match) => maskPersonalString(match))
    .replace(LONG_DIGITS_PATTERN, (match) => maskPersonalString(match.replace(/\D/g, '')));
}

export function maskSensitive(value: JsonValue, depth = 0): JsonValue {
  if (depth > 6) return '***';
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => maskSensitive(item, depth + 1));
  if (value && typeof value === 'object') {
    const result: Record<string, JsonValue> = {};
    for (const [key, item] of Object.entries(value as Record<string, JsonValue>)) {
      if (SECRET_KEY_PATTERN.test(key)) result[key] = '***';
      else if (PERSONAL_KEY_PATTERN.test(key)) result[key] = typeof item === 'string' && item ? maskPersonalString(item) : item == null ? item : '***';
      else result[key] = maskSensitive(item, depth + 1);
    }
    return result;
  }
  if (typeof value === 'string') return maskText(value);
  return value;
}

// ---------------------------------------------------------------------------
// Контекст запроса
// ---------------------------------------------------------------------------

export function correlationId(request: Request): string {
  const provided = (request.headers.get(CORRELATION_HEADER) || '').trim().slice(0, 80).replace(/[^a-zA-Z0-9_-]/g, '');
  return provided || crypto.randomUUID();
}

export function requestClient(request: Request): { ip: string | null; userAgent: string | null } {
  const ip = request.headers.get('cf-connecting-ip')
    || (request.headers.get('x-forwarded-for') || '').split(',')[0].trim()
    || null;
  const userAgent = (request.headers.get('user-agent') || '').slice(0, 300) || null;
  return { ip, userAgent };
}

export function requestUserId(request: Request): string | null {
  const value = (request.headers.get(USER_HEADER) || '').trim();
  return isUuid(value) ? value : null;
}

function requestRole(request: Request): string {
  return (request.headers.get(ROLE_HEADER) || '').trim().toLowerCase();
}

// ---------------------------------------------------------------------------
// Запись в Supabase
// ---------------------------------------------------------------------------

function authHeaders(env: Env, extra: Record<string, string> = {}): Headers {
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  const headers = new Headers(extra);
  headers.set('apikey', key);
  if (!key.startsWith('sb_secret_')) headers.set('Authorization', `Bearer ${key}`);
  return headers;
}

async function db<T>(env: Env, path: string, init: RequestInit = {}): Promise<T> {
  const headers = authHeaders(env, { Accept: 'application/json' });
  new Headers(init.headers).forEach((value, name) => headers.set(name, value));
  if (init.body != null) headers.set('Content-Type', 'application/json');
  const response = await fetch(`${env.SUPABASE_URL.replace(/\/+$/, '')}/rest/v1${path}`, { ...init, headers, cache: 'no-store' });
  if (!response.ok) throw new Error(`audit db ${response.status}: ${(await response.text()).slice(0, 300)}`);
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export async function recordAudit(env: Env, entry: AuditEntry): Promise<void> {
  try {
    await db(env, '/audit_logs', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        organization_id: null,
        user_id: entry.userId || null,
        action: entry.action.slice(0, 120),
        entity_type: entry.entityType || null,
        entity_id: entry.entityId ? String(entry.entityId).slice(0, 160) : null,
        before: entry.before == null ? null : maskSensitive(entry.before),
        after: entry.after == null ? null : maskSensitive(entry.after),
        ip: entry.ip || null,
        user_agent: entry.userAgent || null,
        correlation_id: entry.correlationId || null,
        created_at: new Date().toISOString()
      })
    });
  } catch (error) {
    console.error(JSON.stringify({ level: 'error', area: 'audit-log', message: error instanceof Error ? error.message : 'audit insert failed' }));
  }
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function recordErrorEvent(env: Env, input: {
  source: string;
  endpoint: string;
  code: string;
  message: string;
  correlationId?: string | null;
  metadata?: Row;
}): Promise<void> {
  try {
    const message = maskText(input.message).slice(0, 1000);
    // Отпечаток по нормализованному сообщению, чтобы повторы группировались.
    const normalized = message.replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, '<id>').replace(/\d{3,}/g, '<n>');
    const fingerprint = await sha256Hex([input.source, input.endpoint, input.code, normalized].join('|'));
    const now = new Date().toISOString();
    const existing = await db<Row[]>(env, `/error_logs?select=id,repeat_count,status&fingerprint=eq.${fingerprint}&limit=1`);
    if (existing[0]) {
      const repeat = Number(existing[0].repeat_count || 0) + 1;
      const status = existing[0].status === 'RESOLVED' ? 'OPEN' : existing[0].status;
      await db(env, `/error_logs?fingerprint=eq.${fingerprint}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ repeat_count: repeat, last_seen_at: now, updated_at: now, status, correlation_id: input.correlationId || null, message })
      });
    } else {
      await db(env, '/error_logs', {
        method: 'POST',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({
          source: input.source.slice(0, 80),
          endpoint: input.endpoint.slice(0, 300),
          code: input.code.slice(0, 40),
          message,
          correlation_id: input.correlationId || null,
          fingerprint,
          metadata: input.metadata ? maskSensitive(input.metadata) : {},
          first_seen_at: now,
          last_seen_at: now,
          created_at: now,
          updated_at: now
        })
      });
    }
  } catch (error) {
    console.error(JSON.stringify({ level: 'error', area: 'error-log', message: error instanceof Error ? error.message : 'error insert failed' }));
  }
}

// ---------------------------------------------------------------------------
// Правила аудита: какие запросы логировать
// ---------------------------------------------------------------------------

export function planAudit(method: string, path: string, body: Row | null): AuditPlan | null {
  const segment = (index: number) => path.split('/').filter(Boolean)[index] || null;

  if (method === 'POST' && path === '/api/auth/refresh') return { action: 'auth.login', entityType: 'session', entityId: null, captureBody: false };
  if (method === 'POST' && path === '/api/auth/logout') return { action: 'auth.logout', entityType: 'session', entityId: null, captureBody: false };

  if (/^\/api\/(auth\/)?users\/[^/]+$/.test(path) && ['PATCH', 'PUT'].includes(method) && body && 'role' in body) {
    return { action: 'user.role_changed', entityType: 'user', entityId: segment(2), captureBody: true };
  }

  if (method === 'POST' && path === '/api/integrations/sync') return { action: 'integration.sync_manual', entityType: 'integration', entityId: null, captureBody: true };
  if (path.startsWith('/api/integrations/') && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    return { action: method === 'DELETE' ? 'integration.deleted' : 'integration.changed', entityType: 'integration', entityId: segment(2), captureBody: true };
  }

  const funnelLead = path.match(/^\/api\/funnel\/leads\/([^/]+)$/);
  if (funnelLead && method === 'PATCH') {
    const stageChange = body && typeof body.stage === 'string';
    return { action: stageChange ? 'funnel.stage_changed' : 'funnel.lead_updated', entityType: 'funnel_lead', entityId: funnelLead[1], captureBody: true };
  }
  const funnelAction = path.match(/^\/api\/funnel\/leads\/([^/]+)\/actions$/);
  if (funnelAction && method === 'POST') return { action: 'funnel.lead_action', entityType: 'funnel_lead', entityId: funnelAction[1], captureBody: true };
  if (method === 'POST' && path === '/api/funnel/leads') return { action: 'funnel.lead_created', entityType: 'funnel_lead', entityId: null, captureBody: true };

  const chatThread = path.match(/^\/api\/callcenter\/threads\/([^/]+)$/);
  if (chatThread && method === 'PATCH') {
    const statusChange = body && typeof body.status === 'string';
    return { action: statusChange ? 'chat.stage_changed' : 'chat.thread_updated', entityType: 'chat_thread', entityId: chatThread[1], captureBody: true };
  }

  if (method === 'DELETE' && path.startsWith('/api/')) {
    return { action: 'entity.deleted', entityType: segment(1) || 'api', entityId: segment(2), captureBody: false };
  }

  if (method === 'GET' && (path.includes('/export') || path.endsWith('.csv'))) {
    return { action: 'data.exported', entityType: segment(1) || 'api', entityId: null, captureBody: false };
  }

  return null;
}

// ---------------------------------------------------------------------------
// API: /api/audit* и /api/errors*
// ---------------------------------------------------------------------------

const CLIENT_AUDIT_ACTIONS = new Set(['data.exported', 'mass.operation']);
const ERROR_STATUSES = new Set(['OPEN', 'RETRYING', 'RESOLVED']);

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
});

function mapErrorRow(row: Row) {
  return {
    id: String(row.id || ''),
    source: String(row.source || ''),
    endpoint: String(row.endpoint || ''),
    code: String(row.code || ''),
    message: String(row.message || ''),
    correlationId: row.correlation_id ? String(row.correlation_id) : undefined,
    repeatCount: Number(row.repeat_count || 0),
    retryAttempts: Number(row.retry_attempts || 0),
    firstSeenAt: String(row.first_seen_at || ''),
    lastSeenAt: String(row.last_seen_at || ''),
    status: String(row.status || 'OPEN'),
    metadata: row.metadata && typeof row.metadata === 'object' ? row.metadata : {}
  };
}

function mapAuditRow(row: Row) {
  return {
    id: String(row.id || ''),
    userId: row.user_id ? String(row.user_id) : undefined,
    action: String(row.action || ''),
    entityType: row.entity_type ? String(row.entity_type) : undefined,
    entityId: row.entity_id ? String(row.entity_id) : undefined,
    before: row.before ?? null,
    after: row.after ?? null,
    ip: row.ip ? String(row.ip) : undefined,
    userAgent: row.user_agent ? String(row.user_agent) : undefined,
    correlationId: row.correlation_id ? String(row.correlation_id) : undefined,
    createdAt: String(row.created_at || '')
  };
}

export async function handleAuditApi(request: Request, env: Env, url: URL): Promise<Response | null> {
  const path = url.pathname.replace(/\/+$/, '') || '/';
  if (!path.startsWith('/api/audit') && !path.startsWith('/api/errors')) return null;
  const role = requestRole(request);
  const isAdmin = role === 'administrator';
  const canOperate = isAdmin || role === 'marketer';

  try {
    if (request.method === 'GET' && path === '/api/audit') {
      if (!isAdmin) return json({ error: 'Журнал аудита доступен только администратору' }, 403);
      const limit = Math.min(500, Math.max(20, Number(url.searchParams.get('limit')) || 200));
      const params = new URLSearchParams();
      params.set('select', '*');
      params.set('order', 'created_at.desc');
      params.set('limit', String(limit));
      const action = (url.searchParams.get('action') || '').trim().slice(0, 120);
      if (action) params.set('action', `eq.${action}`);
      const rows = await db<Row[]>(env, `/audit_logs?${params.toString()}`);
      return json(rows.map(mapAuditRow));
    }

    if (request.method === 'POST' && path === '/api/audit/events') {
      if (!canOperate) return json({ error: 'Недостаточно прав' }, 403);
      const body = await request.json().catch(() => null) as Row | null;
      const action = typeof body?.action === 'string' ? body.action : '';
      if (!CLIENT_AUDIT_ACTIONS.has(action)) return json({ error: 'Недопустимое действие аудита' }, 400);
      const { ip, userAgent } = requestClient(request);
      await recordAudit(env, {
        userId: requestUserId(request),
        action,
        entityType: typeof body?.entityType === 'string' ? body.entityType.slice(0, 80) : null,
        entityId: typeof body?.entityId === 'string' ? body.entityId : null,
        after: body?.details ?? null,
        ip,
        userAgent,
        correlationId: correlationId(request)
      });
      return json({ ok: true }, 201);
    }

    if (request.method === 'GET' && path === '/api/errors') {
      if (!canOperate) return json({ error: 'Недостаточно прав' }, 403);
      const params = new URLSearchParams();
      params.set('select', '*');
      params.set('order', 'last_seen_at.desc');
      params.set('limit', '200');
      const status = (url.searchParams.get('status') || '').toUpperCase();
      if (ERROR_STATUSES.has(status)) params.set('status', `eq.${status}`);
      const rows = await db<Row[]>(env, `/error_logs?${params.toString()}`);
      return json(rows.map(mapErrorRow));
    }

    const statusMatch = path.match(/^\/api\/errors\/([^/]+)$/);
    if (statusMatch && request.method === 'PATCH') {
      if (!canOperate) return json({ error: 'Недостаточно прав' }, 403);
      const body = await request.json().catch(() => null) as Row | null;
      const status = typeof body?.status === 'string' ? body.status.toUpperCase() : '';
      if (!ERROR_STATUSES.has(status)) return json({ error: 'Недопустимый статус' }, 400);
      const rows = await db<Row[]>(env, `/error_logs?id=eq.${encodeURIComponent(statusMatch[1])}&select=*`, {
        method: 'PATCH',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify({ status, updated_at: new Date().toISOString() })
      });
      if (!rows[0]) return json({ error: 'Ошибка не найдена' }, 404);
      await recordAudit(env, {
        userId: requestUserId(request),
        action: 'error.status_changed',
        entityType: 'error_log',
        entityId: statusMatch[1],
        after: { status },
        ...requestClient(request),
        correlationId: correlationId(request)
      });
      return json(mapErrorRow(rows[0]));
    }

    const retryMatch = path.match(/^\/api\/errors\/([^/]+)\/retry$/);
    if (retryMatch && request.method === 'POST') {
      if (!canOperate) return json({ error: 'Недостаточно прав' }, 403);
      const rows = await db<Row[]>(env, `/error_logs?id=eq.${encodeURIComponent(retryMatch[1])}&select=*&limit=1`);
      const row = rows[0];
      if (!row) return json({ error: 'Ошибка не найдена' }, 404);
      const updated = await db<Row[]>(env, `/error_logs?id=eq.${encodeURIComponent(retryMatch[1])}&select=*`, {
        method: 'PATCH',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify({
          status: 'RETRYING',
          retry_attempts: Number(row.retry_attempts || 0) + 1,
          updated_at: new Date().toISOString()
        })
      });
      const metadata = row.metadata && typeof row.metadata === 'object' ? row.metadata as Row : {};
      await recordAudit(env, {
        userId: requestUserId(request),
        action: 'error.retry_requested',
        entityType: 'error_log',
        entityId: retryMatch[1],
        after: { endpoint: row.endpoint, code: row.code },
        ...requestClient(request),
        correlationId: correlationId(request)
      });
      // Повторную обработку выполняет клиент по retryPath со своими правами.
      return json({
        ...mapErrorRow(updated[0] || row),
        retryPath: typeof metadata.retryPath === 'string' ? metadata.retryPath : (String(row.source) === 'integration.sync' ? '/api/integrations/sync' : undefined),
        retryMethod: typeof metadata.retryMethod === 'string' ? metadata.retryMethod : 'POST'
      });
    }

    return json({ error: 'Маршрут аудита не найден' }, 404);
  } catch (error) {
    console.error(JSON.stringify({ level: 'error', area: 'audit-api', path, message: error instanceof Error ? error.message : 'Unknown error' }));
    return json({ error: 'Внутренняя ошибка журнала аудита' }, 500);
  }
}
