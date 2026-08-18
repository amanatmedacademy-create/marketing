-- Enable Binotel and Sipuni as first-class tenant telephony providers without
-- narrowing the integration provider set introduced by earlier modules.
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
    'google_ads'::text,
    'ga4'::text,
    'mis'::text,
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

-- Backfill telephony settings for clinics created after the original telephony migration.
insert into public.telephony_settings (company_id)
select id from public.crm_companies
on conflict (company_id) do nothing;

-- Future clinics receive a telephony_settings row automatically, so provider
-- activation never depends on a separate provisioning step.
create or replace function public.imds_init_clinic_telephony_settings()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.telephony_settings (company_id)
  values (new.id)
  on conflict (company_id) do nothing;
  return new;
end;
$$;

revoke all on function public.imds_init_clinic_telephony_settings() from public, anon, authenticated;
grant execute on function public.imds_init_clinic_telephony_settings() to service_role;

drop trigger if exists imds_crm_companies_init_telephony on public.crm_companies;
create trigger imds_crm_companies_init_telephony
after insert on public.crm_companies
for each row execute function public.imds_init_clinic_telephony_settings();

notify pgrst, 'reload schema';
