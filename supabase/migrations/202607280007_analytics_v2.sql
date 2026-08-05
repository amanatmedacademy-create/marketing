create extension if not exists pgcrypto;

alter table public.marketing_ads
  add column if not exists reach bigint not null default 0,
  add column if not exists link_clicks bigint not null default 0,
  add column if not exists landing_page_views bigint not null default 0,
  add column if not exists video_views bigint not null default 0,
  add column if not exists conversions integer not null default 0,
  add column if not exists currency text not null default 'KZT';

alter table public.marketing_leads
  add column if not exists direction text,
  add column if not exists city text,
  add column if not exists internal_client_id text,
  add column if not exists fbclid text,
  add column if not exists gclid text,
  add column if not exists ttclid text,
  add column if not exists yclid text,
  add column if not exists vk_click_id text,
  add column if not exists landing_url text,
  add column if not exists referrer text,
  add column if not exists first_contact_at timestamptz,
  add column if not exists qualified_at timestamptz,
  add column if not exists rejected_at timestamptz,
  add column if not exists deal_created_at timestamptz,
  add column if not exists deal_rejected_at timestamptz;

create index if not exists marketing_leads_internal_client_id_idx on public.marketing_leads (internal_client_id);
create index if not exists marketing_leads_click_ids_idx on public.marketing_leads (fbclid, gclid, ttclid, yclid, vk_click_id);
create index if not exists marketing_leads_direction_idx on public.marketing_leads (direction);
create index if not exists marketing_leads_appointment_at_idx on public.marketing_leads (appointment_at);

create table if not exists public.marketing_attribution_events (
  id uuid primary key default gen_random_uuid(),
  external_id text,
  event_type text not null check (event_type in ('page_view','click','lead','qualified','appointment','arrival','deal','sale','refund')),
  event_at timestamptz not null default now(),
  internal_client_id text,
  lead_external_id text,
  deal_external_id text,
  phone_hash text,
  email_hash text,
  source text,
  platform text,
  direction text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_content text,
  utm_term text,
  campaign_id text,
  adset_id text,
  ad_id text,
  fbclid text,
  gclid text,
  ttclid text,
  yclid text,
  vk_click_id text,
  landing_url text,
  referrer text,
  revenue numeric(16,2) not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create unique index if not exists marketing_attribution_events_external_uidx
  on public.marketing_attribution_events (external_id)
  where external_id is not null;
create index if not exists marketing_attribution_events_time_idx on public.marketing_attribution_events (event_at desc);
create index if not exists marketing_attribution_events_client_idx on public.marketing_attribution_events (internal_client_id, event_at desc);
create index if not exists marketing_attribution_events_lead_idx on public.marketing_attribution_events (lead_external_id, event_at desc);
create index if not exists marketing_attribution_events_campaign_idx on public.marketing_attribution_events (campaign_id, adset_id, ad_id);

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
  attribution_model text not null default 'last_click' check (attribution_model in ('first_click','last_click')),
  updated_at timestamptz not null default now()
);

insert into public.marketing_scoring_settings (id)
values ('default')
on conflict (id) do nothing;

create table if not exists public.marketing_users (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null unique,
  role text not null default 'analyst' check (role in ('administrator','marketer','analyst','viewer')),
  status text not null default 'invited' check (status in ('active','invited','blocked')),
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace view public.analytics_attribution_health as
select
  count(*)::integer as total_leads,
  count(*) filter (where coalesce(utm_source, campaign_id, ad_id, fbclid, gclid, ttclid, yclid, vk_click_id, internal_client_id) is null)::integer as unattributed_leads,
  case when count(*) = 0 then 0 else round(
    count(*) filter (where coalesce(utm_source, campaign_id, ad_id, fbclid, gclid, ttclid, yclid, vk_click_id, internal_client_id) is null)::numeric * 100 / count(*),
    2
  ) end as unattributed_rate
from public.marketing_leads;

create or replace function public.set_marketing_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists marketing_scoring_settings_updated_at on public.marketing_scoring_settings;
create trigger marketing_scoring_settings_updated_at
before update on public.marketing_scoring_settings
for each row execute function public.set_marketing_updated_at();

drop trigger if exists marketing_users_updated_at on public.marketing_users;
create trigger marketing_users_updated_at
before update on public.marketing_users
for each row execute function public.set_marketing_updated_at();

alter table public.marketing_attribution_events enable row level security;
alter table public.marketing_scoring_settings enable row level security;
alter table public.marketing_users enable row level security;

revoke all on public.marketing_attribution_events from anon, authenticated;
revoke all on public.marketing_scoring_settings from anon, authenticated;
revoke all on public.marketing_users from anon, authenticated;
revoke all on public.analytics_attribution_health from anon, authenticated;

grant all on public.marketing_attribution_events to service_role;
grant all on public.marketing_scoring_settings to service_role;
grant all on public.marketing_users to service_role;
grant select on public.analytics_attribution_health to service_role;

notify pgrst, 'reload schema';
