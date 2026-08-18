import { listUserCompanies, resolveCompanyId, type PlatformRole, type UserCompany } from './companyContext';
import { localDataJson, localDataRequest, type LocalDataEnv } from './localData';

type Row = Record<string, unknown>;
export interface OperatingOverviewEnv extends LocalDataEnv {
  CURRENT_COMPANY_ID?: string;
}

const text = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
const number = (value: unknown): number => Number.isFinite(Number(value)) ? Number(value) : 0;
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});

async function rows<T extends Row>(env: OperatingOverviewEnv, path: string): Promise<T[]> {
  return localDataJson<T[]>(env, path, {}, 'Operating overview');
}

async function countRows(env: OperatingOverviewEnv, table: string, filters: string): Promise<number> {
  const join = filters ? `${filters}&` : '';
  const response = await localDataRequest(env, `${table}?${join}select=id&limit=1`, {
    method: 'HEAD',
    headers: { prefer: 'count=exact' },
  });
  if (!response.ok) throw new Error(`Operating overview count ${table}: ${response.status}`);
  const range = response.headers.get('content-range') || '';
  const total = Number(range.split('/').pop());
  return Number.isFinite(total) ? total : 0;
}

function connectedStatus(value: unknown): boolean {
  return ['connected', 'active', 'configured', 'verified'].includes(text(value).toLowerCase());
}

function connectedProvider(providers: Map<string, Row>, provider: string): boolean {
  return connectedStatus(providers.get(provider)?.status);
}

async function clinicSnapshot(env: OperatingOverviewEnv, company: UserCompany, currentCompanyId: string) {
  const companyId = company.id;
  const [companyRows, memberCount, leadCount, openTaskCount, integrationRows, dailyRows] = await Promise.all([
    rows<Row>(env, `crm_companies?id=eq.${encodeURIComponent(companyId)}&select=id,name,slug&limit=1`).catch(() => []),
    countRows(env, 'crm_company_members', `company_id=eq.${encodeURIComponent(companyId)}&status=eq.active`).catch(() => 0),
    countRows(env, 'marketing_leads', `company_id=eq.${encodeURIComponent(companyId)}`).catch(() => 0),
    countRows(env, 'crm_tasks', `company_id=eq.${encodeURIComponent(companyId)}&source=eq.work_tasks&status=not.in.(done,cancelled)`).catch(() => 0),
    rows<Row>(env, `integration_credentials?company_id=eq.${encodeURIComponent(companyId)}&user_id=is.null&select=provider,status,last_error,last_verified_at,updated_at&limit=100`).catch(() => []),
    rows<Row>(env, `marketing_daily_metrics?company_id=eq.${encodeURIComponent(companyId)}&select=leads,sales,revenue&order=date.desc&limit=5000`).catch(() => []),
  ]);

  const providers = new Map(integrationRows.map((row) => [text(row.provider).toLowerCase(), row]));
  const connectedIntegrations = integrationRows.filter((row) => connectedStatus(row.status)).length;
  const totals = dailyRows.reduce((acc, row) => ({
    leads: acc.leads + number(row.leads),
    sales: acc.sales + number(row.sales),
    revenue: acc.revenue + number(row.revenue),
  }), { leads: 0, sales: 0, revenue: 0 });

  const clinicName = text(companyRows[0]?.name) || company.name || companyId;
  const onboardingItems = [
    { id: 'clinic', label: 'Клиника', done: Boolean(clinicName), hint: 'Название и tenant-контекст готовы' },
    { id: 'team', label: 'Сотрудники', done: memberCount > 1, hint: memberCount > 1 ? `${memberCount} активных пользователей` : 'Пригласите хотя бы одного сотрудника' },
    { id: 'whatsapp', label: 'WhatsApp', done: connectedProvider(providers, 'waba'), hint: connectedProvider(providers, 'waba') ? 'Подключено' : 'Подключите WhatsApp Business' },
    { id: 'telephony', label: 'Телефония', done: connectedProvider(providers, 'zadarma'), hint: connectedProvider(providers, 'zadarma') ? 'Подключено' : 'Подключите телефонию' },
    { id: 'ads', label: 'Реклама', done: connectedProvider(providers, 'meta') || connectedProvider(providers, 'google'), hint: connectedProvider(providers, 'meta') || connectedProvider(providers, 'google') ? 'Рекламный источник подключён' : 'Подключите Meta или Google' },
    { id: 'mis', label: 'МИС', done: connectedProvider(providers, 'mis'), hint: connectedProvider(providers, 'mis') ? 'Подключено' : 'Подключите МИС при наличии' },
  ];
  const completed = onboardingItems.filter((item) => item.done).length;
  const onboardingProgress = Math.round(completed * 100 / onboardingItems.length);

  return {
    id: companyId,
    name: clinicName,
    slug: company.slug,
    role: company.role,
    accessSource: company.accessSource || 'membership',
    current: companyId === currentCompanyId,
    onboarding: { progress: onboardingProgress, completed, total: onboardingItems.length, items: onboardingItems },
    usage: {
      users: memberCount,
      leads: Math.max(leadCount, totals.leads),
      openTasks: openTaskCount,
      integrations: connectedIntegrations,
    },
    performance: { leads: totals.leads, sales: totals.sales, revenueKzt: totals.revenue },
    health: {
      whatsapp: connectedProvider(providers, 'waba'),
      telephony: connectedProvider(providers, 'zadarma'),
      meta: connectedProvider(providers, 'meta'),
      google: connectedProvider(providers, 'google'),
      mis: connectedProvider(providers, 'mis'),
    },
  };
}

export async function handleOperatingOverviewRequest(
  request: Request,
  env: OperatingOverviewEnv,
  url: URL,
  userId: string,
  platformRole?: PlatformRole,
): Promise<Response | null> {
  if (url.pathname !== '/api/operating-overview') return null;
  if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405);

  try {
    const currentCompanyId = await resolveCompanyId(env, userId, platformRole);
    const allCompanies = await listUserCompanies(env, userId, platformRole);
    const cap = platformRole === 'super_admin' ? 50 : 25;
    const selected = allCompanies.slice(0, cap);
    const clinics = await Promise.all(selected.map((company) => clinicSnapshot(env, company, currentCompanyId)));
    const current = clinics.find((clinic) => clinic.current) || null;
    const network = clinics.reduce((acc, clinic) => ({
      clinics: acc.clinics + 1,
      users: acc.users + clinic.usage.users,
      leads: acc.leads + clinic.performance.leads,
      sales: acc.sales + clinic.performance.sales,
      revenueKzt: acc.revenueKzt + clinic.performance.revenueKzt,
      openTasks: acc.openTasks + clinic.usage.openTasks,
    }), { clinics: 0, users: 0, leads: 0, sales: 0, revenueKzt: 0, openTasks: 0 });

    return json({
      currentCompanyId,
      current,
      clinics,
      network,
      truncated: allCompanies.length > selected.length,
      totalAccessibleClinics: allCompanies.length,
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
}
