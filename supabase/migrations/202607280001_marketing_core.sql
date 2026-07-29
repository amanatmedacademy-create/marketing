create extension if not exists pgcrypto;

create table if not exists public.marketing_leads (
  id uuid primary key default gen_random_uuid(),
  external_id text,
  name text not null,
  phone text not null,
  email text,
  source text,
  campaign text,
  manager text,
  stage text not null default 'Новый',
  next_action text,
  first_message text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_content text,
  utm_term text,
  fbclid text,
  ttclid text,
  campaign_id text,
  adset_id text,
  ad_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists marketing_leads_external_id_uidx
  on public.marketing_leads (external_id)
  where external_id is not null;

create index if not exists marketing_leads_phone_idx on public.marketing_leads (phone);
create index if not exists marketing_leads_stage_idx on public.marketing_leads (stage);
create index if not exists marketing_leads_source_idx on public.marketing_leads (source);
create index if not exists marketing_leads_created_at_idx on public.marketing_leads (created_at desc);

create table if not exists public.marketing_daily_metrics (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  source text not null default 'Все источники',
  platform text not null default 'Не определено',
  leads integer not null default 0,
  target_leads integer not null default 0,
  arrived integer not null default 0,
  sales integer not null default 0,
  spend numeric(16,2) not null default 0,
  revenue numeric(16,2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (date, source, platform)
);

create index if not exists marketing_daily_metrics_date_idx
  on public.marketing_daily_metrics (date desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists marketing_leads_set_updated_at on public.marketing_leads;
create trigger marketing_leads_set_updated_at
before update on public.marketing_leads
for each row execute function public.set_updated_at();

drop trigger if exists marketing_daily_metrics_set_updated_at on public.marketing_daily_metrics;
create trigger marketing_daily_metrics_set_updated_at
before update on public.marketing_daily_metrics
for each row execute function public.set_updated_at();

create or replace view public.marketing_dashboard_daily as
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

create or replace view public.marketing_source_summary as
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

alter table public.marketing_leads enable row level security;
alter table public.marketing_daily_metrics enable row level security;

revoke all on public.marketing_leads from anon, authenticated;
revoke all on public.marketing_daily_metrics from anon, authenticated;
revoke all on public.marketing_dashboard_daily from anon, authenticated;
revoke all on public.marketing_source_summary from anon, authenticated;

grant all on public.marketing_leads to service_role;
grant all on public.marketing_daily_metrics to service_role;
grant select on public.marketing_dashboard_daily to service_role;
grant select on public.marketing_source_summary to service_role;
