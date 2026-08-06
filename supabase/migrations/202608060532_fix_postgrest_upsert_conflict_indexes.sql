drop index if exists public.marketing_ads_external_id_report_date_key;
create unique index marketing_ads_external_id_report_date_key
  on public.marketing_ads (external_id, report_date);

drop index if exists public.marketing_leads_external_id_key;
create unique index marketing_leads_external_id_key
  on public.marketing_leads (external_id);

notify pgrst, 'reload schema';
