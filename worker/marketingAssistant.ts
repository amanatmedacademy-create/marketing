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

async function businessContext(env: MarketingAssistantEnv): Promise<Row> {
  const companyId = text(env.CURRENT_COMPANY_ID);
  if (!companyId) throw new Error('Текущая клиника не определена для IMDS AI');
  const companyFilter = `company_id=eq.${encodeURIComponent(companyId)}`;

  const [dailyMetrics, leads, ads, runs] = await Promise.all([
    db<Row[]>(env, `marketing_daily_metrics?select=date,source,platform,leads,target_leads,arrived,sales,spend,revenue&${companyFilter}&order=date.desc&limit=3000`).catch(() => []),
    db<Row[]>(env, `marketing_leads?select=stage,source,platform,manager,sale_amount,created_at,utm_source,utm_campaign&${companyFilter}&order=created_at.desc&limit=1000`).catch(() => []),
    db<Row[]>(env, `marketing_ads?select=platform,campaign_name,spend,leads,sales,revenue,impressions,clicks&${companyFilter}&order=spend.desc&limit=100`).catch(() => []),
    db<Row[]>(env, `integration_runs?select=source,status,fetched,written,error,started_at,finished_at&${companyFilter}&order=started_at.desc&limit=30`).catch(() => []),
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
          { role: 'system', content: 'Ты IMDS Marketing AI. Анализируй только переданные агрегированные данные текущей клиники. Отвечай по-русски, кратко и предметно. Не выдумывай отсутствующие показатели. Отделяй факт от рекомендации. Для рекомендаций указывай конкретный следующий шаг.' },
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
