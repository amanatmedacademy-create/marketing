create extension if not exists pgcrypto;

create type public.member_role as enum ('owner', 'admin', 'manager');
create type public.deal_status as enum ('open', 'won', 'lost');
create type public.task_status as enum ('todo', 'in_progress', 'done', 'cancelled');

create table public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  timezone text not null default 'Asia/Almaty',
  locale text not null default 'ru',
  currency text not null default 'KZT',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.company_members (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.member_role not null default 'manager',
  created_at timestamptz not null default now(),
  unique (company_id, user_id)
);

create table public.pipelines (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.pipeline_stages (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  pipeline_id uuid not null references public.pipelines(id) on delete cascade,
  name text not null,
  position integer not null default 0,
  color text,
  created_at timestamptz not null default now()
);

create table public.deals (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  pipeline_id uuid not null references public.pipelines(id) on delete restrict,
  stage_id uuid not null references public.pipeline_stages(id) on delete restrict,
  title text not null,
  contact_name text,
  phone text,
  amount numeric(14,2) not null default 0,
  status public.deal_status not null default 'open',
  owner_user_id uuid references auth.users(id) on delete set null,
  source text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  deal_id uuid references public.deals(id) on delete cascade,
  assignee_user_id uuid references auth.users(id) on delete set null,
  title text not null,
  status public.task_status not null default 'todo',
  due_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index company_members_user_idx on public.company_members(user_id, company_id);
create index pipelines_company_idx on public.pipelines(company_id);
create index pipeline_stages_company_pipeline_idx on public.pipeline_stages(company_id, pipeline_id, position);
create index deals_company_stage_idx on public.deals(company_id, stage_id, created_at desc);
create index tasks_company_status_idx on public.tasks(company_id, status, due_at);

alter table public.companies enable row level security;
alter table public.company_members enable row level security;
alter table public.pipelines enable row level security;
alter table public.pipeline_stages enable row level security;
alter table public.deals enable row level security;
alter table public.tasks enable row level security;

create or replace function public.is_company_member(target_company_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select exists (
    select 1
    from public.company_members cm
    where cm.company_id = target_company_id
      and cm.user_id = (select auth.uid())
  );
$$;

create policy companies_select on public.companies
for select to authenticated
using (public.is_company_member(id));

create policy company_members_select on public.company_members
for select to authenticated
using (public.is_company_member(company_id));

create policy pipelines_all on public.pipelines
for all to authenticated
using (public.is_company_member(company_id))
with check (public.is_company_member(company_id));

create policy pipeline_stages_all on public.pipeline_stages
for all to authenticated
using (public.is_company_member(company_id))
with check (public.is_company_member(company_id));

create policy deals_all on public.deals
for all to authenticated
using (public.is_company_member(company_id))
with check (public.is_company_member(company_id));

create policy tasks_all on public.tasks
for all to authenticated
using (public.is_company_member(company_id))
with check (public.is_company_member(company_id));

grant select on public.companies, public.company_members to authenticated;
grant select, insert, update, delete on public.pipelines, public.pipeline_stages, public.deals, public.tasks to authenticated;
grant all on public.companies, public.company_members, public.pipelines, public.pipeline_stages, public.deals, public.tasks to service_role;
