create table if not exists public.marketing_clients (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.crm_companies(id) on delete cascade,
  name text not null,
  slug text not null,
  status text not null default 'active' check (status in ('active', 'archived')),
  currency text not null default 'KZT',
  timezone text not null default 'Asia/Almaty',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, slug)
);

create table if not exists public.marketing_data_connections (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.crm_companies(id) on delete cascade,
  client_id uuid references public.marketing_clients(id) on delete cascade,
  provider text not null,
  external_account_id text,
  external_account_name text,
  status text not null default 'pending' check (status in ('pending', 'connected', 'error', 'disabled')),
  currency text,
  timezone text,
  metadata jsonb not null default '{}'::jsonb,
  last_synced_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, provider, external_account_id)
);

create table if not exists public.marketing_sync_runs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.crm_companies(id) on delete cascade,
  client_id uuid references public.marketing_clients(id) on delete cascade,
  connection_id uuid references public.marketing_data_connections(id) on delete set null,
  provider text not null,
  sync_type text not null default 'incremental' check (sync_type in ('incremental', 'backfill', 'manual')),
  status text not null default 'queued' check (status in ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  period_start date,
  period_end date,
  rows_received integer not null default 0,
  rows_written integer not null default 0,
  error_code text,
  error_message text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.marketing_raw_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.crm_companies(id) on delete cascade,
  client_id uuid references public.marketing_clients(id) on delete cascade,
  connection_id uuid references public.marketing_data_connections(id) on delete set null,
  sync_run_id uuid references public.marketing_sync_runs(id) on delete set null,
  provider text not null,
  entity_type text not null,
  external_id text,
  event_date date,
  payload jsonb not null,
  payload_hash text not null,
  received_at timestamptz not null default now(),
  unique (company_id, provider, entity_type, payload_hash)
);

create table if not exists public.marketing_ad_performance_daily (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.crm_companies(id) on delete cascade,
  client_id uuid references public.marketing_clients(id) on delete cascade,
  provider text not null,
  metric_date date not null,
  account_external_id text not null,
  account_name text,
  campaign_external_id text not null default '',
  campaign_name text,
  campaign_status text,
  ad_group_external_id text not null default '',
  ad_group_name text,
  ad_external_id text not null default '',
  ad_name text,
  currency text not null default 'KZT',
  spend numeric(18,2) not null default 0,
  impressions bigint not null default 0,
  reach bigint not null default 0,
  clicks bigint not null default 0,
  link_clicks bigint not null default 0,
  landing_page_views bigint not null default 0,
  video_views bigint not null default 0,
  leads numeric(18,2) not null default 0,
  qualified_leads numeric(18,2) not null default 0,
  arrived numeric(18,2) not null default 0,
  sales numeric(18,2) not null default 0,
  revenue numeric(18,2) not null default 0,
  purchases numeric(18,2) not null default 0,
  purchase_value numeric(18,2) not null default 0,
  raw jsonb not null default '{}'::jsonb,
  synced_at timestamptz not null default now(),
  unique (
    company_id,
    provider,
    account_external_id,
    metric_date,
    campaign_external_id,
    ad_group_external_id,
    ad_external_id
  )
);

create index if not exists marketing_clients_company_idx
  on public.marketing_clients (company_id, status, created_at desc);
create index if not exists marketing_connections_company_provider_idx
  on public.marketing_data_connections (company_id, provider, status);
create index if not exists marketing_sync_runs_company_created_idx
  on public.marketing_sync_runs (company_id, created_at desc);
create index if not exists marketing_raw_events_company_date_idx
  on public.marketing_raw_events (company_id, provider, event_date desc);
create index if not exists marketing_performance_company_date_idx
  on public.marketing_ad_performance_daily (company_id, metric_date desc);
create index if not exists marketing_performance_client_date_idx
  on public.marketing_ad_performance_daily (company_id, client_id, metric_date desc);
create index if not exists marketing_performance_campaign_idx
  on public.marketing_ad_performance_daily (company_id, provider, campaign_external_id, metric_date desc);

alter table public.marketing_clients enable row level security;
alter table public.marketing_data_connections enable row level security;
alter table public.marketing_sync_runs enable row level security;
alter table public.marketing_raw_events enable row level security;
alter table public.marketing_ad_performance_daily enable row level security;

revoke all on public.marketing_clients from anon, authenticated;
revoke all on public.marketing_data_connections from anon, authenticated;
revoke all on public.marketing_sync_runs from anon, authenticated;
revoke all on public.marketing_raw_events from anon, authenticated;
revoke all on public.marketing_ad_performance_daily from anon, authenticated;

grant all on public.marketing_clients to service_role;
grant all on public.marketing_data_connections to service_role;
grant all on public.marketing_sync_runs to service_role;
grant all on public.marketing_raw_events to service_role;
grant all on public.marketing_ad_performance_daily to service_role;

comment on table public.marketing_clients is 'Tenant-scoped clients or brands analyzed inside IMDS Marketing Analytics.';
comment on table public.marketing_data_connections is 'Provider-neutral marketing source connections without exposing OAuth secrets to the browser.';
comment on table public.marketing_sync_runs is 'Auditable connector synchronization runs, retries and backfills.';
comment on table public.marketing_raw_events is 'Immutable raw provider payloads used for replay, reconciliation and debugging.';
comment on table public.marketing_ad_performance_daily is 'Canonical cross-channel daily advertising fact table.';
