create or replace function public.manage_ad_provider_data(
  p_company_id uuid,
  p_provider text,
  p_purge boolean default false
)
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
    return jsonb_build_object(
      'company_id', p_company_id,
      'provider', p_provider,
      'affected', false,
      'ads', 0,
      'daily', 0
    );
  end if;

  if p_purge then
    delete from public.marketing_ads_archive
    where company_id = p_company_id
      and lower(platform) = lower(v_platform);
    get diagnostics v_ads = row_count;

    delete from public.marketing_daily_metrics_archive
    where company_id = p_company_id
      and lower(platform) = lower(v_platform);
    get diagnostics v_daily = row_count;
  else
    insert into public.marketing_ads_archive
    select a.*, now(), 'integration_disconnected'
    from public.marketing_ads a
    where a.company_id = p_company_id
      and lower(a.platform) = lower(v_platform)
    on conflict (id) do update set
      archived_at = excluded.archived_at,
      archived_reason = excluded.archived_reason;
    get diagnostics v_ads = row_count;

    insert into public.marketing_daily_metrics_archive
    select d.*, now(), 'integration_disconnected'
    from public.marketing_daily_metrics d
    where d.company_id = p_company_id
      and lower(d.platform) = lower(v_platform)
    on conflict (id) do update set
      archived_at = excluded.archived_at,
      archived_reason = excluded.archived_reason;
    get diagnostics v_daily = row_count;
  end if;

  delete from public.marketing_ads
  where company_id = p_company_id
    and lower(platform) = lower(v_platform);

  delete from public.marketing_daily_metrics
  where company_id = p_company_id
    and lower(platform) = lower(v_platform);

  return jsonb_build_object(
    'company_id', p_company_id,
    'provider', p_provider,
    'affected', true,
    'purged', p_purge,
    'ads', v_ads,
    'daily', v_daily
  );
end;
$$;

grant execute on function public.manage_ad_provider_data(uuid, text, boolean) to service_role;

drop function if exists public.manage_ad_provider_data(text, boolean);
