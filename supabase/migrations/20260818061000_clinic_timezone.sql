-- Clinic-level timezone for tenant-safe local analytics.
-- Keep a deterministic default for existing Kazakhstan clinics; each clinic can
-- override this with any valid IANA timezone such as Europe/Berlin.

alter table public.crm_companies
  add column if not exists timezone text;

update public.crm_companies
set timezone = 'Asia/Almaty'
where timezone is null or btrim(timezone) = '';

alter table public.crm_companies
  alter column timezone set default 'Asia/Almaty',
  alter column timezone set not null;

create index if not exists crm_companies_timezone_idx
  on public.crm_companies (timezone);

notify pgrst, 'reload schema';
