create extension if not exists pgcrypto;

alter table public.marketing_leads
  add column if not exists platform text,
  add column if not exists lead_created_at timestamptz,
  add column if not exists appointment_at timestamptz,
  add column if not exists arrived_at timestamptz,
  add column if not exists sold_at timestamptz,
  add column if not exists is_target boolean not null default false,
  add column if not exists sale_amount numeric(16,2) not null default 0;

update public.marketing_leads
set lead_created_at = coalesce(lead_created_at, created_at)
where lead_created_at is null;

create index if not exists marketing_leads_platform_idx on public.marketing_leads (platform);
create index if not exists marketing_leads_lead_created_at_idx on public.marketing_leads (lead_created_at desc);
create index if not exists marketing_leads_campaign_id_idx on public.marketing_leads (campaign_id);
create index if not exists marketing_leads_adset_id_idx on public.marketing_leads (adset_id);
create index if not exists marketing_leads_ad_id_idx on public.marketing_leads (ad_id);

alter table public.marketing_daily_metrics
  add column if not exists crm_synced_at timestamptz,
  add column if not exists ads_synced_at timestamptz;

alter table public.marketing_ads
  add column if not exists source text;

update public.marketing_ads
set source = coalesce(source, platform)
where source is null;

create table if not exists public.integration_events (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  event_key text not null,
  event_type text,
  status text not null default 'received',
  payload jsonb not null default '{}'::jsonb,
  error text,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  unique (source, event_key)
);

create index if not exists integration_events_source_idx on public.integration_events (source, received_at desc);
create index if not exists integration_events_status_idx on public.integration_events (status, received_at desc);

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

create index if not exists integration_runs_source_idx on public.integration_runs (source, started_at desc);
create index if not exists integration_runs_status_idx on public.integration_runs (status, started_at desc);

-- PostgreSQL does not permit CREATE OR REPLACE VIEW to rename/reorder existing
-- columns. These reporting views are derived objects, so recreate them explicitly.
drop view if exists public.marketing_dashboard_daily cascade;
drop view if exists public.marketing_source_summary cascade;
drop view if exists public.marketing_ads_summary cascade;

create view public.marketing_dashboard_daily as
select
  date,
  sum(leads)::integer as leads,
  sum(target_leads)::integer as target_leads,
  sum(arrived)::integer as arrived,
  sum(sales)::integer as sales,
  sum(spend)::numeric(16,2) as spend,
  sum(revenue)::numeric(16,2) as revenue
from public.marketing_daily_metrics
group by date;

create view public.marketing_source_summary as
select
  source,
  platform,
  sum(leads)::integer as leads,
  sum(target_leads)::integer as target_leads,
  sum(arrived)::integer as arrived,
  sum(sales)::integer as sales,
  sum(spend)::numeric(16,2) as spend,
  sum(revenue)::numeric(16,2) as revenue
from public.marketing_daily_metrics
group by source, platform;

create view public.marketing_ads_summary as
select
  coalesce(ad_id, external_id, id::text) as row_key,
  max(source) as source,
  platform,
  account_id,
  max(account_name) as account_name,
  campaign_id,
  max(campaign_name) as campaign_name,
  adset_id,
  max(adset_name) as adset_name,
  ad_id,
  max(creative_name) as creative_name,
  max(creative_type) as creative_type,
  max(status) as status,
  sum(impressions)::bigint as impressions,
  sum(clicks)::bigint as clicks,
  sum(spend)::numeric(16,2) as spend,
  sum(leads)::integer as leads,
  sum(target_leads)::integer as target_leads,
  sum(arrived)::integer as arrived,
  sum(sales)::integer as sales,
  sum(revenue)::numeric(16,2) as revenue,
  min(report_date) as date_from,
  max(report_date) as date_to
from public.marketing_ads
group by
  coalesce(ad_id, external_id, id::text),
  platform,
  account_id,
  campaign_id,
  adset_id,
  ad_id;

alter table public.integration_events enable row level security;
alter table public.integration_runs enable row level security;

revoke all on public.integration_events from anon, authenticated;
revoke all on public.integration_runs from anon, authenticated;

grant all on public.integration_events to service_role;
grant all on public.integration_runs to service_role;
grant select on public.marketing_dashboard_daily to service_role;
grant select on public.marketing_source_summary to service_role;
grant select on public.marketing_ads_summary to service_role;

notify pgrst, 'reload schema';
