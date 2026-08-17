-- Allow one organization to keep multiple independent WABA phone-number channels.
-- Other providers remain singleton at tenant level for backwards compatibility.

drop index if exists public.integration_credentials_company_provider_uidx;

create unique index if not exists integration_credentials_company_provider_uidx
  on public.integration_credentials (company_id, provider)
  where user_id is null and provider <> 'waba';

create unique index if not exists integration_credentials_company_waba_phone_uidx
  on public.integration_credentials (
    company_id,
    ((config_summary -> 'values' ->> 'phoneNumberId'))
  )
  where user_id is null
    and provider = 'waba'
    and coalesce(config_summary -> 'values' ->> 'phoneNumberId', '') <> '';
