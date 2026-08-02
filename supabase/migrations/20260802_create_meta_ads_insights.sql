create table if not exists public.meta_ads_insights_daily (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.crm_companies(id) on delete cascade,
  ad_account_id text not null,
  campaign_id text,
  campaign_name text,
  adset_id text,
  adset_name text,
  ad_id text,
  ad_name text,
  insight_date date not null,
  currency text,
  spend numeric(18, 2) not null default 0,
  impressions bigint not null default 0,
  reach bigint not null default 0,
  clicks bigint not null default 0,
  inline_link_clicks bigint not null default 0,
  leads numeric(18, 2) not null default 0,
  purchases numeric(18, 2) not null default 0,
  purchase_value numeric(18, 2) not null default 0,
  raw jsonb not null default '{}'::jsonb,
  synced_at timestamptz not null default now(),
  unique (company_id, ad_account_id, insight_date, campaign_id, adset_id, ad_id)
);

create index if not exists meta_ads_insights_company_date_idx
  on public.meta_ads_insights_daily (company_id, insight_date desc);

create index if not exists meta_ads_insights_account_date_idx
  on public.meta_ads_insights_daily (company_id, ad_account_id, insight_date desc);

alter table public.meta_ads_insights_daily enable row level security;
revoke all on public.meta_ads_insights_daily from anon, authenticated;
grant all on public.meta_ads_insights_daily to service_role;

comment on table public.meta_ads_insights_daily is
  'Server-only daily Meta Ads insights synchronized per tenant and advertising entity.';
