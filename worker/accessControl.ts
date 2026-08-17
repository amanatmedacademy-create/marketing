import { resolveCompanyId } from './companyContext';

type Row = Record<string, unknown>;
export type AccessAction = 'view' | 'create' | 'edit' | 'delete' | 'export' | 'manage';
export type AccessGrant = Record<AccessAction, boolean>;
export type AccessMap = Record<string, AccessGrant>;

export interface AccessControlEnv {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  IMDS_LOCAL_DB_URL?: string;
  IMDS_LOCAL_SERVICE_ROLE_KEY?: string;
  DEFAULT_COMPANY_ID?: string;
  CURRENT_COMPANY_ID?: string;
}

const ACTIONS: AccessAction[] = ['view', 'create', 'edit', 'delete', 'export', 'manage'];
const emptyGrant = (): AccessGrant => ({ view: false, create: false, edit: false, delete: false, export: false, manage: false });
const text = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
const bool = (value: unknown): boolean => value === true;

function dataBase(env: AccessControlEnv): string {
  const base = text(env.IMDS_LOCAL_DB_URL) || text(env.SUPABASE_URL);
  if (!base) throw new Error('Access control database URL is missing');
  return base.replace(/\/$/, '').replace(/\/rest\/v1$/, '');
}

function dataKey(env: AccessControlEnv): string {
  const key = text(env.IMDS_LOCAL_SERVICE_ROLE_KEY) || text(env.SUPABASE_SERVICE_ROLE_KEY);
  if (!key) throw new Error('Access control service key is missing');
  return key;
}

function headers(env: AccessControlEnv): HeadersInit {
  const key = dataKey(env);
  return { apikey: key, authorization: `Bearer ${key}`, accept: 'application/json' };
}

async function db<T>(env: AccessControlEnv, path: string): Promise<T> {
  const response = await fetch(`${dataBase(env)}/rest/v1/${path}`, { headers: headers(env) });
  const body = await response.text();
  if (!response.ok) throw new Error(`Access control ${response.status}: ${body.slice(0, 700)}`);
  return (body ? JSON.parse(body) : null) as T;
}

export async function resolveUserAccess(env: AccessControlEnv, userId: string, role?: string): Promise<{ companyId: string; positionId: string | null; jobTitle: string | null; permissions: AccessMap }> {
  const companyId = await resolveCompanyId(env, userId);
  const modules = await db<Row[]>(env, 'platform_modules?status=eq.active&select=id');
  const permissions: AccessMap = Object.fromEntries(modules.map((module) => [text(module.id), emptyGrant()]));

  if (role === 'administrator') {
    for (const grant of Object.values(permissions)) for (const action of ACTIONS) grant[action] = true;
    return { companyId, positionId: null, jobTitle: 'Администратор системы', permissions };
  }

  const assignments = await db<Row[]>(env, `crm_access_user_assignments?company_id=eq.${encodeURIComponent(companyId)}&user_id=eq.${encodeURIComponent(userId)}&select=position_id,job_title&limit=1`);
  const assignment = assignments[0] || {};
  const positionId = text(assignment.position_id) || null;
  if (positionId) {
    const rows = await db<Row[]>(env, `crm_access_position_permissions?company_id=eq.${encodeURIComponent(companyId)}&position_id=eq.${encodeURIComponent(positionId)}&select=*`);
    for (const row of rows) {
      const moduleId = text(row.module_id);
      if (!permissions[moduleId]) permissions[moduleId] = emptyGrant();
      for (const action of ACTIONS) permissions[moduleId][action] = bool(row[`can_${action}`]);
    }
  }

  const overrides = await db<Row[]>(env, `crm_access_user_overrides?company_id=eq.${encodeURIComponent(companyId)}&user_id=eq.${encodeURIComponent(userId)}&select=*`);
  for (const row of overrides) {
    const moduleId = text(row.module_id);
    if (!permissions[moduleId]) permissions[moduleId] = emptyGrant();
    for (const action of ACTIONS) {
      const value = row[`can_${action}`];
      if (typeof value === 'boolean') permissions[moduleId][action] = value;
    }
  }

  return { companyId, positionId, jobTitle: text(assignment.job_title) || null, permissions };
}

const routeRules: Array<{ test: (path: string) => boolean; moduleId: string }> = [
  { test: (p) => p.startsWith('/api/admin/users') || p.startsWith('/api/admin/access'), moduleId: 'team' },
  { test: (p) => p.startsWith('/api/tasks'), moduleId: 'work.tasks' },
  { test: (p) => p.startsWith('/api/callcenter') || p.startsWith('/api/chat'), moduleId: 'communications.chat' },
  { test: (p) => p.startsWith('/api/calls') || p.startsWith('/api/phone-workspace') || p.startsWith('/api/clinic-schedule'), moduleId: 'communications.calls' },
  { test: (p) => p.startsWith('/api/funnel') || p.startsWith('/api/deal-workspace'), moduleId: 'crm.pipeline' },
  { test: (p) => p.startsWith('/api/leads') || p.startsWith('/api/operations/forms'), moduleId: 'crm.leads' },
  { test: (p) => p.startsWith('/api/operations/links'), moduleId: 'analytics.attribution' },
  { test: (p) => p.startsWith('/api/operations/media-plan'), moduleId: 'dashboard' },
  { test: (p) => p.startsWith('/api/operations') || p.startsWith('/api/automation'), moduleId: 'dashboard' },
  { test: (p) => p.startsWith('/api/integrations'), moduleId: 'integrations' },
  { test: (p) => p.startsWith('/api/ads') || p.startsWith('/api/meta') || p.startsWith('/api/tiktok'), moduleId: 'advertising' },
  { test: (p) => p.startsWith('/api/audit'), moduleId: 'audit' },
  { test: (p) => p.startsWith('/api/analytics') || p.startsWith('/api/conversion') || p.startsWith('/api/web-analytics') || p.startsWith('/api/assistant/marketing'), moduleId: 'analytics.reports' },
  { test: (p) => p.startsWith('/api/dashboard'), moduleId: 'dashboard' },
];

export function permissionForRequest(pathname: string, method: string): { moduleId: string; action: AccessAction } | null {
  const rule = routeRules.find((item) => item.test(pathname));
  if (!rule) return null;
  const normalized = method.toUpperCase();
  const action: AccessAction = normalized === 'GET' || normalized === 'HEAD' ? 'view'
    : normalized === 'POST' ? 'create'
    : normalized === 'PATCH' || normalized === 'PUT' ? 'edit'
    : normalized === 'DELETE' ? 'delete'
    : 'view';
  return { moduleId: rule.moduleId, action };
}

export function hasPermission(access: AccessMap, moduleId: string, action: AccessAction): boolean {
  const grant = access[moduleId];
  return Boolean(grant && (grant[action] || grant.manage));
}
