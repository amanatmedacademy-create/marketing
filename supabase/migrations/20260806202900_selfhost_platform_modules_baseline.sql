-- Production has the platform module catalog before the role-access migration,
-- but the original CREATE migration is absent from repository history.
create table if not exists public.platform_modules (
  id text primary key,
  name text not null,
  description text,
  category text not null,
  route text,
  navigation_label text,
  navigation_order integer not null default 0,
  status text not null default 'active' check (status in ('active','inactive','deprecated')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.platform_modules enable row level security;
revoke all on public.platform_modules from anon, authenticated;
grant all on public.platform_modules to service_role;

notify pgrst, 'reload schema';
