create or replace function public.refresh_meta_daily_metrics(p_company_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  delete from public.marketing_daily_metrics
  where company_id = p_company_id
    and platform = 'Meta';

  insert into public.marketing_daily_metrics (
    company_id,
    date,
    source,
    platform,
    spend,
    impressions,
    clicks,
    leads,
    target_leads,
    arrived,
    sales,
    revenue,
    ads_synced_at
  )
  select
    company_id,
    report_date,
    'Meta',
    'Meta',
    coalesce(sum(spend), 0),
    coalesce(sum(impressions), 0),
    coalesce(sum(clicks), 0),
    coalesce(sum(leads), 0),
    coalesce(sum(target_leads), 0),
    coalesce(sum(arrived), 0),
    coalesce(sum(sales), 0),
    coalesce(sum(revenue), 0),
    now()
  from public.marketing_ads
  where company_id = p_company_id
    and platform = 'Meta'
  group by company_id, report_date
  on conflict (company_id, date, source, platform)
  do update set
    spend = excluded.spend,
    impressions = excluded.impressions,
    clicks = excluded.clicks,
    leads = excluded.leads,
    target_leads = excluded.target_leads,
    arrived = excluded.arrived,
    sales = excluded.sales,
    revenue = excluded.revenue,
    ads_synced_at = excluded.ads_synced_at;
end;
$$;

revoke all on function public.refresh_meta_daily_metrics(uuid) from public, anon, authenticated;
grant execute on function public.refresh_meta_daily_metrics(uuid) to service_role;

notify pgrst, 'reload schema';
