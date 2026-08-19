-- Keep branch scope valid even when a company was provisioned after the original
-- branch hierarchy backfill. crm_companies remains the tenant boundary.

create or replace function public.imds_ensure_primary_branch_on_insert()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status = 'archived' then
    return new;
  end if;
  if not exists (
    select 1 from public.crm_branches b
    where b.company_id = new.company_id
      and b.status <> 'archived'
      and b.is_primary = true
  ) then
    new.is_primary := true;
  end if;
  return new;
end;
$$;

drop trigger if exists crm_branches_ensure_primary_before_insert on public.crm_branches;
create trigger crm_branches_ensure_primary_before_insert
before insert on public.crm_branches
for each row execute function public.imds_ensure_primary_branch_on_insert();

with candidates as (
  select distinct on (b.company_id) b.id, b.company_id
  from public.crm_branches b
  where b.status <> 'archived'
    and not exists (
      select 1 from public.crm_branches p
      where p.company_id = b.company_id
        and p.status <> 'archived'
        and p.is_primary = true
    )
  order by b.company_id, b.created_at asc, b.id asc
)
update public.crm_branches b
set is_primary = true, status = 'active', updated_at = now()
from candidates c
where b.id = c.id;

-- Companies with no branch at all receive a deterministic primary branch.
insert into public.crm_branches(company_id, name, code, status, is_primary)
select c.id, coalesce(nullif(trim(c.name), ''), 'Основной филиал'), 'MAIN', 'active', true
from public.crm_companies c
where not exists (
  select 1 from public.crm_branches b
  where b.company_id = c.id and b.status <> 'archived'
);

notify pgrst, 'reload schema';
