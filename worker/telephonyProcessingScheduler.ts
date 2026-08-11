import { processMarketingCallTranscription, type CallTranscriptionEnv, type TelephonySettings } from './callTranscription';
import { materializeCallFollowUpTasks } from './callFollowUpTasks';
import { hydrateIntegrationEnv } from './credentials';
import type { Env } from './integrations';

type Row = Record<string, unknown>;
export type TelephonyProcessingSchedulerEnv = Env & CallTranscriptionEnv;

const text = (value: unknown): string => typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim();

function headers(env: Env): Headers {
  const next = new Headers();
  next.set('apikey', env.SUPABASE_SERVICE_ROLE_KEY);
  next.set('authorization', `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`);
  next.set('accept', 'application/json');
  return next;
}

async function db<T>(env: Env, path: string): Promise<T> {
  const response = await fetch(`${env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/${path}`, {
    headers: headers(env),
    cache: 'no-store',
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`Telephony scheduler DB ${response.status}: ${body.slice(0, 1200)}`);
  return (body ? JSON.parse(body) : null) as T;
}

function due(call: Row, settings: TelephonySettings, nowMs: number): boolean {
  const attempts = Math.max(0, Number(call.transcription_attempts || 0));
  if (attempts >= Number(settings.max_attempts || 3)) return false;
  const readyAt = Date.parse(text(call.recording_ready_at) || text(call.updated_at) || text(call.started_at));
  if (Number.isFinite(readyAt) && nowMs < readyAt + Number(settings.recording_delay_seconds || 0) * 1000) return false;
  if (text(call.transcription_status) === 'failed') {
    const lastAttempt = Date.parse(text(call.last_transcription_attempt_at));
    if (Number.isFinite(lastAttempt) && nowMs < lastAttempt + Number(settings.retry_after_minutes || 15) * 60_000) return false;
  }
  return true;
}

export async function runScheduledTelephonyProcessing(env: TelephonyProcessingSchedulerEnv): Promise<Array<Record<string, unknown>>> {
  const settingsRows = await db<TelephonySettings[]>(env, 'telephony_settings?auto_transcribe=eq.true&select=*&order=company_id.asc&limit=1000');
  const results: Array<Record<string, unknown>> = [];
  const nowMs = Date.now();

  for (const settings of settingsRows) {
    const companyId = text(settings.company_id);
    if (!companyId) continue;
    try {
      const tenantBase = { ...env, CURRENT_COMPANY_ID: companyId } as TelephonyProcessingSchedulerEnv;
      const runtime = await hydrateIntegrationEnv(tenantBase) as TelephonyProcessingSchedulerEnv;
      const tenantConfigured = text(runtime.ZADARMA_TENANT_CONFIGURED) === 'true';
      const legacyDefault = !tenantConfigured && text(runtime.DEFAULT_COMPANY_ID) === companyId;
      if (!tenantConfigured && !legacyDefault) {
        results.push({ companyId, ok: true, skipped: 'zadarma_not_configured' });
        continue;
      }

      const calls = await db<Row[]>(runtime,
        `marketing_calls?company_id=eq.${encodeURIComponent(companyId)}&call_status=eq.COMPLETED&transcription_status=in.(pending,failed)&or=(recording_external_id.not.is.null,pbx_call_id.not.is.null,recording_url.not.is.null)&select=*&order=updated_at.asc&limit=10`,
      );
      const candidates = calls.filter((call) => due(call, settings, nowMs));
      let completed = 0;
      let failed = 0;
      for (const call of candidates) {
        const callId = text(call.id);
        if (!callId) continue;
        try {
          await processMarketingCallTranscription(
            { ...runtime, OPENAI_TRANSCRIPTION_MODEL: settings.transcription_model || 'gpt-4o-mini-transcribe' },
            callId,
            { analyze: Boolean(settings.auto_analyze) },
          );
          completed += 1;
        } catch (error) {
          failed += 1;
          console.error('Scheduled call transcription failed', { companyId, callId, error: error instanceof Error ? error.message : String(error) });
        }
      }
      const followUps = await materializeCallFollowUpTasks(runtime, companyId);
      results.push({ companyId, ok: true, scanned: calls.length, eligible: candidates.length, completed, failed, followUps });
    } catch (error) {
      results.push({ companyId, ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return results;
}