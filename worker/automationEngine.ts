import { resolveCompanyId } from './companyContext';

type Row = Record<string, unknown>;
type ActionResult = { type: string; ok: boolean; detail?: string };

export interface AutomationEngineEnv {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  DEFAULT_COMPANY_ID?: string;
}

const text = (value: unknown): string => typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim();
const record = (value: unknown): Row => value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {};
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });

async function db<T>(env: AutomationEngineEnv, path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('apikey', env.SUPABASE_SERVICE_ROLE_KEY);
  headers.set('authorization', `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`);
  headers.set('content-type', 'application/json');
  const response = await fetch(`${env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/${path}`, { ...init, headers, cache: 'no-store' });
  const body = await response.text();
  if (!response.ok) throw new Error(`Automation DB ${response.status}: ${body.slice(0, 1200)}`);
  return (body ? JSON.parse(body) : null) as T;
}

function matchesLead(rule: Row, lead: Row): boolean {
  const trigger = text(rule.trigger_type) || 'lead_created';
  const config = record(rule.trigger_config);
  if (trigger === 'lead_created') {
    const source = text(config.source).toLowerCase();
    return !source || `${text(lead.source)} ${text(lead.platform)} ${text(lead.utm_source)}`.toLowerCase().includes(source);
  }
  if (trigger === 'lead_stage') {
    const stage = text(config.stage).toLowerCase();
    return Boolean(stage) && text(lead.stage).toLowerCase() === stage;
  }
  if (trigger === 'unassigned_lead') return !text(lead.manager);
  return false;
}

async function executeAction(env: AutomationEngineEnv, action: Row, lead: Row): Promise<ActionResult> {
  const type = text(action.type);
  if (type === 'create_task') {
    const titleTemplate = text(action.title) || 'Обработать лид {{name}}';
    const title = titleTemplate.replace(/{{name}}/g, text(lead.name) || 'Без имени').replace(/{{phone}}/g, text(lead.phone));
    const dueDays = Math.max(0, Math.min(365, Number(action.dueDays || 0)));
    const due = new Date(Date.now() + dueDays * 86400000).toISOString().slice(0, 10);
    await db(env, 'marketing_tasks', { method: 'POST', headers: { prefer: 'return=minimal' }, body: JSON.stringify({ title, owner: text(lead.manager) || text(action.owner) || 'Не назначен', due_on: due, priority: text(action.priority) || 'Средний', done: false }) });
    return { type, ok: true, detail: title };
  }
  if (type === 'update_lead_stage') {
    const stage = text(action.stage);
    if (!stage) return { type, ok: false, detail: 'stage is required' };
    await db(env, `marketing_leads?id=eq.${encodeURIComponent(text(lead.id))}`, { method: 'PATCH', headers: { prefer: 'return=minimal' }, body: JSON.stringify({ stage, updated_at: new Date().toISOString() }) });
    return { type, ok: true, detail: stage };
  }
  if (type === 'webhook') {
    const url = text(action.url);
    if (!/^https:\/\//i.test(url)) return { type, ok: false, detail: 'Only HTTPS webhook URLs are allowed' };
    const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ event: 'imds.marketing.automation', lead: { id: lead.id, name: lead.name, phone: lead.phone, stage: lead.stage, source: lead.source }, action }) });
    return { type, ok: response.ok, detail: `HTTP ${response.status}` };
  }
  return { type: type || 'unknown', ok: false, detail: 'Unsupported action' };
}

async function createRun(env: AutomationEngineEnv, companyId: string, ruleId: string, eventKey: string, leadId: string): Promise<Row | null> {
  try {
    const rows = await db<Row[]>(env, `marketing_automation_runs?on_conflict=${encodeURIComponent('rule_id,event_key')}&select=*`, { method: 'POST', headers: { prefer: 'resolution=ignore-duplicates,return=representation' }, body: JSON.stringify({ company_id: companyId, rule_id: ruleId, event_key: eventKey, subject_type: 'lead', subject_id: leadId, status: 'running', started_at: new Date().toISOString() }) });
    return rows[0] || null;
  } catch { return null; }
}

export async function runAutomationEngine(env: AutomationEngineEnv): Promise<{ rules: number; matched: number; executed: number; failed: number }> {
  const companyId = await resolveCompanyId(env);
  const rules = await db<Row[]>(env, 'marketing_automations?enabled=eq.true&select=*&order=created_at.asc');
  let matched = 0; let executed = 0; let failed = 0;
  for (const rule of rules) {
    const since = text(rule.last_checked_at) || new Date(Date.now() - 24 * 3600000).toISOString();
    const leads = await db<Row[]>(env, `marketing_leads?company_id=eq.${encodeURIComponent(companyId)}&updated_at=gt.${encodeURIComponent(since)}&select=id,name,phone,source,platform,utm_source,stage,manager,created_at,updated_at&order=updated_at.asc&limit=1000`);
    for (const lead of leads) {
      if (!matchesLead(rule, lead)) continue;
      matched += 1;
      const eventKey = `${text(rule.trigger_type) || 'lead_created'}:${text(lead.id)}:${text(lead.updated_at) || text(lead.created_at)}`;
      const run = await createRun(env, companyId, text(rule.id), eventKey, text(lead.id));
      if (!run) continue;
      const actions = Array.isArray(rule.actions) ? rule.actions.map(record) : [];
      const results: ActionResult[] = [];
      let errorText = '';
      try {
        for (const action of actions) results.push(await executeAction(env, action, lead));
        const allOk = results.length > 0 && results.every((item) => item.ok);
        if (!allOk) errorText = results.filter((item) => !item.ok).map((item) => `${item.type}: ${item.detail || 'failed'}`).join('; ');
        await db(env, `marketing_automation_runs?id=eq.${encodeURIComponent(text(run.id))}`, { method: 'PATCH', headers: { prefer: 'return=minimal' }, body: JSON.stringify({ status: allOk ? 'success' : 'failed', action_results: results, error: errorText || null, finished_at: new Date().toISOString() }) });
        if (allOk) executed += 1; else failed += 1;
      } catch (error) {
        failed += 1; errorText = error instanceof Error ? error.message : String(error);
        await db(env, `marketing_automation_runs?id=eq.${encodeURIComponent(text(run.id))}`, { method: 'PATCH', headers: { prefer: 'return=minimal' }, body: JSON.stringify({ status: 'failed', action_results: results, error: errorText, finished_at: new Date().toISOString() }) }).catch(() => undefined);
      }
    }
    await db(env, `marketing_automations?id=eq.${encodeURIComponent(text(rule.id))}`, { method: 'PATCH', headers: { prefer: 'return=minimal' }, body: JSON.stringify({ last_checked_at: new Date().toISOString(), last_run_at: new Date().toISOString(), last_error: null, run_count: Number(rule.run_count || 0) + 1, updated_at: new Date().toISOString() }) });
  }
  return { rules: rules.length, matched, executed, failed };
}

export async function handleAutomationEngineRequest(request: Request, env: AutomationEngineEnv, url: URL): Promise<Response | null> {
  if (url.pathname === '/api/automation/execute' && request.method === 'POST') {
    try { return json({ ok: true, ...(await runAutomationEngine(env)) }); }
    catch (error) { return json({ error: error instanceof Error ? error.message : String(error) }, 500); }
  }
  if (url.pathname === '/api/automation/runs' && request.method === 'GET') {
    const companyId = await resolveCompanyId(env);
    const rows = await db<Row[]>(env, `marketing_automation_runs?company_id=eq.${encodeURIComponent(companyId)}&select=*&order=started_at.desc&limit=200`);
    return json(rows);
  }
  return null;
}
