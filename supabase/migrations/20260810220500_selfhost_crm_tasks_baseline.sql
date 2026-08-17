create table if not exists public.crm_tasks (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.crm_companies(id) on delete cascade,
  project_id uuid,
  title text not null,
  description text,
  status text not null default 'todo' check (status in ('todo','in_progress','done','cancelled')),
  priority text not null default 'medium' check (priority in ('low','medium','high','urgent')),
  assignee_id uuid references public.marketing_users(id) on delete set null,
  due_at timestamptz,
  completed_at timestamptz,
  created_by uuid references public.marketing_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  client_id uuid,
  source text,
  external_key text
);

create index if not exists crm_tasks_assignee_idx
  on public.crm_tasks(assignee_id) where assignee_id is not null;
create index if not exists crm_tasks_project_idx
  on public.crm_tasks(project_id) where project_id is not null;
create index if not exists crm_tasks_client_idx
  on public.crm_tasks(client_id);
create index if not exists crm_tasks_company_status_due_idx
  on public.crm_tasks(company_id, status, due_at);
create unique index if not exists crm_tasks_company_external_key_uidx
  on public.crm_tasks(company_id, external_key)
  where external_key is not null;

alter table public.crm_tasks enable row level security;
revoke all on public.crm_tasks from anon, authenticated;
grant all on public.crm_tasks to service_role;

notify pgrst, 'reload schema';
