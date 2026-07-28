create table if not exists public.marketing_ads (
  id uuid primary key default gen_random_uuid(),
  external_id text,
  report_date date not null default current_date,
  platform text not null,
  account_id text,
  account_name text,
  campaign_id text,
  campaign_name text not null,
  adset_id text,
  adset_name text,
  ad_id text,
  creative_name text,
  creative_type text,
  status text,
  impressions bigint not null default 0,
  clicks bigint not null default 0,
  spend numeric(16,2) not null default 0,
  leads integer not null default 0,
  target_leads integer not null default 0,
  arrived integer not null default 0,
  sales integer not null default 0,
  revenue numeric(16,2) not null default 0,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_content text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists marketing_ads_external_date_uidx
  on public.marketing_ads (external_id, report_date)
  where external_id is not null;

create index if not exists marketing_ads_report_date_idx
  on public.marketing_ads (report_date desc);
create index if not exists marketing_ads_platform_idx
  on public.marketing_ads (platform);
create index if not exists marketing_ads_campaign_idx
  on public.marketing_ads (campaign_name);
create index if not exists marketing_ads_ad_id_idx
  on public.marketing_ads (ad_id);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists marketing_ads_set_updated_at on public.marketing_ads;
create trigger marketing_ads_set_updated_at
before update on public.marketing_ads
for each row execute function public.set_updated_at();

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

alter table public.marketing_ads enable row level security;
revoke all on public.marketing_ads from anon, authenticated;
revoke all on public.marketing_ads_summary from anon, authenticated;
grant all on public.marketing_ads to service_role;
grant select on public.marketing_ads_summary to service_role;
