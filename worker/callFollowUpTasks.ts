import type { Env } from './integrations';

type Row = Record<string, unknown>;
const text = (value: unknown): string => typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim();

function headers(env: Env, extra: HeadersInit = {}): Headers {
  const next = new Headers(extra);
  next.set('apikey', env.SUPABASE_SERVICE_ROLE_KEY);
  next.set('authorization', `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`);
  next.set('accept', 'application/json');
  if (!next.has('content-type')) next.set('content-type', 'application/json');
  return next;
}

async function db<T>(env: Env, path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/${path}`, {
    ...init,
    headers: headers(env, init.headers),
    cache: 'no-store',
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`Call follow-up DB ${response.status}: ${body.slice(0, 1200)}`);
  return (body ? JSON.parse(body) : null) as T;
}

export async function materializeCallFollowUpTasks(env: Env, companyId: string): Promise<{ scanned: number; created: number }> {
  const calls = await db<Row[]>(env,
    `marketing_calls?company_id=eq.${encodeURIComponent(companyId)}&ai_analysis_status=eq.completed&follow_up_planned=eq.true&next_action=not.is.null&select=id,lead_id,operator_user_id,client_name,client_phone,next_action,ai_analyzed_at&order=ai_analyzed_at.desc&limit=50`,
  );
  let created = 0;
  for (const call of calls) {
    const callId = text(call.id);
    const nextAction = text(call.next_action);
    if (!callId || !nextAction) continue;
    const now = new Date().toISOString();
    const rows = await db<Row[]>(env, 'crm_tasks?on_conflict=company_id,external_key&select=id', {
      method: 'POST',
      headers: { prefer: 'resolution=ignore-duplicates,return=representation' },
      body: JSON.stringify({
        company_id: companyId,
        title: nextAction.slice(0, 180),
        description: `Следующее действие подтверждено AI-анализом звонка ${callId}. Пациент: ${text(call.client_name) || text(call.client_phone) || 'не определён'}.`,
        status: 'todo',
        priority: 'medium',
        assignee_id: /^[0-9a-f-]{36}$/i.test(text(call.operator_user_id)) ? text(call.operator_user_id) : null,
        source: 'CALL_AI_FOLLOWUP',
        external_key: `call-ai-followup:${callId}`,
        created_at: now,
        updated_at: now,
      }),
    });
    if (rows[0]) created += 1;
  }
  return { scanned: calls.length, created };
}
