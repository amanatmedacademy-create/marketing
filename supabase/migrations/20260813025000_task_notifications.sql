create table if not exists public.crm_task_notifications (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.crm_companies(id) on delete cascade,
  user_id uuid not null references public.marketing_users(id) on delete cascade,
  task_id uuid not null references public.crm_tasks(id) on delete cascade,
  kind text not null check (kind in ('assigned','due_soon','overdue')),
  title text not null,
  message text not null,
  dedupe_key text not null,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  unique(company_id,user_id,task_id,kind,dedupe_key)
);
create index if not exists crm_task_notifications_user_idx on public.crm_task_notifications(company_id,user_id,read_at,created_at desc);
create index if not exists crm_task_notifications_task_idx on public.crm_task_notifications(company_id,task_id);
alter table public.crm_task_notifications enable row level security;
revoke all on public.crm_task_notifications from anon, authenticated;
grant all on public.crm_task_notifications to service_role;
notify pgrst, 'reload schema';
