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

-- Idempotency is already enforced globally by marketing_calls_company_pbx_call_uidx
-- on (company_id, pbx_call_id). Reuse it instead of introducing a second overlapping index.

notify pgrst, 'reload schema';
