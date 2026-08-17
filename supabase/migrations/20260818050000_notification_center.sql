-- Tenant/user notification center for BELES.
create table if not exists public.crm_notifications (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.crm_companies(id) on delete cascade,
  user_id uuid not null references public.marketing_users(id) on delete cascade,
  type text not null,
  severity text not null default 'info' check (severity in ('info','success','warning','error')),
  title text not null,
  body text,
  action_url text,
  dedupe_key text not null,
  metadata jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id,user_id,dedupe_key)
);
create index if not exists crm_notifications_user_unread_idx on public.crm_notifications(company_id,user_id,created_at desc) where read_at is null;
create index if not exists crm_notifications_created_idx on public.crm_notifications(company_id,created_at desc);
alter table public.crm_notifications enable row level security;
revoke all on public.crm_notifications from anon,authenticated;
grant all on public.crm_notifications to service_role;
notify pgrst,'reload schema';
