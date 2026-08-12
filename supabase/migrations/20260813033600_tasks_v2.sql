alter table public.crm_tasks
  add column if not exists workflow_key text not null default 'general',
  add column if not exists stage_key text not null default 'todo',
  add column if not exists sla_minutes integer,
  add column if not exists sla_due_at timestamptz,
  add column if not exists accepted_at timestamptz,
  add column if not exists result_code text,
  add column if not exists result_note text,
  add column if not exists link_type text,
  add column if not exists link_id text,
  add column if not exists link_label text;

update public.crm_tasks
set stage_key = case status
  when 'todo' then 'todo'
  when 'in_progress' then 'in_progress'
  when 'review' then 'review'
  when 'done' then 'done'
  when 'cancelled' then 'cancelled'
  else 'todo' end
where stage_key is null or stage_key = '';

create index if not exists crm_tasks_company_workflow_stage_idx
  on public.crm_tasks(company_id, workflow_key, stage_key);
create index if not exists crm_tasks_company_sla_due_idx
  on public.crm_tasks(company_id, sla_due_at)
  where sla_due_at is not null;

create table if not exists public.crm_task_checklist (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.crm_companies(id) on delete cascade,
  task_id uuid not null references public.crm_tasks(id) on delete cascade,
  title text not null,
  is_done boolean not null default false,
  sort_order integer not null default 0,
  created_by uuid references public.marketing_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists crm_task_checklist_task_idx
  on public.crm_task_checklist(company_id, task_id, sort_order, created_at);

create table if not exists public.crm_task_watchers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.crm_companies(id) on delete cascade,
  task_id uuid not null references public.crm_tasks(id) on delete cascade,
  user_id uuid not null references public.marketing_users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique(company_id, task_id, user_id)
);
create index if not exists crm_task_watchers_user_idx
  on public.crm_task_watchers(company_id, user_id, created_at desc);

create table if not exists public.crm_task_history (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.crm_companies(id) on delete cascade,
  task_id uuid not null references public.crm_tasks(id) on delete cascade,
  actor_id uuid references public.marketing_users(id) on delete set null,
  event_type text not null,
  from_value text,
  to_value text,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists crm_task_history_task_idx
  on public.crm_task_history(company_id, task_id, created_at desc);

alter table public.crm_task_checklist enable row level security;
alter table public.crm_task_watchers enable row level security;
alter table public.crm_task_history enable row level security;

revoke all on public.crm_task_checklist from anon, authenticated;
revoke all on public.crm_task_watchers from anon, authenticated;
revoke all on public.crm_task_history from anon, authenticated;
grant all on public.crm_task_checklist to service_role;
grant all on public.crm_task_watchers to service_role;
grant all on public.crm_task_history to service_role;