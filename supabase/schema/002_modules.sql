create type public.project_status as enum ('todo', 'in_progress', 'done');
create type public.transaction_type as enum ('income', 'expense', 'transfer');

create table public.user_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  first_name text not null default '',
  last_name text not null default '',
  avatar_color text not null default '#4F6EF7',
  phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.company_members
  add column if not exists department text,
  add column if not exists is_online boolean not null default false,
  add column if not exists last_seen_at timestamptz;

alter table public.tasks
  add column if not exists priority text not null default 'medium'
    check (priority in ('low', 'medium', 'high', 'urgent'));

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.project_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  title text not null,
  status public.project_status not null default 'todo',
  position integer not null default 0,
  assignee_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.finance_accounts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  account_type text not null default 'cash',
  currency text not null default 'KZT',
  created_at timestamptz not null default now()
);

create table public.finance_transactions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  account_id uuid references public.finance_accounts(id) on delete set null,
  deal_id uuid references public.deals(id) on delete set null,
  type public.transaction_type not null,
  amount numeric(14,2) not null check (amount >= 0),
  description text not null,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index projects_company_idx on public.projects(company_id, created_at desc);
create index project_items_company_project_idx on public.project_items(company_id, project_id, status, position);
create index finance_accounts_company_idx on public.finance_accounts(company_id);
create index finance_transactions_company_date_idx on public.finance_transactions(company_id, occurred_at desc);

alter table public.user_profiles enable row level security;
alter table public.projects enable row level security;
alter table public.project_items enable row level security;
alter table public.finance_accounts enable row level security;
alter table public.finance_transactions enable row level security;

create policy user_profiles_select on public.user_profiles
for select to authenticated
using (
  exists (
    select 1
    from public.company_members viewer
    join public.company_members target on target.user_id = user_profiles.user_id
    where viewer.user_id = (select auth.uid())
      and viewer.company_id = target.company_id
  )
);

create policy user_profiles_update_self on public.user_profiles
for update to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

create policy projects_all on public.projects
for all to authenticated
using (public.is_company_member(company_id))
with check (public.is_company_member(company_id));

create policy project_items_all on public.project_items
for all to authenticated
using (public.is_company_member(company_id))
with check (public.is_company_member(company_id));

create policy finance_accounts_all on public.finance_accounts
for all to authenticated
using (public.is_company_member(company_id))
with check (public.is_company_member(company_id));

create policy finance_transactions_all on public.finance_transactions
for all to authenticated
using (public.is_company_member(company_id))
with check (public.is_company_member(company_id));

grant select, insert, update on public.user_profiles to authenticated;
grant select, insert, update, delete on public.projects, public.project_items, public.finance_accounts, public.finance_transactions to authenticated;
grant all on public.user_profiles, public.projects, public.project_items, public.finance_accounts, public.finance_transactions to service_role;
