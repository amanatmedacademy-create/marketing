create table if not exists public.marketing_meta_adset_metrics (
  id uuid primary key default gen_random_uuid(),
  report_date date not null,
  account_id text not null,
  account_name text,
  campaign_id text,
  campaign_name text,
  adset_id text not null,
  adset_name text,
  status text,
  objective text,
  performance_goal text,
  result_indicator text,
  results numeric(16,4) not null default 0,
  result_rate numeric(12,6) not null default 0,
  cost_per_result numeric(16,4) not null default 0,
  spend numeric(16,4) not null default 0,
  adset_budget numeric(16,4),
  budget_type text,
  reach bigint not null default 0,
  impressions bigint not null default 0,
  views bigint not null default 0,
  frequency numeric(16,6) not null default 0,
  cpm numeric(16,4) not null default 0,
  clicks bigint not null default 0,
  unique_clicks bigint not null default 0,
  ctr numeric(12,6) not null default 0,
  unique_ctr numeric(12,6) not null default 0,
  cpc numeric(16,4) not null default 0,
  link_clicks bigint not null default 0,
  unique_link_clicks bigint not null default 0,
  unique_link_ctr numeric(12,6) not null default 0,
  link_cpc numeric(16,4) not null default 0,
  app_landing_page_views bigint not null default 0,
  website_landing_page_views bigint not null default 0,
  landing_page_views bigint not null default 0,
  landing_page_view_cost numeric(16,4) not null default 0,
  landing_page_view_ratio numeric(12,6) not null default 0,
  messaging_welcome_views bigint not null default 0,
  engagement_cost numeric(16,4) not null default 0,
  instagram_profile_visits bigint not null default 0,
  instagram_follows bigint not null default 0,
  post_comments bigint not null default 0,
  post_shares bigint not null default 0,
  post_saves bigint not null default 0,
  messaging_conversations_started bigint not null default 0,
  messaging_replies_7d bigint not null default 0,
  messaging_conversation_cost numeric(16,4) not null default 0,
  video_3s_plays bigint not null default 0,
  video_3s_cost numeric(16,4) not null default 0,
  video_3s_rate numeric(12,6) not null default 0,
  video_avg_time numeric(16,4) not null default 0,
  video_p25 bigint not null default 0,
  video_p50 bigint not null default 0,
  video_p75 bigint not null default 0,
  video_p95 bigint not null default 0,
  custom_audiences jsonb not null default '[]'::jsonb,
  excluded_custom_audiences jsonb not null default '[]'::jsonb,
  adset_created_at timestamptz,
  adset_updated_at timestamptz,
  initial_results numeric(16,4) not null default 0,
  initial_result_indicator text,
  raw jsonb not null default '{}'::jsonb,
  synced_at timestamptz not null default now(),
  unique (account_id, adset_id, report_date)
);

create index if not exists marketing_meta_adset_metrics_date_idx
  on public.marketing_meta_adset_metrics (report_date desc);
create index if not exists marketing_meta_adset_metrics_account_idx
  on public.marketing_meta_adset_metrics (account_id);
create index if not exists marketing_meta_adset_metrics_campaign_idx
  on public.marketing_meta_adset_metrics (campaign_id);
create index if not exists marketing_meta_adset_metrics_adset_idx
  on public.marketing_meta_adset_metrics (adset_id);

alter table public.marketing_meta_adset_metrics enable row level security;
revoke all on public.marketing_meta_adset_metrics from anon, authenticated;
grant all on public.marketing_meta_adset_metrics to service_role;