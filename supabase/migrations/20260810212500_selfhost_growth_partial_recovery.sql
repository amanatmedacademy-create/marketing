-- Recover only an already partially-applied Growth Engine migration.
-- On a fresh database this block is a no-op, so the historical migration still runs normally.
do $$
begin
  if to_regclass('public.patient_journey_events') is not null
     and to_regclass('public.conversion_events') is not null
     and to_regclass('public.lost_opportunities') is not null
     and to_regprocedure('private.sync_growth_from_lead()') is not null
     and to_regprocedure('private.sync_growth_from_call()') is not null
     and not exists (
       select 1
       from public.imds_schema_migrations
       where filename = '20260810212624_create_growth_engine_core.sql'
     ) then

    insert into public.patient_journey_events(
      company_id, lead_id, event_type, occurred_at, channel, source,
      campaign_id, ad_id, external_id, dedupe_key, metadata
    )
    select
      company_id,
      lead_id,
      'call',
      started_at,
      coalesce(channel, 'call'),
      source,
      campaign_id,
      ad_id,
      external_id,
      'call:' || id,
      jsonb_build_object(
        'operator', operator_name,
        'result', call_result,
        'quality_score', quality_score,
        'appointment_created', appointment_created
      )
    from public.marketing_calls
    on conflict(company_id, dedupe_key) do nothing;

    update public.marketing_leads set updated_at = updated_at;
    update public.marketing_calls set updated_at = updated_at;

    insert into public.imds_schema_migrations(filename)
    values ('20260810212624_create_growth_engine_core.sql')
    on conflict(filename) do nothing;
  end if;
end
$$;

notify pgrst, 'reload schema';
