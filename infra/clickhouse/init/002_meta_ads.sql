create table if not exists analytics.meta_ads_insights_daily (
  agency_id UUID,
  client_id UUID,
  data_source_id UUID,
  ad_account_id String,
  campaign_id String,
  campaign_name String,
  adset_id String,
  adset_name String,
  ad_id String,
  ad_name String,
  insight_date Date,
  currency LowCardinality(String),
  spend Float64,
  impressions UInt64,
  reach UInt64,
  clicks UInt64,
  inline_link_clicks UInt64,
  leads Float64,
  purchases Float64,
  purchase_value Float64,
  raw String,
  version UInt64,
  synced_at DateTime64(3)
)
engine = ReplacingMergeTree(version)
partition by toYYYYMM(insight_date)
order by (agency_id,client_id,data_source_id,ad_account_id,insight_date,campaign_id,adset_id,ad_id);

create materialized view if not exists analytics.meta_ads_to_metrics_daily_mv
to analytics.metrics_daily as
select
  agency_id,
  client_id,
  data_source_id,
  'meta-ads' as integration,
  'ad' as entity_type,
  ad_id as entity_id,
  ad_name as entity_name,
  insight_date as date,
  metric.1 as metric_key,
  metric.2 as value,
  version,
  synced_at as ingested_at
from analytics.meta_ads_insights_daily
array join [
  ('spend',toFloat64(spend)),
  ('impressions',toFloat64(impressions)),
  ('reach',toFloat64(reach)),
  ('clicks',toFloat64(clicks)),
  ('inline_link_clicks',toFloat64(inline_link_clicks)),
  ('leads',toFloat64(leads)),
  ('purchases',toFloat64(purchases)),
  ('purchase_value',toFloat64(purchase_value))
] as metric;
