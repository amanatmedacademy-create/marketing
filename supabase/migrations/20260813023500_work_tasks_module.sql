alter table public.crm_tasks add column if not exists assignment_mode text not null default 'shared';
do $$ begin if not exists(select 1 from pg_constraint where conname='crm_tasks_assignment_mode_check') then alter table public.crm_tasks add constraint crm_tasks_assignment_mode_check check (assignment_mode in ('shared','individual')); end if; end $$;

create table if not exists public.crm_task_targets (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.crm_companies(id) on delete cascade,
  task_id uuid not null references public.crm_tasks(id) on delete cascade, target_type text not null,
  target_value text, target_label text not null, created_at timestamptz not null default now(),
  check (target_type in ('all','position','job_title','user'))
);
create index if not exists crm_task_targets_task_idx on public.crm_task_targets(company_id,task_id);
create index if not exists crm_task_targets_lookup_idx on public.crm_task_targets(company_id,target_type,target_value);

create table if not exists public.crm_task_executions (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.crm_companies(id) on delete cascade,
  task_id uuid not null references public.crm_tasks(id) on delete cascade, user_id uuid not null references public.marketing_users(id) on delete cascade,
  status text not null default 'todo', completed_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(task_id,user_id), check(status in ('todo','in_progress','review','done','cancelled'))
);
create index if not exists crm_task_executions_user_idx on public.crm_task_executions(company_id,user_id,status);

create table if not exists public.crm_task_comments (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.crm_companies(id) on delete cascade,
  task_id uuid not null references public.crm_tasks(id) on delete cascade, user_id uuid not null references public.marketing_users(id) on delete cascade,
  body text not null check(length(trim(body))>0), created_at timestamptz not null default now()
);
create index if not exists crm_task_comments_task_idx on public.crm_task_comments(company_id,task_id,created_at);

alter table public.crm_task_targets enable row level security;
alter table public.crm_task_executions enable row level security;
alter table public.crm_task_comments enable row level security;
revoke all on public.crm_task_targets, public.crm_task_executions, public.crm_task_comments from anon, authenticated;
grant all on public.crm_task_targets, public.crm_task_executions, public.crm_task_comments to service_role;

insert into public.platform_modules(id,name,description,category,route,navigation_label,navigation_order,status,metadata)
values('work.tasks','Задачи','Общие, отделовые и персональные задачи.','work','/tasks','Задачи',30,'active','{"access_actions":["view","create","edit","delete","manage"]}'::jsonb)
on conflict(id) do update set name=excluded.name,description=excluded.description,category=excluded.category,route=excluded.route,navigation_label=excluded.navigation_label,status='active',metadata=public.platform_modules.metadata||excluded.metadata,updated_at=now();

update public.crm_access_position_permissions p set can_view=true,can_create=true,can_edit=true,can_manage=(pos.system_key='system_admin'),updated_at=now()
from public.crm_access_positions pos where p.position_id=pos.id and p.module_id='work.tasks';
notify pgrst,'reload schema';
