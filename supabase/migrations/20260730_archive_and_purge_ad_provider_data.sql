create table if not exists public.marketing_ads_archive (like public.marketing_ads including defaults including constraints including indexes);
alter table public.marketing_ads_archive add column if not exists archived_at timestamptz not null default now();
alter table public.marketing_ads_archive add column if not exists archived_reason text not null default 'integration_disconnected';

create table if not exists public.marketing_daily_metrics_archive (like public.marketing_daily_metrics including defaults including constraints including indexes);
alter table public.marketing_daily_metrics_archive add column if not exists archived_at timestamptz not null default now();
alter table public.marketing_daily_metrics_archive add column if not exists archived_reason text not null default 'integration_disconnected';

alter table public.marketing_ads_archive enable row level security;
alter table public.marketing_daily_metrics_archive enable row level security;
revoke all on public.marketing_ads_archive from anon, authenticated;
revoke all on public.marketing_daily_metrics_archive from anon, authenticated;
grant all on public.marketing_ads_archive to service_role;
grant all on public.marketing_daily_metrics_archive to service_role;

create or replace function public.manage_ad_provider_data(p_provider text, p_purge boolean default false)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_platform text;
  v_ads integer := 0;
  v_daily integer := 0;
begin
  v_platform := case lower(trim(p_provider))
    when 'meta' then 'Meta'
    when 'tiktok' then 'TikTok'
    else null
  end;

  if v_platform is null then
    return jsonb_build_object('provider', p_provider, 'affected', false, 'ads', 0, 'daily', 0);
  end if;

  if p_purge then
    delete from public.marketing_ads_archive where lower(platform) = lower(v_platform);
    get diagnostics v_ads = row_count;
    delete from public.marketing_daily_metrics_archive where lower(platform) = lower(v_platform);
    get diagnostics v_daily = row_count;
  else
    insert into public.marketing_ads_archive
    select a.*, now(), 'integration_disconnected'
    from public.marketing_ads a
    where lower(a.platform) = lower(v_platform)
    on conflict (id) do update set archived_at = excluded.archived_at, archived_reason = excluded.archived_reason;
    get diagnostics v_ads = row_count;

    insert into public.marketing_daily_metrics_archive
    select d.*, now(), 'integration_disconnected'
    from public.marketing_daily_metrics d
    where lower(d.platform) = lower(v_platform)
    on conflict (id) do update set archived_at = excluded.archived_at, archived_reason = excluded.archived_reason;
    get diagnostics v_daily = row_count;
  end if;

  delete from public.marketing_ads where lower(platform) = lower(v_platform);
  delete from public.marketing_daily_metrics where lower(platform) = lower(v_platform);

  return jsonb_build_object('provider', p_provider, 'affected', true, 'purged', p_purge, 'ads', v_ads, 'daily', v_daily);
end;
$$;

revoke all on function public.manage_ad_provider_data(text, boolean) from public, anon, authenticated;
grant execute on function public.manage_ad_provider_data(text, boolean) to service_role;