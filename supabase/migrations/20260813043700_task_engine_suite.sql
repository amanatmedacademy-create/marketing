alter table public.crm_tasks
  add column if not exists queue_claimed_by uuid references public.marketing_users(id) on delete set null,
  add column if not exists queue_claimed_at timestamptz;

create index if not exists crm_tasks_queue_idx
  on public.crm_tasks(company_id, status, priority, due_at, created_at)
  where source = 'work_tasks' and status not in ('done','cancelled');
create index if not exists crm_tasks_queue_claim_idx
  on public.crm_tasks(company_id, queue_claimed_by, queue_claimed_at)
  where source = 'work_tasks';
create index if not exists crm_tasks_queue_claimed_by_idx
  on public.crm_tasks(queue_claimed_by)
  where queue_claimed_by is not null;

create table if not exists public.crm_task_templates (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.crm_companies(id) on delete cascade,
  name text not null,
  description text,
  workflow_key text not null default 'general',
  priority text not null default 'medium' check (priority in ('low','medium','high','urgent')),
  due_offset_minutes integer,
  sla_minutes integer,
  assignment_mode text not null default 'shared' check (assignment_mode in ('shared','individual')),
  targets jsonb not null default '[]'::jsonb,
  checklist jsonb not null default '[]'::jsonb,
  link_type text,
  created_by uuid references public.marketing_users(id) on delete set null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists crm_task_templates_company_idx on public.crm_task_templates(company_id, is_active, created_at desc);
create index if not exists crm_task_templates_created_by_idx on public.crm_task_templates(created_by) where created_by is not null;

create table if not exists public.crm_task_automation_rules (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.crm_companies(id) on delete cascade,
  key text not null,
  name text not null,
  description text,
  enabled boolean not null default true,
  config jsonb not null default '{}'::jsonb,
  last_run_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id, key)
);
create index if not exists crm_task_automation_rules_company_idx on public.crm_task_automation_rules(company_id, enabled, key);

alter table public.crm_task_templates enable row level security;
alter table public.crm_task_automation_rules enable row level security;

revoke all on public.crm_task_templates from anon, authenticated;
revoke all on public.crm_task_automation_rules from anon, authenticated;
grant all on public.crm_task_templates to service_role;
grant all on public.crm_task_automation_rules to service_role;

create policy crm_task_templates_service_role_all on public.crm_task_templates
  for all to service_role using (true) with check (true);
create policy crm_task_automation_rules_service_role_all on public.crm_task_automation_rules
  for all to service_role using (true) with check (true);