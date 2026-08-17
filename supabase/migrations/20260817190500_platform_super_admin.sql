alter table public.imds_auth_users
  add column if not exists platform_role text not null default 'user';

alter table public.imds_auth_users
  drop constraint if exists imds_auth_users_platform_role_check;

alter table public.imds_auth_users
  add constraint imds_auth_users_platform_role_check
  check (platform_role in ('user', 'super_admin'));

update public.imds_auth_users
set platform_role = 'super_admin', updated_at = now()
where lower(btrim(email)) = 'admin@imds.kz';

create index if not exists imds_auth_users_platform_role_idx
  on public.imds_auth_users(platform_role)
  where platform_role = 'super_admin';

notify pgrst, 'reload schema';
