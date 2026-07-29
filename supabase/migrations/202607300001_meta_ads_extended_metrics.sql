alter table public.marketing_ads
  add column if not exists objective text,
  add column if not exists result_indicator text,
  add column if not exists results numeric(16,4) not null default 0,
  add column if not exists result_rate numeric(12,6) not null default 0,
  add column if not exists cost_per_result numeric(16,4) not null default 0,
  add column if not exists adset_budget numeric(16,4),
  add column if not exists budget_type text,
  add column if not exists reach bigint not null default 0,
  add column if not exists views bigint not null default 0,
  add column if not exists unique_clicks bigint not null default 0,
  add column if not exists link_clicks bigint not null default 0,
  add column if not exists unique_link_clicks bigint not null default 0,
  add column if not exists landing_page_views bigint not null default 0,
  add column if not exists app_landing_page_views bigint not null default 0,
  add column if not exists website_landing_page_views bigint not null default 0,
  add column if not exists messaging_welcome_views bigint not null default 0,
  add column if not exists messaging_conversations_started bigint not null default 0,
  add column if not exists messaging_replies_7d bigint not null default 0,
  add column if not exists instagram_profile_visits bigint not null default 0,
  add column if not exists instagram_follows bigint not null default 0,
  add column if not exists post_comments bigint not null default 0,
  add column if not exists post_shares bigint not null default 0,
  add column if not exists post_saves bigint not null default 0,
  add column if not exists video_3s_plays bigint not null default 0,
  add column if not exists video_avg_time numeric(16,4) not null default 0,
  add column if not exists video_p25 bigint not null default 0,
  add column if not exists video_p50 bigint not null default 0,
  add column if not exists video_p75 bigint not null default 0,
  add column if not exists video_p95 bigint not null default 0,
  add column if not exists performance_goal text,
  add column if not exists custom_audiences jsonb not null default '[]'::jsonb,
  add column if not exists excluded_custom_audiences jsonb not null default '[]'::jsonb,
  add column if not exists adset_created_at timestamptz,
  add column if not exists adset_updated_at timestamptz,
  add column if not exists initial_results numeric(16,4) not null default 0,
  add column if not exists initial_result_indicator text;

create index if not exists marketing_ads_account_campaign_adset_idx
  on public.marketing_ads (account_id, campaign_id, adset_id);

create index if not exists marketing_ads_status_idx
  on public.marketing_ads (status);

comment on column public.marketing_ads.spend is 'Advertising spend in source account currency; Meta values are normally USD.';
comment on column public.marketing_ads.revenue is 'CRM revenue in KZT.';
comment on column public.marketing_ads.metadata is 'Raw provider payload and unsupported provider-specific metrics.';