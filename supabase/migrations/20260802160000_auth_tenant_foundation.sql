begin;

create extension if not exists pgcrypto;

create type public.company_role as enum ('owner', 'admin', 'manager', 'operator', 'analyst', 'accountant');

create table public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) > 1),
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.company_memberships (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.company_role not null default 'manager',
  is_active boolean not null default true,
  invited_by uuid references auth.users(id) on delete set null,
  joined_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, user_id)
);

create index company_memberships_user_company_idx
  on public.company_memberships (user_id, company_id)
  where is_active = true;

create index company_memberships_company_role_idx
  on public.company_memberships (company_id, role)
  where is_active = true;

create or replace function public.is_company_member(target_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.company_memberships membership
    where membership.company_id = target_company_id
      and membership.user_id = auth.uid()
      and membership.is_active = true
  );
$$;

create or replace function public.has_company_role(target_company_id uuid, allowed_roles public.company_role[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.company_memberships membership
    where membership.company_id = target_company_id
      and membership.user_id = auth.uid()
      and membership.is_active = true
      and membership.role = any(allowed_roles)
  );
$$;

alter table public.companies enable row level security;
alter table public.company_memberships enable row level security;

create policy companies_select_member
  on public.companies
  for select
  using (public.is_company_member(id));

create policy memberships_select_same_company
  on public.company_memberships
  for select
  using (public.is_company_member(company_id));

create policy memberships_manage_admin
  on public.company_memberships
  for all
  using (public.has_company_role(company_id, array['owner', 'admin']::public.company_role[]))
  with check (public.has_company_role(company_id, array['owner', 'admin']::public.company_role[]));

revoke all on function public.is_company_member(uuid) from public;
revoke all on function public.has_company_role(uuid, public.company_role[]) from public;
grant execute on function public.is_company_member(uuid) to authenticated;
grant execute on function public.has_company_role(uuid, public.company_role[]) to authenticated;

commit;
