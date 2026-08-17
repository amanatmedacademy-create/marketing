create table if not exists public.imds_auth_oauth_states (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('google')),
  state_hash text not null unique,
  return_to text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz
);
create index if not exists imds_auth_oauth_states_active_idx
  on public.imds_auth_oauth_states(provider, expires_at)
  where consumed_at is null;

revoke all on public.imds_auth_oauth_states from anon, authenticated;
grant all on public.imds_auth_oauth_states to service_role;

notify pgrst, 'reload schema';
