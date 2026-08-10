alter table public.integration_credentials drop constraint integration_credentials_provider_check;
alter table public.integration_credentials add constraint integration_credentials_provider_check check (provider = any(array['bitrix'::text,'meta'::text,'tiktok'::text,'n8n'::text,'waba'::text,'zadarma'::text]));

alter table public.growth_recovery_settings add column if not exists appointment_recovery_enabled boolean not null default true;
alter table public.growth_recovery_settings add column if not exists no_show_grace_minutes integer not null default 60;
alter table public.growth_recovery_settings drop constraint if exists growth_recovery_settings_no_show_grace_minutes_check;
alter table public.growth_recovery_settings add constraint growth_recovery_settings_no_show_grace_minutes_check check (no_show_grace_minutes between 0 and 10080);

alter table public.growth_recovery_actions add column if not exists appointment_id uuid references public.waba_clinic_appointments(id) on delete set null;
alter table public.growth_recovery_actions drop constraint growth_recovery_actions_trigger_type_check;
alter table public.growth_recovery_actions add constraint growth_recovery_actions_trigger_type_check check (trigger_type = any(array['stale_lead'::text,'lost_opportunity'::text,'appointment_no_show'::text,'appointment_cancelled'::text]));
create index if not exists growth_recovery_actions_appointment_fk_idx on public.growth_recovery_actions(appointment_id);

alter table public.marketing_calls add column if not exists pbx_call_id text;
alter table public.marketing_calls add column if not exists recording_external_id text;
alter table public.marketing_calls add column if not exists transcription_status text not null default 'idle';
alter table public.marketing_calls add column if not exists transcription_model text;
alter table public.marketing_calls add column if not exists transcribed_at timestamptz;
alter table public.marketing_calls add column if not exists transcription_error text;
alter table public.marketing_calls drop constraint if exists marketing_calls_transcription_status_check;
alter table public.marketing_calls add constraint marketing_calls_transcription_status_check check (transcription_status = any(array['idle'::text,'pending'::text,'processing'::text,'completed'::text,'failed'::text]));
create index if not exists marketing_calls_company_pbx_call_idx on public.marketing_calls(company_id,pbx_call_id) where pbx_call_id is not null;
create index if not exists marketing_calls_company_transcription_idx on public.marketing_calls(company_id,transcription_status,started_at desc);