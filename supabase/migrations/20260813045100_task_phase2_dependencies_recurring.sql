alter table public.crm_tasks
  add column if not exists recurrence_source_task_id uuid references public.crm_tasks(id) on delete set null,
  add column if not exists recurrence_rule_id uuid;

create table if not exists public.crm_task_dependencies (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.crm_companies(id) on delete cascade,
  task_id uuid not null references public.crm_tasks(id) on delete cascade,
  depends_on_task_id uuid not null references public.crm_tasks(id) on delete cascade,
  dependency_type text not null default 'blocks' check (dependency_type in ('blocks')),
  created_by uuid references public.marketing_users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique(company_id, task_id, depends_on_task_id),
  check (task_id <> depends_on_task_id)
);
create index if not exists crm_task_dependencies_task_idx on public.crm_task_dependencies(company_id, task_id);
create index if not exists crm_task_dependencies_depends_idx on public.crm_task_dependencies(company_id, depends_on_task_id);

create table if not exists public.crm_task_recurrence_rules (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.crm_companies(id) on delete cascade,
  source_task_id uuid not null references public.crm_tasks(id) on delete cascade,
  frequency text not null check (frequency in ('daily','weekly','monthly')),
  interval_count integer not null default 1 check (interval_count between 1 and 365),
  next_run_at timestamptz not null,
  last_run_at timestamptz,
  enabled boolean not null default true,
  created_by uuid references public.marketing_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id, source_task_id)
);
create index if not exists crm_task_recurrence_due_idx on public.crm_task_recurrence_rules(company_id, enabled, next_run_at);

alter table public.crm_task_dependencies enable row level security;
alter table public.crm_task_recurrence_rules enable row level security;
revoke all on public.crm_task_dependencies from anon, authenticated;
revoke all on public.crm_task_recurrence_rules from anon, authenticated;
grant all on public.crm_task_dependencies to service_role;
grant all on public.crm_task_recurrence_rules to service_role;

create policy crm_task_dependencies_service_role_all on public.crm_task_dependencies
  for all to service_role using (true) with check (true);
create policy crm_task_recurrence_rules_service_role_all on public.crm_task_recurrence_rules
  for all to service_role using (true) with check (true);

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'crm_tasks_recurrence_rule_fk') then
    alter table public.crm_tasks
      add constraint crm_tasks_recurrence_rule_fk
      foreign key (recurrence_rule_id) references public.crm_task_recurrence_rules(id) on delete set null;
  end if;
end $$;

create unique index if not exists crm_tasks_recurrence_instance_uq
  on public.crm_tasks(company_id, recurrence_rule_id, due_at)
  where recurrence_rule_id is not null and due_at is not null;