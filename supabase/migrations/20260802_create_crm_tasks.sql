create table if not exists public.crm_tasks (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.crm_companies(id) on delete cascade,
  project_id uuid references public.crm_projects(id) on delete set null,
  title text not null,
  description text,
  status text not null default 'todo' check (status in ('todo','in_progress','done','cancelled')),
  priority text not null default 'medium' check (priority in ('low','medium','high','urgent')),
  assignee_id uuid references public.marketing_users(id) on delete set null,
  due_at timestamptz,
  completed_at timestamptz,
  created_by uuid references public.marketing_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists crm_tasks_company_status_due_idx
  on public.crm_tasks (company_id, status, due_at);
create index if not exists crm_tasks_project_idx
  on public.crm_tasks (project_id) where project_id is not null;
create index if not exists crm_tasks_assignee_idx
  on public.crm_tasks (assignee_id) where assignee_id is not null;

alter table public.crm_tasks enable row level security;

revoke all on public.crm_tasks from anon;
grant select, insert, update, delete on public.crm_tasks to authenticated;
grant all on public.crm_tasks to service_role;

create policy crm_tasks_select_company on public.crm_tasks
for select to authenticated
using (
  exists (
    select 1 from public.crm_company_members m
    where m.company_id = crm_tasks.company_id
      and m.user_id = auth.uid()
      and m.status = 'active'
  )
);

create policy crm_tasks_insert_company on public.crm_tasks
for insert to authenticated
with check (
  exists (
    select 1 from public.crm_company_members m
    where m.company_id = crm_tasks.company_id
      and m.user_id = auth.uid()
      and m.status = 'active'
  )
);

create policy crm_tasks_update_company on public.crm_tasks
for update to authenticated
using (
  exists (
    select 1 from public.crm_company_members m
    where m.company_id = crm_tasks.company_id
      and m.user_id = auth.uid()
      and m.status = 'active'
  )
)
with check (
  exists (
    select 1 from public.crm_company_members m
    where m.company_id = crm_tasks.company_id
      and m.user_id = auth.uid()
      and m.status = 'active'
  )
);

create policy crm_tasks_delete_company on public.crm_tasks
for delete to authenticated
using (
  exists (
    select 1 from public.crm_company_members m
    where m.company_id = crm_tasks.company_id
      and m.user_id = auth.uid()
      and m.status = 'active'
  )
);

comment on table public.crm_tasks is 'Tenant-scoped operational tasks optionally linked to CRM projects.';
