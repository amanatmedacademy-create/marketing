-- IMDS Account -> Organization -> Clinic compatibility foundation.
-- crm_companies remains the canonical Marketing tenant table.

create table if not exists public.imds_organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text,
  status text not null default 'active' check (status in ('active', 'archived', 'pending_deletion')),
  created_by uuid,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists imds_organizations_slug_uidx
  on public.imds_organizations (lower(slug))
  where nullif(btrim(slug), '') is not null and status <> 'pending_deletion';

alter table public.crm_companies
  add column if not exists organization_id uuid references public.imds_organizations(id) on delete restrict;

-- Existing Marketing tenants become one-to-one organizations initially.
-- Reusing the tenant UUID makes the backfill deterministic and keeps rollout reversible.
insert into public.imds_organizations (id, name, slug, created_by, created_at, updated_at)
select c.id,
       coalesce(nullif(btrim(c.name), ''), c.id::text),
       nullif(btrim(c.slug), ''),
       c.created_by,
       now(),
       now()
from public.crm_companies c
where not exists (
  select 1 from public.imds_organizations o where o.id = c.id
)
on conflict (id) do nothing;

update public.crm_companies c
set organization_id = c.id
where c.organization_id is null
  and exists (select 1 from public.imds_organizations o where o.id = c.id);

create index if not exists crm_companies_organization_idx
  on public.crm_companies (organization_id, id);

alter table public.imds_auth_users
  add column if not exists default_company_id uuid references public.crm_companies(id) on delete set null,
  add column if not exists locale text not null default 'ru',
  add column if not exists timezone text not null default 'Asia/Almaty';

-- Keep ownership in the existing membership model, but make owner lookup efficient.
create index if not exists crm_company_members_owner_idx
  on public.crm_company_members (company_id, user_id)
  where role = 'owner' and status = 'active';

revoke all on public.imds_organizations from anon, authenticated;
grant all on public.imds_organizations to service_role;

notify pgrst, 'reload schema';
