-- Google Ads / GA4 data, executable journey automation and assistant-ready operational state.

alter table public.integration_credentials
  drop constraint if exists integration_credentials_provider_check;

alter table public.integration_credentials
  add constraint integration_credentials_provider_check
  check (provider in ('bitrix', 'meta', 'tiktok', 'n8n', 'waba', 'google_ads', 'ga4'));

create table if not exists public.marketing_web_analytics (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default private.resolve_single_company_id(),
  report_date date not null,
  source text not null default '(direct)',
  medium text not null default '(none)',
  campaign text not null default '(not set)',
  users integer not null default 0,
  sessions integer not null default 0,
  key_events numeric(16,2) not null default 0,
  revenue numeric(16,2) not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, report_date, source, medium, campaign)
);

create index if not exists marketing_web_analytics_date_idx
  on public.marketing_web_analytics (company_id, report_date desc);
create index if not exists marketing_web_analytics_source_idx
  on public.marketing_web_analytics (company_id, source, medium);

alter table public.marketing_web_analytics enable row level security;
revoke all on public.marketing_web_analytics from anon, authenticated;
grant all on public.marketing_web_analytics to service_role;

alter table public.marketing_automations
  add column if not exists trigger_type text,
  add column if not exists trigger_config jsonb not null default '{}'::jsonb,
  add column if not exists actions jsonb not null default '[]'::jsonb,
  add column if not exists last_error text,
  add column if not exists run_count integer not null default 0,
  add column if not exists last_checked_at timestamptz;

create table if not exists public.marketing_automation_runs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default private.resolve_single_company_id(),
  rule_id uuid not null references public.marketing_automations(id) on delete cascade,
  event_key text not null,
  subject_type text not null default 'lead',
  subject_id uuid,
  status text not null default 'running' check (status in ('running','success','failed','skipped')),
  action_results jsonb not null default '[]'::jsonb,
  error text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  unique (rule_id, event_key)
);

create index if not exists marketing_automation_runs_rule_idx
  on public.marketing_automation_runs (company_id, rule_id, started_at desc);
create index if not exists marketing_automation_runs_status_idx
  on public.marketing_automation_runs (company_id, status, started_at desc);

alter table public.marketing_automation_runs enable row level security;
revoke all on public.marketing_automation_runs from anon, authenticated;
grant all on public.marketing_automation_runs to service_role;

notify pgrst, 'reload schema';
