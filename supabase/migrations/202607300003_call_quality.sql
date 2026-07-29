create extension if not exists pgcrypto;

create table if not exists public.marketing_calls (
  id uuid primary key default gen_random_uuid(),
  external_id text,
  lead_id uuid references public.marketing_leads(id) on delete set null,
  deal_external_id text,
  operator_name text,
  client_phone text,
  source text,
  campaign_id text,
  ad_id text,
  started_at timestamptz not null,
  duration_seconds integer not null default 0 check (duration_seconds >= 0),
  recording_url text,
  transcript text,
  summary text,
  request_reason text,
  patient_pain text,
  objections text[] not null default '{}',
  call_result text,
  appointment_created boolean not null default false,
  appointment_at timestamptz,
  next_action text,
  loss_reason text,
  quality_score numeric(5,2) check (quality_score between 0 and 100),
  detected_pain boolean,
  asked_questions boolean,
  presented_value boolean,
  handled_objection boolean,
  offered_specific_time boolean,
  confirmed_appointment boolean,
  stated_next_step boolean,
  follow_up_planned boolean,
  script_violations text[] not null default '{}',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists marketing_calls_external_id_uidx
  on public.marketing_calls (external_id);
create index if not exists marketing_calls_started_at_idx
  on public.marketing_calls (started_at desc);
create index if not exists marketing_calls_operator_idx
  on public.marketing_calls (operator_name, started_at desc);
create index if not exists marketing_calls_lead_idx
  on public.marketing_calls (lead_id);
create index if not exists marketing_calls_result_idx
  on public.marketing_calls (appointment_created, loss_reason);

create or replace function public.set_marketing_calls_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists marketing_calls_set_updated_at on public.marketing_calls;
create trigger marketing_calls_set_updated_at
before update on public.marketing_calls
for each row execute function public.set_marketing_calls_updated_at();

create or replace view public.marketing_call_operator_summary
with (security_invoker = true)
as
select
  coalesce(operator_name, 'Не назначен') as operator_name,
  count(*)::integer as calls,
  count(*) filter (where appointment_created)::integer as appointments,
  round(avg(quality_score), 1) as average_quality_score,
  count(*) filter (where next_action is null or btrim(next_action) = '')::integer as calls_without_next_action,
  count(*) filter (where loss_reason is not null and btrim(loss_reason) <> '')::integer as lost_calls
from public.marketing_calls
group by coalesce(operator_name, 'Не назначен');

alter table public.marketing_calls enable row level security;
revoke all on public.marketing_calls from anon, authenticated;
revoke all on public.marketing_call_operator_summary from anon, authenticated;
grant all on public.marketing_calls to service_role;
grant select on public.marketing_call_operator_summary to service_role;

notify pgrst, 'reload schema';
