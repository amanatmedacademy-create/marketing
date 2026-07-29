-- Repair PostgREST upsert targets used by integration sync.
-- PostgreSQL error 42P10 means ON CONFLICT cannot find a matching
-- non-partial UNIQUE/EXCLUSION constraint for the supplied columns.

-- Keep the newest lead row for each non-null external_id before rebuilding
-- the index as a full unique index. PostgreSQL still permits multiple NULLs.
with ranked as (
  select
    id,
    row_number() over (
      partition by external_id
      order by updated_at desc nulls last, created_at desc nulls last, id desc
    ) as row_number
  from public.marketing_leads
  where external_id is not null
)
delete from public.marketing_leads as target
using ranked
where target.id = ranked.id
  and ranked.row_number > 1;

drop index if exists public.marketing_leads_external_id_uidx;
drop index if exists public.marketing_leads_external_id_full_uidx;
create unique index marketing_leads_external_id_full_uidx
  on public.marketing_leads (external_id);

-- Keep one ad/day row before creating the exact composite conflict target
-- used by /rest/v1/marketing_ads?on_conflict=external_id,report_date.
with ranked as (
  select
    id,
    row_number() over (
      partition by external_id, report_date
      order by updated_at desc nulls last, created_at desc nulls last, id desc
    ) as row_number
  from public.marketing_ads
  where external_id is not null
    and report_date is not null
)
delete from public.marketing_ads as target
using ranked
where target.id = ranked.id
  and ranked.row_number > 1;

drop index if exists public.marketing_ads_external_date_uidx;
drop index if exists public.marketing_ads_external_date_full_uidx;
create unique index marketing_ads_external_date_full_uidx
  on public.marketing_ads (external_id, report_date);

-- Rebuild the daily metrics target as well because the integration worker
-- performs ON CONFLICT(date,source,platform).
with ranked as (
  select
    id,
    row_number() over (
      partition by date, source, platform
      order by updated_at desc nulls last, created_at desc nulls last, id desc
    ) as row_number
  from public.marketing_daily_metrics
)
delete from public.marketing_daily_metrics as target
using ranked
where target.id = ranked.id
  and ranked.row_number > 1;

alter table public.marketing_daily_metrics
  drop constraint if exists marketing_daily_metrics_date_source_platform_key;
drop index if exists public.marketing_daily_metrics_date_source_platform_uidx;
create unique index marketing_daily_metrics_date_source_platform_uidx
  on public.marketing_daily_metrics (date, source, platform);

notify pgrst, 'reload schema';
