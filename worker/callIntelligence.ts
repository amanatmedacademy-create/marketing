import type { Env } from './integrations';
import { requireCompanyId, type TenantScopedEnv } from './tenantScope';

type Row = Record<string, unknown>;
type CallIntelligenceEnv = Env & TenantScopedEnv & {
  OPENAI_API_KEY?: string;
  OPENAI_CALL_ANALYSIS_MODEL?: string;
};

const text = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
const num = (value: unknown): number => Number.isFinite(Number(value)) ? Number(value) : 0;

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
  if (!response.ok) throw new Error(`Call Intelligence DB ${response.status}: ${body.slice(0, 1200)}`);
  return (body ? JSON.parse(body) : null) as T;
}

function extractOutputText(payload: Row): string {
  const direct = text(payload.output_text);
  if (direct) return direct;
  const output = Array.isArray(payload.output) ? payload.output : [];
  for (const item of output) {
    if (!item || typeof item !== 'object') continue;
    const content = Array.isArray((item as Row).content) ? (item as Row).content as unknown[] : [];
    for (const part of content) {
      if (!part || typeof part !== 'object') continue;
      const value = part as Row;
      if (text(value.type) === 'output_text' && text(value.text)) return text(value.text);
    }
  }
  return '';
}

const schema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    summary: { type: 'string' },
    request_reason: { type: 'string' },
    patient_pain: { type: 'string' },
    objections: { type: 'array', items: { type: 'string' } },
    call_result: { type: 'string' },
    appointment_created: { type: 'boolean' },
    next_action: { type: 'string' },
    loss_reason: { type: 'string' },
    quality_score: { type: 'number', minimum: 0, maximum: 100 },
    detected_pain: { type: 'boolean' },
    asked_questions: { type: 'boolean' },
    presented_value: { type: 'boolean' },
    handled_objection: { type: 'boolean' },
    offered_specific_time: { type: 'boolean' },
    confirmed_appointment: { type: 'boolean' },
    stated_next_step: { type: 'boolean' },
    follow_up_planned: { type: 'boolean' },
    script_violations: { type: 'array', items: { type: 'string' } },
    confidence: { type: 'number', minimum: 0, maximum: 100 },
  },
  required: [
    'summary','request_reason','patient_pain','objections','call_result','appointment_created','next_action','loss_reason','quality_score',
    'detected_pain','asked_questions','presented_value','handled_objection','offered_specific_time','confirmed_appointment','stated_next_step',
    'follow_up_planned','script_violations','confidence',
  ],
} as const;

async function patchCall(env: CallIntelligenceEnv, companyId: string, callId: string, patch: Row): Promise<Row> {
  const rows = await db<Row[]>(env, `marketing_calls?id=eq.${encodeURIComponent(callId)}&company_id=eq.${encodeURIComponent(companyId)}&select=*`, {
    method: 'PATCH',
    headers: { prefer: 'return=representation' },
    body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() }),
  });
  if (!rows[0]) throw new Error('Звонок не найден в выбранной клинике');
  return rows[0];
}

export async function analyzeMarketingCall(env: CallIntelligenceEnv, callId: string): Promise<Row> {
  const companyId = requireCompanyId(env);
  const rows = await db<Row[]>(env, `marketing_calls?id=eq.${encodeURIComponent(callId)}&company_id=eq.${encodeURIComponent(companyId)}&select=*&limit=1`);
  const call = rows[0];
  if (!call) throw new Error('Звонок не найден в выбранной клинике');
  if (text(call.call_status).toUpperCase() !== 'COMPLETED') throw new Error('AI-анализ доступен только для завершённого звонка');
  const transcript = text(call.transcript);
  if (!transcript) throw new Error('Для AI-анализа нужен транскрипт разговора');
  if (text(call.ai_analysis_status) === 'processing') throw new Error('AI-анализ этого звонка уже выполняется');

  const apiKey = text(env.OPENAI_API_KEY);
  if (!apiKey) throw new Error('OPENAI_API_KEY не настроен');
  const model = text(env.OPENAI_CALL_ANALYSIS_MODEL) || 'gpt-5-mini';

  await patchCall(env, companyId, callId, { ai_analysis_status: 'processing', ai_analysis_error: null });
  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        store: false,
        instructions: [
          'Ты анализатор качества звонков медицинской клиники.',
          'Анализируй только факты из транскрипта. Не ставь диагнозы и не делай медицинских выводов.',
          'Если факт не подтвержден текстом, используй false или пустую строку/массив.',
          'appointment_created=true только если пациент явно согласился на конкретную запись/время.',
          'loss_reason заполняй только если запись не состоялась и причина понятна из разговора.',
          'quality_score оценивает работу оператора: выявление потребности, вопросы, ценность, возражения, конкретный следующий шаг и запись.',
          'script_violations содержит только наблюдаемые нарушения коммуникации, без домыслов.',
        ].join(' '),
        input: `Транскрипт звонка:\n${transcript.slice(0, 60000)}`,
        text: {
          format: {
            type: 'json_schema',
            name: 'clinic_call_analysis',
            strict: true,
            schema,
          },
        },
      }),
    });
    const raw = await response.text();
    let payload: Row = {};
    try { payload = raw ? JSON.parse(raw) as Row : {}; } catch { payload = { raw }; }
    if (!response.ok) {
      const error = payload.error && typeof payload.error === 'object' ? payload.error as Row : {};
      throw new Error(text(error.message) || `OpenAI Responses ${response.status}`);
    }
    const output = extractOutputText(payload);
    if (!output) throw new Error('AI не вернул структурированный анализ');
    const analysis = JSON.parse(output) as Row;
    const now = new Date().toISOString();
    const appointmentCreated = analysis.appointment_created === true;
    const result = await patchCall(env, companyId, callId, {
      summary: text(analysis.summary) || null,
      request_reason: text(analysis.request_reason) || null,
      patient_pain: text(analysis.patient_pain) || null,
      objections: Array.isArray(analysis.objections) ? analysis.objections.map(text).filter(Boolean).slice(0, 20) : [],
      call_result: text(analysis.call_result) || null,
      appointment_created: appointmentCreated,
      next_action: text(analysis.next_action) || null,
      loss_reason: appointmentCreated ? null : (text(analysis.loss_reason) || null),
      quality_score: Math.max(0, Math.min(100, num(analysis.quality_score))),
      detected_pain: analysis.detected_pain === true,
      asked_questions: analysis.asked_questions === true,
      presented_value: analysis.presented_value === true,
      handled_objection: analysis.handled_objection === true,
      offered_specific_time: analysis.offered_specific_time === true,
      confirmed_appointment: analysis.confirmed_appointment === true,
      stated_next_step: analysis.stated_next_step === true,
      follow_up_planned: analysis.follow_up_planned === true,
      script_violations: Array.isArray(analysis.script_violations) ? analysis.script_violations.map(text).filter(Boolean).slice(0, 20) : [],
      ai_analysis_status: 'completed',
      ai_analysis_model: model,
      ai_analyzed_at: now,
      ai_analysis_error: null,
      ai_confidence: Math.max(0, Math.min(100, num(analysis.confidence))),
      metadata: {
        ...(call.metadata && typeof call.metadata === 'object' && !Array.isArray(call.metadata) ? call.metadata as Row : {}),
        call_intelligence: { model, response_id: text(payload.id), analyzed_at: now },
      },
    });
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await patchCall(env, companyId, callId, { ai_analysis_status: 'failed', ai_analysis_error: message.slice(0, 1000) }).catch(() => undefined);
    throw error;
  }
}
