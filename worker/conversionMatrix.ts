import type { Env } from './integrations';
import { requireCompanyId, type TenantScopedEnv } from './tenantScope';

type Row = Record<string, unknown>;
type ScopedEnv = Env & TenantScopedEnv;
const text = (value: unknown, fallback = '') => typeof value === 'string' && value.trim() ? value.trim() : fallback;

async function query<T>(env: Env, path: string): Promise<T> {
  const response = await fetch(`${env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/${path}`, {
    headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` },
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`Conversion matrix query failed (${response.status})`);
  return (body ? JSON.parse(body) : []) as T;
}

function range(days: number, url: URL) {
  const to = url.searchParams.get('to') || new Date().toISOString().slice(0, 10);
  const end = new Date(`${to}T23:59:59.999Z`);
  const from = url.searchParams.get('from') || new Date(end.getTime() - (days - 1) * 86400000).toISOString().slice(0, 10);
  return { from, to };
}

type Bucket = { leads: number; appointments: number; rate: number };
type MatrixRow = { id: string; label: string; platform: string; level: 'total' | 'platform' | 'source'; hours: Bucket[]; weekdays: Bucket[]; delays: Bucket[] };

const buckets = (length: number): Bucket[] => Array.from({ length }, () => ({ leads: 0, appointments: 0, rate: 0 }));
const createRow = (id: string, label: string, platform: string, level: MatrixRow['level']): MatrixRow => ({ id, label, platform, level, hours: buckets(24), weekdays: buckets(7), delays: buckets(7) });

export async function handleConversionMatrix(_request: Request, env: Env, url: URL): Promise<Response | null> {
  if (url.pathname !== '/api/analytics/conversion-matrix') return null;
  const companyId = requireCompanyId(env as ScopedEnv);
  const days = Math.min(Math.max(Number(url.searchParams.get('days') || 7), 1), 365);
  const { from, to } = range(days, url);
  const leads = await query<Row[]>(env, `marketing_leads?select=source,platform,lead_created_at,appointment_at,utm_source,utm_medium,utm_campaign&company_id=eq.${encodeURIComponent(companyId)}&and=(lead_created_at.gte.${from}T00:00:00Z,lead_created_at.lte.${to}T23:59:59Z)&limit=50000`);

  const rows = new Map<string, MatrixRow>();
  rows.set('total', createRow('total', 'Все источники', 'all', 'total'));

  const ensure = (id: string, label: string, platform: string, level: MatrixRow['level']) => {
    if (!rows.has(id)) rows.set(id, createRow(id, label, platform, level));
    return rows.get(id)!;
  };

  for (const lead of leads) {
    const created = new Date(text(lead.lead_created_at));
    if (Number.isNaN(created.getTime())) continue;
    const platform = text(lead.platform, text(lead.source, 'Не определено'));
    const source = text(lead.source, text(lead.utm_source, platform));
    const platformRow = ensure(`platform:${platform}`, platform, platform, 'platform');
    const sourceRow = ensure(`source:${platform}:${source}`, source, platform, 'source');
    const targets = [rows.get('total')!, platformRow, sourceRow];
    const hour = created.getUTCHours();
    const weekday = (created.getUTCDay() + 6) % 7;

    for (const row of targets) {
      row.hours[hour].leads += 1;
      row.weekdays[weekday].leads += 1;
    }

    if (lead.appointment_at) {
      const appointment = new Date(text(lead.appointment_at));
      const delay = Math.max(1, Math.min(7, Math.floor((appointment.getTime() - created.getTime()) / 86400000) + 1)) - 1;
      for (const row of targets) {
        row.hours[hour].appointments += 1;
        row.weekdays[weekday].appointments += 1;
        row.delays[delay].appointments += 1;
        row.delays[delay].leads += 1;
      }
    }
  }

  for (const row of rows.values()) {
    for (const bucket of [...row.hours, ...row.weekdays]) bucket.rate = bucket.leads ? bucket.appointments * 100 / bucket.leads : 0;
    const totalLeads = row.hours.reduce((sum, bucket) => sum + bucket.leads, 0);
    for (const bucket of row.delays) bucket.rate = totalLeads ? bucket.appointments * 100 / totalLeads : 0;
  }

  return new Response(JSON.stringify({ period: { from, to, days }, rows: [...rows.values()] }), {
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}
