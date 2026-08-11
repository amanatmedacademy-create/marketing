drop index if exists public.marketing_calls_company_pbx_call_uidx;
create unique index marketing_calls_company_pbx_call_uidx
  on public.marketing_calls(company_id,pbx_call_id);

drop index if exists public.crm_tasks_company_external_key_uidx;
create unique index crm_tasks_company_external_key_uidx
  on public.crm_tasks(company_id,external_key);
