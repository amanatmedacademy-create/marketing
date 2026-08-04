create database if not exists analytics;

create table if not exists analytics.metrics_daily (
  agency_id UUID,
  client_id UUID,
  data_source_id UUID,
  integration LowCardinality(String),
  entity_type LowCardinality(String),
  entity_id String,
  entity_name String,
  date Date,
  metric_key LowCardinality(String),
  value Float64,
  version UInt64,
  ingested_at DateTime64(3) default now64(3)
)
engine = ReplacingMergeTree(version)
partition by toYYYYMM(date)
order by (agency_id, client_id, data_source_id, integration, entity_type, entity_id, date, metric_key)
ttl date + interval 5 year;

create table if not exists analytics.metrics_daily_rollup (
  agency_id UUID,
  client_id UUID,
  date Date,
  metric_key LowCardinality(String),
  value AggregateFunction(sum, Float64)
)
engine = AggregatingMergeTree
partition by toYYYYMM(date)
order by (agency_id, client_id, date, metric_key);

create materialized view if not exists analytics.metrics_daily_rollup_mv
to analytics.metrics_daily_rollup as
select agency_id, client_id, date, metric_key, sumState(value) as value
from analytics.metrics_daily
group by agency_id, client_id, date, metric_key;
