-- Make integration credentials branch-aware without changing the clinic tenant boundary.
drop index if exists public.integration_credentials_company_provider_uidx;
drop index if exists public.integration_credentials_company_waba_phone_uidx;
drop index if exists public.integration_credentials_company_user_provider_uidx;

create unique index if not exists integration_credentials_company_branch_provider_uidx
  on public.integration_credentials (company_id, branch_id, provider)
  where user_id is null and provider <> 'waba';

create unique index if not exists integration_credentials_company_branch_waba_phone_uidx
  on public.integration_credentials (
    company_id,
    branch_id,
    ((config_summary -> 'values' ->> 'phoneNumberId'))
  )
  where user_id is null
    and provider = 'waba'
    and coalesce(config_summary -> 'values' ->> 'phoneNumberId', '') <> '';

create unique index if not exists integration_credentials_company_branch_user_provider_uidx
  on public.integration_credentials (company_id, branch_id, user_id, provider)
  where user_id is not null;

notify pgrst, 'reload schema';
