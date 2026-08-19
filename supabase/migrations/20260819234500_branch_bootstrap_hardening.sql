-- Ensure every clinic has an operational primary branch.
-- Idempotent on PostgreSQL 17 and safe for clinics that may have archived a historical MAIN branch.

insert into public.crm_branches(company_id, name, code, is_primary, status, timezone, created_by, updated_by)
select
  c.id,
  case
    when char_length(btrim(coalesce(c.name, ''))) >= 2 then left(btrim(c.name), 180)
    else 'Основной филиал'
  end,
  case
    when exists (
      select 1 from public.crm_branches existing
      where existing.company_id = c.id and lower(existing.code) = 'main'
    ) then null
    else 'MAIN'
  end,
  true,
  'active',
  coalesce(nullif(btrim(c.timezone), ''), 'Asia/Almaty'),
  c.created_by,
  c.created_by
from public.crm_companies c
where not exists (
  select 1
  from public.crm_branches b
  where b.company_id = c.id and b.status <> 'archived'
);

create or replace function public.imds_bootstrap_company_primary_branch()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  insert into public.crm_branches(company_id, name, code, is_primary, status, timezone, created_by, updated_by)
  select
    new.id,
    case
      when char_length(btrim(coalesce(new.name, ''))) >= 2 then left(btrim(new.name), 180)
      else 'Основной филиал'
    end,
    'MAIN',
    true,
    'active',
    coalesce(nullif(btrim(new.timezone), ''), 'Asia/Almaty'),
    new.created_by,
    new.created_by
  where not exists (
    select 1
    from public.crm_branches b
    where b.company_id = new.id and b.status <> 'archived'
  );
  return new;
end
$$;

revoke all on function public.imds_bootstrap_company_primary_branch() from public, anon, authenticated;

drop trigger if exists crm_companies_bootstrap_primary_branch on public.crm_companies;
create trigger crm_companies_bootstrap_primary_branch
after insert on public.crm_companies
for each row execute function public.imds_bootstrap_company_primary_branch();

notify pgrst, 'reload schema';
