create extension if not exists pgcrypto;

create table if not exists public.marketing_leads (
  id uuid primary key default gen_random_uuid(),
  external_id text,
  name text not null default 'Без имени',
  phone text not null default '',
  email text,
  source text,
  platform text,
  campaign text,
  manager text,
  stage text not null default 'Новый',
  next_action text,
  first_message text,
  direction text,
  city text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_content text,
  utm_term text,
  campaign_id text,
  adset_id text,
  ad_id text,
  internal_client_id text,
  fbclid text,
  gclid text,
  ttclid text,
  yclid text,
  vk_click_id text,
  landing_url text,
  referrer text,
  lead_created_at timestamptz not null default now(),
  first_contact_at timestamptz,
  qualified_at timestamptz,
  appointment_at timestamptz,
  arrived_at timestamptz,
  deal_created_at timestamptz,
  rejected_at timestamptz,
  deal_rejected_at timestamptz,
  sold_at timestamptz,
  is_target boolean not null default false,
  sale_amount numeric(16,2) not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.marketing_leads
  add column if not exists external_id text,
  add column if not exists name text not null default 'Без имени',
  add column if not exists phone text not null default '',
  add column if not exists email text,
  add column if not exists source text,
  add column if not exists platform text,
  add column if not exists campaign text,
  add column if not exists manager text,
  add column if not exists stage text not null default 'Новый',
  add column if not exists next_action text,
  add column if not exists first_message text,
  add column if not exists direction text,
  add column if not exists city text,
  add column if not exists utm_source text,
  add column if not exists utm_medium text,
  add column if not exists utm_campaign text,
  add column if not exists utm_content text,
  add column if not exists utm_term text,
  add column if not exists campaign_id text,
  add column if not exists adset_id text,
  add column if not exists ad_id text,
  add column if not exists internal_client_id text,
  add column if not exists fbclid text,
  add column if not exists gclid text,
  add column if not exists ttclid text,
  add column if not exists yclid text,
  add column if not exists vk_click_id text,
  add column if not exists landing_url text,
  add column if not exists referrer text,
  add column if not exists lead_created_at timestamptz not null default now(),
  add column if not exists first_contact_at timestamptz,
  add column if not exists qualified_at timestamptz,
  add column if not exists appointment_at timestamptz,
  add column if not exists arrived_at timestamptz,
  add column if not exists deal_created_at timestamptz,
  add column if not exists rejected_at timestamptz,
  add column if not exists deal_rejected_at timestamptz,
  add column if not exists sold_at timestamptz,
  add column if not exists is_target boolean not null default false,
  add column if not exists sale_amount numeric(16,2) not null default 0,
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create unique index if not exists marketing_leads_external_id_uidx on public.marketing_leads (external_id) where external_id is not null;
create index if not exists marketing_leads_phone_idx on public.marketing_leads (phone);
create index if not exists marketing_leads_stage_idx on public.marketing_leads (stage);
create index if not exists marketing_leads_source_idx on public.marketing_leads (source);
create index if not exists marketing_leads_platform_idx on public.marketing_leads (platform);
create index if not exists marketing_leads_created_at_idx on public.marketing_leads (created_at desc);
create index if not exists marketing_leads_lead_created_at_idx on public.marketing_leads (lead_created_at desc);
create index if not exists marketing_leads_campaign_idx on public.marketing_leads (campaign_id, adset_id, ad_id);
create index if not exists marketing_leads_internal_client_id_idx on public.marketing_leads (internal_client_id);

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
  crm_synced_at timestamptz,
  ads_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (date, source, platform)
);

alter table public.marketing_daily_metrics
  add column if not exists crm_synced_at timestamptz,
  add column if not exists ads_synced_at timestamptz,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create unique index if not exists marketing_daily_metrics_date_source_platform_uidx on public.marketing_daily_metrics (date, source, platform);
create index if not exists marketing_daily_metrics_date_idx on public.marketing_daily_metrics (date desc);

create table if not exists public.marketing_ads (
  id uuid primary key default gen_random_uuid(),
  external_id text,
  report_date date not null default current_date,
  source text,
  platform text not null,
  account_id text,
  account_name text,
  campaign_id text,
  campaign_name text not null default 'Без кампании',
  adset_id text,
  adset_name text,
  ad_id text,
  creative_name text,
  creative_type text,
  status text,
  impressions bigint not null default 0,
  reach bigint not null default 0,
  clicks bigint not null default 0,
  link_clicks bigint not null default 0,
  landing_page_views bigint not null default 0,
  video_views bigint not null default 0,
  spend numeric(16,2) not null default 0,
  leads integer not null default 0,
  target_leads integer not null default 0,
  arrived integer not null default 0,
  sales integer not null default 0,
  conversions integer not null default 0,
  revenue numeric(16,2) not null default 0,
  currency text not null default 'KZT',
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_content text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.marketing_ads
  add column if not exists source text,
  add column if not exists reach bigint not null default 0,
  add column if not exists link_clicks bigint not null default 0,
  add column if not exists landing_page_views bigint not null default 0,
  add column if not exists video_views bigint not null default 0,
  add column if not exists conversions integer not null default 0,
  add column if not exists currency text not null default 'KZT',
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

drop index if exists public.marketing_ads_external_date_uidx;
create unique index marketing_ads_external_date_uidx on public.marketing_ads (external_id, report_date);
create index if not exists marketing_ads_report_date_idx on public.marketing_ads (report_date desc);
create index if not exists marketing_ads_platform_idx on public.marketing_ads (platform);
create index if not exists marketing_ads_campaign_idx on public.marketing_ads (campaign_id, adset_id, ad_id);

create table if not exists public.marketing_scoring_settings (
  id text primary key default 'default',
  min_days integer not null default 4,
  min_leads integer not null default 10,
  scale_roas numeric(10,2) not null default 3.5,
  grow_roas numeric(10,2) not null default 2.0,
  observe_roas numeric(10,2) not null default 1.5,
  scale_target_rate numeric(10,2) not null default 55,
  grow_target_rate numeric(10,2) not null default 45,
  pause_target_rate numeric(10,2) not null default 35,
  frequency_alert numeric(10,2) not null default 4.0,
  unattributed_alert numeric(10,2) not null default 5.0,
  client_cookie_days integer not null default 365,
  click_id_days integer not null default 28,
  attribution_model text not null default 'last_click',
  updated_at timestamptz not null default now()
);

insert into public.marketing_scoring_settings (id) values ('default') on conflict (id) do nothing;

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
create trigger marketing_leads_set_updated_at before update on public.marketing_leads for each row execute function public.set_updated_at();

drop trigger if exists marketing_daily_metrics_set_updated_at on public.marketing_daily_metrics;
create trigger marketing_daily_metrics_set_updated_at before update on public.marketing_daily_metrics for each row execute function public.set_updated_at();

drop trigger if exists marketing_ads_set_updated_at on public.marketing_ads;
create trigger marketing_ads_set_updated_at before update on public.marketing_ads for each row execute function public.set_updated_at();

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

create or replace view public.marketing_ads_summary as
select
  coalesce(ad_id, external_id, id::text) as row_key,
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
  sum(reach)::bigint as reach,
  sum(clicks)::bigint as clicks,
  sum(link_clicks)::bigint as link_clicks,
  sum(spend)::numeric(16,2) as spend,
  sum(leads)::integer as leads,
  sum(target_leads)::integer as target_leads,
  sum(arrived)::integer as arrived,
  sum(sales)::integer as sales,
  sum(revenue)::numeric(16,2) as revenue,
  min(report_date) as date_from,
  max(report_date) as date_to
from public.marketing_ads
group by coalesce(ad_id, external_id, id::text), platform, account_id, campaign_id, adset_id, ad_id;

create or replace view public.analytics_attribution_health as
select
  count(*)::integer as total_leads,
  count(*) filter (where coalesce(utm_source, campaign_id, ad_id, fbclid, gclid, ttclid, yclid, vk_click_id, internal_client_id) is null)::integer as unattributed_leads,
  case when count(*) = 0 then 0 else round(
    count(*) filter (where coalesce(utm_source, campaign_id, ad_id, fbclid, gclid, ttclid, yclid, vk_click_id, internal_client_id) is null)::numeric * 100 / count(*),
    2
  ) end as unattributed_rate
from public.marketing_leads;

alter table public.marketing_leads enable row level security;
alter table public.marketing_daily_metrics enable row level security;
alter table public.marketing_ads enable row level security;
alter table public.marketing_scoring_settings enable row level security;

revoke all on public.marketing_leads from anon, authenticated;
revoke all on public.marketing_daily_metrics from anon, authenticated;
revoke all on public.marketing_ads from anon, authenticated;
revoke all on public.marketing_scoring_settings from anon, authenticated;
revoke all on public.marketing_dashboard_daily from anon, authenticated;
revoke all on public.marketing_source_summary from anon, authenticated;
revoke all on public.marketing_ads_summary from anon, authenticated;
revoke all on public.analytics_attribution_health from anon, authenticated;

grant all on public.marketing_leads to service_role;
grant all on public.marketing_daily_metrics to service_role;
grant all on public.marketing_ads to service_role;
grant all on public.marketing_scoring_settings to service_role;
grant select on public.marketing_dashboard_daily to service_role;
grant select on public.marketing_source_summary to service_role;
grant select on public.marketing_ads_summary to service_role;
grant select on public.analytics_attribution_health to service_role;

notify pgrst, 'reload schema';
