-- Fail closed for Marketing tenants enrolled in the IMDS Control Plane.
-- No existing tenant is marked automatically; enrollment occurs only after a real Control Plane apply/command.

alter table public.crm_companies
  add column if not exists platform_managed_at timestamptz;

create index if not exists crm_companies_platform_managed_idx
  on public.crm_companies (id)
  where platform_managed_at is not null;

comment on column public.crm_companies.platform_managed_at is
  'Set by the IMDS Control Plane adapter after successful tenant enrollment/synchronization. Missing entitlements for marked tenants fail closed.';

notify pgrst, 'reload schema';
