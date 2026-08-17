import { resolveCompanyId, type CompanyContextEnv } from './companyContext';
import { localDataRequest } from './localData';

type Row = Record<string, unknown>;
type ActionResult = { type: string; ok: boolean; detail?: string };
type EngineResult = { rules: number; matched: number; executed: number; failed: number };

export interface AutomationEngineEnv extends CompanyContextEnv {}

const text = (value: unknown): string => typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim();
const record = (value: unknown): Row => value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {};
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });

async function db<T>(env: AutomationEngineEnv, path: string, init: RequestInit = {}): Promise<T> {
  const response = await localDataRequest(env, path, { ...init, cache: 'no-store' });
  const body = await response.text();
  if (!response.ok) throw new Error(`Automation DB ${response.status}: ${body.slice(0, 1200)}`);
  return (body ? JSON.parse(body) : null) as T;
}

function actionsFor(rule: Row): Row[] {
  return Array.isArray(rule.actions) ? rule.actions.map(record).filter((action) => text(action.type)) : [];
}

function isExecutable(rule: Row): boolean {
  return Boolean(text(rule.trigger_type) && actionsFor(rule).length);
}

function matchesLead(rule: Row, lead: Row): boolean {
  const trigger = text(rule.trigger_type);
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

async function executeAction(env: AutomationEngineEnv, companyId: string, action: Row, lead: Row): Promise<ActionResult> {
  const type = text(action.type);
  if (type === 'create_task') {
    const titleTemplate = text(action.title) || 'Обработать лид {{name}}';
    const title = titleTemplate.replace(/{{name}}/g, text(lead.name) || 'Без имени').replace(/{{phone}}/g, text(lead.phone));
    const dueDays = Math.max(0, Math.min(365, Number(action.dueDays || 0)));
    const due = new Date(Date.now() + dueDays * 86400000).toISOString().slice(0, 10);
    await db(env, 'marketing_tasks', {
      method: 'POST',
      headers: { prefer: 'return=minimal' },
      body: JSON.stringify({ company_id: companyId, title, owner: text(lead.manager) || text(action.owner) || 'Не назначен', due_on: due, priority: text(action.priority) || 'Средний', done: false }),
    });
    return { type, ok: true, detail: title };
  }
  if (type === 'update_lead_stage') {
    const stage = text(action.stage);
    if (!stage) return { type, ok: false, detail: 'stage is required' };
    await db(env, `marketing_leads?id=eq.${encodeURIComponent(text(lead.id))}&company_id=eq.${encodeURIComponent(companyId)}`, {
      method: 'PATCH',
      headers: { prefer: 'return=minimal' },
      body: JSON.stringify({ stage, updated_at: new Date().toISOString() }),
    });
    return { type, ok: true, detail: stage };
  }
  if (type === 'webhook') {
    const url = text(action.url);
    if (!/^https:\/\//i.test(url)) return { type, ok: false, detail: 'Only HTTPS webhook URLs are allowed' };
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ event: 'imds.marketing.automation', companyId, lead: { id: lead.id, name: lead.name, phone: lead.phone, stage: lead.stage, source: lead.source }, action }),
    });
    return { type, ok: response.ok, detail: `HTTP ${response.status}` };
  }
  return { type: type || 'unknown', ok: false, detail: 'Unsupported action' };
}

async function createRun(env: AutomationEngineEnv, companyId: string, ruleId: string, eventKey: string, leadId: string): Promise<Row | null> {
  try {
    const rows = await db<Row[]>(env, `marketing_automation_runs?on_conflict=${encodeURIComponent('rule_id,event_key')}&select=*`, {
      method: 'POST',
      headers: { prefer: 'resolution=ignore-duplicates,return=representation' },
      body: JSON.stringify({ company_id: companyId, rule_id: ruleId, event_key: eventKey, subject_type: 'lead', subject_id: leadId, status: 'running', started_at: new Date().toISOString() }),
    });
    return rows[0] || null;
  } catch {
    return null;
  }
}

async function runCompanyAutomationEngine(env: AutomationEngineEnv, companyId: string): Promise<EngineResult> {
  const allRules = await db<Row[]>(env, `marketing_automations?company_id=eq.${encodeURIComponent(companyId)}&enabled=eq.true&select=*&order=created_at.asc`);
  const rules = allRules.filter(isExecutable);
  let matched = 0;
  let executed = 0;
  let failed = 0;

  for (const rule of rules) {
    const trigger = text(rule.trigger_type);
    const since = text(rule.last_checked_at) || new Date(Date.now() - 24 * 3600000).toISOString();
    const dateField = trigger === 'lead_created' ? 'created_at' : 'updated_at';
    const leads = await db<Row[]>(env, `marketing_leads?company_id=eq.${encodeURIComponent(companyId)}&${dateField}=gt.${encodeURIComponent(since)}&select=id,name,phone,source,platform,utm_source,stage,manager,created_at,updated_at&order=${dateField}.asc&limit=1000`);

    for (const lead of leads) {
      if (!matchesLead(rule, lead)) continue;
      matched += 1;
      const eventAt = trigger === 'lead_created' ? text(lead.created_at) : text(lead.updated_at) || text(lead.created_at);
      const eventKey = `${trigger}:${text(lead.id)}:${eventAt}`;
      const run = await createRun(env, companyId, text(rule.id), eventKey, text(lead.id));
      if (!run) continue;
      const results: ActionResult[] = [];
      let errorText = '';
      try {
        for (const action of actionsFor(rule)) results.push(await executeAction(env, companyId, action, lead));
        const allOk = results.every((item) => item.ok);
        if (!allOk) errorText = results.filter((item) => !item.ok).map((item) => `${item.type}: ${item.detail || 'failed'}`).join('; ');
        await db(env, `marketing_automation_runs?id=eq.${encodeURIComponent(text(run.id))}&company_id=eq.${encodeURIComponent(companyId)}`, {
          method: 'PATCH',
          headers: { prefer: 'return=minimal' },
          body: JSON.stringify({ status: allOk ? 'success' : 'failed', action_results: results, error: errorText || null, finished_at: new Date().toISOString() }),
        });
        if (allOk) executed += 1;
        else failed += 1;
      } catch (error) {
        failed += 1;
        errorText = error instanceof Error ? error.message : String(error);
        await db(env, `marketing_automation_runs?id=eq.${encodeURIComponent(text(run.id))}&company_id=eq.${encodeURIComponent(companyId)}`, {
          method: 'PATCH',
          headers: { prefer: 'return=minimal' },
          body: JSON.stringify({ status: 'failed', action_results: results, error: errorText, finished_at: new Date().toISOString() }),
        }).catch(() => undefined);
      }
    }

    await db(env, `marketing_automations?id=eq.${encodeURIComponent(text(rule.id))}&company_id=eq.${encodeURIComponent(companyId)}`, {
      method: 'PATCH',
      headers: { prefer: 'return=minimal' },
      body: JSON.stringify({ last_checked_at: new Date().toISOString(), last_run_at: new Date().toISOString(), last_error: null, run_count: Number(rule.run_count || 0) + 1, updated_at: new Date().toISOString() }),
    });
  }

  return { rules: rules.length, matched, executed, failed };
}

async function scheduledCompanyIds(env: AutomationEngineEnv): Promise<string[]> {
  if (text(env.CURRENT_COMPANY_ID) || text(env.DEFAULT_COMPANY_ID)) return [await resolveCompanyId(env)];
  const companies = await db<Row[]>(env, 'crm_companies?status=eq.active&select=id&order=created_at.asc&limit=1000');
  return [...new Set(companies.map((company) => text(company.id)).filter(Boolean))];
}

export async function runAutomationEngine(env: AutomationEngineEnv): Promise<EngineResult> {
  const companyIds = await scheduledCompanyIds(env);
  const total: EngineResult = { rules: 0, matched: 0, executed: 0, failed: 0 };
  for (const companyId of companyIds) {
    const result = await runCompanyAutomationEngine(env, companyId);
    total.rules += result.rules;
    total.matched += result.matched;
    total.executed += result.executed;
    total.failed += result.failed;
  }
  return total;
}

export async function handleAutomationEngineRequest(request: Request, env: AutomationEngineEnv, url: URL): Promise<Response | null> {
  if (url.pathname === '/api/automation/execute' && request.method === 'POST') {
    try {
      const companyId = await resolveCompanyId(env);
      return json({ ok: true, ...(await runCompanyAutomationEngine(env, companyId)) });
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : String(error) }, 500);
    }
  }
  if (url.pathname === '/api/automation/runs' && request.method === 'GET') {
    const companyId = await resolveCompanyId(env);
    const rows = await db<Row[]>(env, `marketing_automation_runs?company_id=eq.${encodeURIComponent(companyId)}&select=*&order=started_at.desc&limit=200`);
    return json(rows);
  }
  return null;
}
