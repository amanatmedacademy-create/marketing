alter table public.marketing_users
  add column if not exists auth_user_id uuid,
  add column if not exists avatar_url text,
  add column if not exists provider text not null default 'google',
  add column if not exists provider_metadata jsonb not null default '{}'::jsonb;

create unique index if not exists marketing_users_auth_user_uidx
  on public.marketing_users (auth_user_id)
  where auth_user_id is not null;

create index if not exists marketing_users_status_role_idx
  on public.marketing_users (status, role);

notify pgrst, 'reload schema';
