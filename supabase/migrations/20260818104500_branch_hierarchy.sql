-- Organization -> Clinic -> Branch hierarchy.
-- crm_companies remains the tenant boundary. Branches are an operational scope inside a clinic.

create table if not exists public.crm_branches (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.crm_companies(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 2 and 180),
  code text,
  status text not null default 'active' check (status in ('active','inactive','archived')),
  is_primary boolean not null default false,
  city text,
  address text,
  phone text,
  timezone text not null default 'Asia/Almaty',
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references public.marketing_users(id) on delete set null,
  updated_by uuid references public.marketing_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists crm_branches_company_code_uidx on public.crm_branches(company_id, lower(code)) where code is not null and trim(code) <> '';
create unique index if not exists crm_branches_one_primary_uidx on public.crm_branches(company_id) where is_primary = true and status <> 'archived';
create index if not exists crm_branches_company_status_idx on public.crm_branches(company_id, status, created_at);

insert into public.crm_branches(company_id, name, code, is_primary, status)
select c.id, coalesce(nullif(trim(c.name), ''), 'Основной филиал'), 'MAIN', true, 'active'
from public.crm_companies c
where not exists (select 1 from public.crm_branches b where b.company_id = c.id and b.status <> 'archived');

create table if not exists public.crm_branch_members (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.crm_companies(id) on delete cascade,
  branch_id uuid not null references public.crm_branches(id) on delete cascade,
  user_id uuid not null references public.marketing_users(id) on delete cascade,
  status text not null default 'active' check (status in ('active','inactive')),
  created_by uuid references public.marketing_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(branch_id, user_id)
);
create index if not exists crm_branch_members_company_user_idx on public.crm_branch_members(company_id, user_id, status);
create index if not exists crm_branch_members_branch_idx on public.crm_branch_members(branch_id, status);

alter table public.marketing_leads add column if not exists branch_id uuid references public.crm_branches(id) on delete set null;
alter table public.crm_tasks add column if not exists branch_id uuid references public.crm_branches(id) on delete set null;
alter table public.integration_credentials add column if not exists branch_id uuid references public.crm_branches(id) on delete set null;
create index if not exists marketing_leads_company_branch_idx on public.marketing_leads(company_id, branch_id);
create index if not exists crm_tasks_company_branch_idx on public.crm_tasks(company_id, branch_id);
create index if not exists integration_credentials_company_branch_idx on public.integration_credentials(company_id, branch_id);

create or replace function public.imds_set_primary_branch(p_company_id uuid, p_branch_id uuid, p_actor_user_id uuid default null)
returns public.crm_branches
language plpgsql
security definer
set search_path = public
as $$
declare target public.crm_branches;
begin
  select * into target from public.crm_branches where id = p_branch_id and company_id = p_company_id and status <> 'archived' for update;
  if target.id is null then raise exception 'Филиал не найден'; end if;
  update public.crm_branches set is_primary = false, updated_at = now(), updated_by = p_actor_user_id where company_id = p_company_id and id <> p_branch_id and is_primary = true;
  update public.crm_branches set is_primary = true, status = 'active', updated_at = now(), updated_by = p_actor_user_id where id = p_branch_id returning * into target;
  return target;
end;
$$;

revoke all on function public.imds_set_primary_branch(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.imds_set_primary_branch(uuid, uuid, uuid) to service_role;
alter table public.crm_branches enable row level security;
alter table public.crm_branch_members enable row level security;
revoke all on public.crm_branches, public.crm_branch_members from anon, authenticated;
grant all on public.crm_branches, public.crm_branch_members to service_role;
notify pgrst, 'reload schema';
