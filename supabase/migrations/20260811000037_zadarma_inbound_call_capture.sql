alter table public.marketing_calls
  add column if not exists call_direction text,
  add column if not exists called_did text,
  add column if not exists answered_at timestamptz;

do $$ begin
  alter table public.marketing_calls
    add constraint marketing_calls_direction_check
    check (call_direction is null or call_direction in ('INBOUND','OUTBOUND'));
exception when duplicate_object then null; end $$;

drop index if exists public.marketing_calls_company_pbx_call_idx;
create unique index if not exists marketing_calls_company_pbx_call_uidx
  on public.marketing_calls(company_id,pbx_call_id)
  where pbx_call_id is not null;

alter table public.crm_tasks
  add column if not exists source text,
  add column if not exists external_key text;

create unique index if not exists crm_tasks_company_external_key_uidx
  on public.crm_tasks(company_id,external_key)
  where external_key is not null;

alter table public.telephony_settings
  add column if not exists inbound_capture_enabled boolean not null default true,
  add column if not exists missed_call_tasks_enabled boolean not null default true,
  add column if not exists missed_call_task_delay_minutes integer not null default 0;

do $$ begin
  alter table public.telephony_settings
    add constraint telephony_settings_missed_call_delay_check
    check (missed_call_task_delay_minutes between 0 and 1440);
exception when duplicate_object then null; end $$;
