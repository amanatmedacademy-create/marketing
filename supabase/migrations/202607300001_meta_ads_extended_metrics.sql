alter table public.marketing_ads
  add column if not exists objective text,
  add column if not exists result_indicator text,
  add column if not exists results numeric(16,4) not null default 0,
  add column if not exists result_rate numeric(12,6) not null default 0,
  add column if not exists cost_per_result numeric(16,4) not null default 0,
  add column if not exists adset_budget numeric(16,4)