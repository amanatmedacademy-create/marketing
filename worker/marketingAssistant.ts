type Row = Record<string, unknown>;

export interface MarketingAssistantEnv {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  CURRENT_COMPANY_ID?: string;
  OPENAI_API_KEY?: string;
  OPENAI_MODEL?: string;
}

const text = (value: unknown): string => typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim();
const record = (value: unknown): Row => value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {};
const number = (value: unknown): number => Number(value || 0) || 0;
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });

async function db<T>(env: MarketingAssistantEnv, path: string): Promise<T> {
  const response = await fetch(`${env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/${path}`, { headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, accept: 'application/json' } });
  const body = await response.text();
  if (!response.ok) throw new Error(`Assistant data ${response.status}: ${body.slice(0, 900)}`);
  return (body ? JSON.parse(body) : null) as T;
}

function outputText(payload: Row): string {
  const direct = text(payload.output_text);
  if (direct) return direct;
  const output = Array.isArray(payload.output) ? payload.output : [];
  const parts: string[] = [];
  for (const item of output) {
    const content = Array.isArray(record(item).content) ? record(item).content as unknown[] : [];
    for (const entry of content) {
      const value = text(record(entry).text);
      if (value) parts.push(value);
    }
  }
  return parts.join('\n').trim();
}

function aggregateDashboard(rows: Row[]): Row[] {
  const grouped = new Map<string, Row>();
  for (const row of rows) {
    const date = text(row.date);
    if (!date) continue;
    const current = grouped.get(date) || { date, leads: 0, target_leads: 0, arrived: 0, sales: 0, spend: 0, revenue: 0 };
    current.leads = number(current.leads) + number(row.leads);
    current.target_leads = number(current.target_leads) + number(row.target_leads);
    current.arrived = number(current.arrived) + number(row.arrived);
    current.sales = number(current.sales) + number(row.sales);
    current.spend = number(current.spend) + number(row.spend);
    current.revenue = number(current.revenue) + number(row.revenue);
    grouped.set(date, current);
  }
  return [...grouped.values()].sort((a, b) => text(b.date).localeCompare(text(a.date))).slice(0, 90);
}

function aggregateSources(rows: Row[]): Row[] {
  const grouped = new Map<string, Row>();
  for (const row of rows) {
    const source = text(row.source) || 'Не определено';
    const platform = text(row.platform) || 'unknown';
    const key = `${source}\u0000${platform}`;
    const current = grouped.get(key) || { source, platform, leads: 0, target_leads: 0, arrived: 0, sales: 0, spend: 0, revenue: 0 };
    current.leads = number(current.leads) + number(row.leads);
    current.target_leads = number(current.target_leads) + number(row.target_leads);
    current.arrived = number(current.arrived) + number(row.arrived);
    current.sales = number(current.sales) + number(row.sales);
    current.spend = number(current.spend) + number(row.spend);
    current.revenue = number(current.revenue) + number(row.revenue);
    grouped.set(key, current);
  }
  return [...grouped.values()].sort((a, b) => number(b.revenue) - number(a.revenue)).slice(0, 30);
}

function aggregateCalls(rows: Row[]): Row {
  const statusCounts: Record<string, number> = {};
  const resultCounts: Record<string, number> = {};
  const operatorCounts: Record<string, number> = {};
  let appointments = 0;
  let totalDuration = 0;
  let completedDurationCount = 0;
  let qualityTotal = 0;
  let qualityCount = 0;
  let withoutNextAction = 0;
  let lostCalls = 0;

  for (const row of rows) {
    const status = text(row.call_status) || 'UNKNOWN';
    const result = text(row.call_result) || 'Не указан';
    const operator = text(row.operator_name) || 'Не назначен';
    statusCounts[status] = (statusCounts[status] || 0) + 1;
    resultCounts[result] = (resultCounts[result] || 0) + 1;
    operatorCounts[operator] = (operatorCounts[operator] || 0) + 1;
    if (row.appointment_created === true) appointments += 1;
    const duration = number(row.duration_seconds);
    if (duration > 0) { totalDuration += duration; completedDurationCount += 1; }
    const quality = Number(row.quality_score);
    if (Number.isFinite(quality) && quality > 0) { qualityTotal += quality; qualityCount += 1; }
    if (!text(row.next_action)) withoutNextAction += 1;
    if (text(row.loss_reason)) lostCalls += 1;
  }

  return {
    total: rows.length,
    statusCounts,
    resultCounts,
    appointments,
    appointmentRate: rows.length ? Number((appointments / rows.length * 100).toFixed(1)) : 0,
    averageDurationSeconds: completedDurationCount ? Math.round(totalDuration / completedDurationCount) : 0,
    averageQualityScore: qualityCount ? Number((qualityTotal / qualityCount).toFixed(1)) : null,
    withoutNextAction,
    lostCalls,
    topOperators: Object.entries(operatorCounts).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([operator, calls]) => ({ operator, calls })),
  };
}

function aggregateErrors(rows: Row[]): Row {
  const statusCounts: Record<string, number> = {};
  const sourceCounts: Record<string, number> = {};
  let repeats = 0;
  for (const row of rows) {
    const status = text(row.status) || 'UNKNOWN';
    const source = text(row.source) || 'unknown';
    statusCounts[status] = (statusCounts[status] || 0) + 1;
    sourceCounts[source] = (sourceCounts[source] || 0) + 1;
    repeats += number(row.repeat_count);
  }
  return {
    total: rows.length,
    open: statusCounts.OPEN || 0,
    retrying: statusCounts.RETRYING || 0,
    resolved: statusCounts.RESOLVED || 0,
    repeats,
    bySource: Object.entries(sourceCounts).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([source, count]) => ({ source, count })),
    recent: rows.slice(0, 30).map((row) => ({ source: text(row.source), endpoint: text(row.endpoint), code: text(row.code), status: text(row.status), repeatCount: number(row.repeat_count), lastSeenAt: text(row.last_seen_at) })),
  };
}

function aggregateAudit(rows: Row[]): Row {
  const actionCounts: Record<string, number> = {};
  for (const row of rows) {
    const action = text(row.action) || 'unknown';
    actionCounts[action] = (actionCounts[action] || 0) + 1;
  }
  return {
    total: rows.length,
    actions: Object.entries(actionCounts).sort((a, b) => b[1] - a[1]).slice(0, 20).map(([action, count]) => ({ action, count })),
    recent: rows.slice(0, 40).map((row) => ({ action: text(row.action), entityType: text(row.entity_type), createdAt: text(row.created_at) })),
  };
}

async function businessContext(env: MarketingAssistantEnv): Promise<Row> {
  const companyId = text(env.CURRENT_COMPANY_ID);
  if (!companyId) throw new Error('Текущая клиника не определена для IMDS AI');
  const companyFilter = `company_id=eq.${encodeURIComponent(companyId)}`;

  const [dailyMetrics, leads, ads, runs, calls, errors, auditRows] = await Promise.all([
    db<Row[]>(env, `marketing_daily_metrics?select=date,source,platform,leads,target_leads,arrived,sales,spend,revenue&${companyFilter}&order=date.desc&limit=3000`).catch(() => []),
    db<Row[]>(env, `marketing_leads?select=stage,source,platform,manager,sale_amount,created_at,utm_source,utm_campaign&${companyFilter}&order=created_at.desc&limit=1000`).catch(() => []),
    db<Row[]>(env, `marketing_ads?select=platform,campaign_name,spend,leads,sales,revenue,impressions,clicks&${companyFilter}&order=spend.desc&limit=100`).catch(() => []),
    db<Row[]>(env, `integration_runs?select=source,status,fetched,written,error,started_at,finished_at&${companyFilter}&order=started_at.desc&limit=50`).catch(() => []),
    db<Row[]>(env, `marketing_calls?select=call_status,call_result,appointment_created,duration_seconds,quality_score,next_action,loss_reason,operator_name,started_at&${companyFilter}&order=started_at.desc&limit=1000`).catch(() => []),
    db<Row[]>(env, `error_logs?select=source,endpoint,code,status,repeat_count,last_seen_at&${companyFilter}&order=last_seen_at.desc&limit=200`).catch(() => []),
    db<Row[]>(env, `audit_logs?select=action,entity_type,created_at&${companyFilter}&order=created_at.desc&limit=300`).catch(() => []),
  ]);

  const stageCounts: Record<string, number> = {};
  let leadRevenue = 0; let missingUtm = 0; let unassigned = 0;
  for (const lead of leads) {
    const stage = text(lead.stage) || 'Не определено';
    stageCounts[stage] = (stageCounts[stage] || 0) + 1;
    leadRevenue += number(lead.sale_amount);
    if (!text(lead.utm_source) && !text(lead.utm_campaign)) missingUtm += 1;
    if (!text(lead.manager)) unassigned += 1;
  }

  return {
    generatedAt: new Date().toISOString(),
    companyId,
    dashboard: aggregateDashboard(dailyMetrics),
    sources: aggregateSources(dailyMetrics),
    topAds: ads.slice(0, 30),
    integrations: runs,
    telephony: aggregateCalls(calls),
    systemErrors: aggregateErrors(errors),
    audit: aggregateAudit(auditRows),
    webAnalytics: { available: false, reason: 'Источник web analytics пока не имеет подтверждённого tenant scope и не передаётся в AI.' },
    crm: { leadCount: leads.length, leadRevenue, stageCounts, dataQuality: { missingUtm, unassigned } },
  };
}

export async function handleMarketingAssistantRequest(request: Request, env: MarketingAssistantEnv, url: URL): Promise<Response | null> {
  if (url.pathname !== '/api/assistant/marketing') return null;
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!env.OPENAI_API_KEY) return json({ error: 'OPENAI_API_KEY не настроен в серверном окружении', code: 'AI_NOT_CONFIGURED' }, 503);
  const input = record(await request.json().catch(() => ({})));
  const question = text(input.question);
  if (!question) return json({ error: 'Введите вопрос' }, 400);
  if (question.length > 4000) return json({ error: 'Вопрос слишком длинный' }, 400);

  try {
    const context = await businessContext(env);
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { authorization: `Bearer ${env.OPENAI_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: text(env.OPENAI_MODEL) || 'gpt-5',
        input: [
          { role: 'system', content: 'Ты IMDS Intelligence — AI Marketing Assistant внутри IMDS Marketing. Анализируй только переданные данные текущей клиники. Ты можешь проводить аудит маркетинга, CRM, рекламы, телефонии, интеграций, системных ошибок и журнала аудита. Отвечай по-русски, структурированно и предметно. Не выдумывай отсутствующие показатели. Явно отделяй подтверждённые факты от гипотез и рекомендаций. Если данных недостаточно — так и скажи. Для проблем указывай приоритет, влияние и конкретный следующий шаг. Никогда не раскрывай секреты, токены или персональные данные.' },
          { role: 'user', content: `Вопрос: ${question}\n\nТекущие данные IMDS Marketing:\n${JSON.stringify(context)}` },
        ],
      }),
    });
    const payload = record(await response.json().catch(() => ({})));
    if (!response.ok) return json({ error: `OpenAI API ${response.status}: ${text(record(payload.error).message) || 'request failed'}` }, 502);
    const answer = outputText(payload);
    if (!answer) return json({ error: 'AI вернул пустой ответ' }, 502);
    return json({ answer, model: text(payload.model) || text(env.OPENAI_MODEL) || 'gpt-5', generatedAt: new Date().toISOString() });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
}
