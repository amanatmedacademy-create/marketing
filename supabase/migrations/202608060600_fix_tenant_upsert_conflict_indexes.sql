drop index if exists public.marketing_ads_company_external_date_uidx;
create unique index marketing_ads_company_external_date_uidx
  on public.marketing_ads (company_id, external_id, report_date);

drop index if exists public.marketing_leads_company_external_uidx;
create unique index marketing_leads_company_external_uidx
  on public.marketing_leads (company_id, external_id);

notify pgrst, 'reload schema';
