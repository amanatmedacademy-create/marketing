-- Enable Binotel and Sipuni as first-class tenant telephony providers.
alter table public.integration_credentials
  drop constraint if exists integration_credentials_provider_check;

alter table public.integration_credentials
  add constraint integration_credentials_provider_check
  check (provider = any(array[
    'bitrix'::text,
    'meta'::text,
    'tiktok'::text,
    'n8n'::text,
    'waba'::text,
    'zadarma'::text,
    'asterisk'::text,
    'freepbx'::text,
    'twilio'::text,
    'voximplant'::text,
    'sip'::text,
    'binotel'::text,
    'sipuni'::text
  ]));

alter table public.telephony_settings
  drop constraint if exists telephony_settings_provider_check;

alter table public.telephony_settings
  add constraint telephony_settings_provider_check
  check (provider in ('zadarma', 'asterisk', 'freepbx', 'twilio', 'voximplant', 'sip', 'binotel', 'sipuni'));

alter table public.marketing_calls
  drop constraint if exists marketing_calls_telephony_provider_check;

alter table public.marketing_calls
  add constraint marketing_calls_telephony_provider_check
  check (telephony_provider in ('zadarma', 'asterisk', 'freepbx', 'twilio', 'voximplant', 'sip', 'binotel', 'sipuni'));

create unique index if not exists marketing_calls_company_provider_pbx_uidx
  on public.marketing_calls(company_id, telephony_provider, pbx_call_id)
  where pbx_call_id is not null;

notify pgrst, 'reload schema';
