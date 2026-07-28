create unique index if not exists marketing_leads_external_id_full_uidx
  on public.marketing_leads (external_id);

create unique index if not exists marketing_ads_external_date_full_uidx
  on public.marketing_ads (external_id, report_date);

alter table public.integration_events
  alter column event_type set default 'unknown';

notify pgrst, 'reload schema';
