-- Real provider credentials and active telephony controls.
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
    'sip'::text
  ]));

notify pgrst, 'reload schema';
