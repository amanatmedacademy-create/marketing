create table public.telephony_settings (
  company_id uuid primary key references public.crm_companies(id) on delete cascade,
  provider text not null default 'zadarma' check (provider = 'zadarma'),
  auto_transcribe boolean not null default false,
  auto_analyze boolean not null default false,
  transcription_model text not null default 'gpt-4o-mini-transcribe',
  recording_delay_seconds integer not null default 45 check (recording_delay_seconds between 0 and 600),
  max_attempts integer not null default 3 check (max_attempts between 1 and 10),
  retry_after_minutes integer not null default 15 check (retry_after_minutes between 1 and 1440),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.telephony_settings enable row level security;
revoke all on table public.telephony_settings from anon, authenticated;
grant select, insert, update, delete on table public.telephony_settings to service_role;

insert into public.telephony_settings (company_id)
select id from public.crm_companies
on conflict (company_id) do nothing;

alter table public.marketing_calls
  add column recording_ready_at timestamptz,
  add column transcription_attempts integer not null default 0 check (transcription_attempts >= 0),
  add column last_transcription_attempt_at timestamptz;

create index marketing_calls_auto_transcription_idx
  on public.marketing_calls(company_id, transcription_status, recording_ready_at)
  where call_status = 'COMPLETED' and recording_external_id is not null;

update public.marketing_calls
set recording_ready_at = coalesce(transcribed_at, updated_at, started_at, now())
where recording_ready_at is null
  and (recording_external_id is not null or recording_url is not null);