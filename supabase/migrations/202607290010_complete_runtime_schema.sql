create extension if not exists pgcrypto;

create table if not exists public.integration_events (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  event_key text not null,
  event_type text not null default 'unknown',
  status text not null default 'received',
  payload jsonb not null default '{}'::jsonb,
  error text,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  unique (source, event_key)
);

create table if not exists public.integration_runs (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  status text not null default 'running',
  date_from date,
  date_to date,
  fetched integer not null default 0,
  written integer not null default 0,
  error text,
  metadata jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

create table if not exists public.integration_credentials (
  provider text primary key check (provider in ('bitrix','meta','tiktok','n8n')),
  encrypted_payload text not null,
  iv text not null,
  config_summary jsonb not null default '{}'::jsonb,
  status text not null default 'configured',
  last_error text,
  last_verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.marketing_daily_metrics add column if not exists crm_synced_at timestamptz;
alter table public.marketing_daily_metrics add column if not exists ads_synced_at timestamptz;

create unique index if not exists marketing_daily_metrics_date_source_platform_uidx
  on public.marketing_daily_metrics (date, source, platform);
create index if not exists integration_events_source_idx
  on public.integration_events (source, received_at desc);
create index if not exists integration_runs_source_idx
  on public.integration_runs (source, started_at desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists integration_credentials_set_updated_at on public.integration_credentials;
create trigger integration_credentials_set_updated_at
before update on public.integration_credentials
for each row execute function public.set_updated_at();

alter table public.integration_events enable row level security;
alter table public.integration_runs enable row level security;
alter table public.integration_credentials enable row level security;

revoke all on public.integration_events from anon, authenticated;
revoke all on public.integration_runs from anon, authenticated;
revoke all on public.integration_credentials from anon, authenticated;

grant all on public.integration_events to service_role;
grant all on public.integration_runs to service_role;
grant all on public.integration_credentials to service_role;

-- Supabase-managed databases may expose this helper, while a clean PostgreSQL
-- installation does not. Revoke it only when it is actually present.
do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    execute 'revoke execute on function public.rls_auto_enable() from public, anon, authenticated';
  end if;
end;
$$;

notify pgrst, 'reload schema';
