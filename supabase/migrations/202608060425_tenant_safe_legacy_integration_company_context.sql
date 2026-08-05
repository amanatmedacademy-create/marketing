create schema if not exists private;

create or replace function private.resolve_single_company_id()
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  resolved_id uuid;
  company_count integer;
begin
  select count(*) into company_count
  from public.crm_companies;

  if company_count = 1 then
    select id into resolved_id
    from public.crm_companies
    limit 1;
    return resolved_id;
  end if;

  if company_count = 0 then
    raise exception 'No company exists for legacy tenant context';
  end if;

  raise exception 'Ambiguous legacy tenant context: % companies exist', company_count;
end;
$$;

revoke all on function private.resolve_single_company_id() from public, anon, authenticated;
grant execute on function private.resolve_single_company_id() to service_role;

alter table public.integration_credentials alter column company_id set default private.resolve_single_company_id();
alter table public.integration_runs alter column company_id set default private.resolve_single_company_id();
alter table public.integration_events alter column company_id set default private.resolve_single_company_id();
alter table public.marketing_leads alter column company_id set default private.resolve_single_company_id();
alter table public.marketing_ads alter column company_id set default private.resolve_single_company_id();
alter table public.marketing_daily_metrics alter column company_id set default private.resolve_single_company_id();
alter table public.marketing_calls alter column company_id set default private.resolve_single_company_id();

drop index if exists public.integration_credentials_global_provider_uidx;
create unique index if not exists integration_credentials_company_provider_uidx
  on public.integration_credentials (company_id, provider)
  where user_id is null;

alter table public.integration_credentials drop constraint if exists integration_credentials_user_provider_key;
drop index if exists public.integration_credentials_user_provider_key;
create unique index if not exists integration_credentials_company_user_provider_uidx
  on public.integration_credentials (company_id, user_id, provider)
  where user_id is not null;

drop index if exists public.marketing_ads_external_id_report_date_key;

notify pgrst, 'reload schema';
