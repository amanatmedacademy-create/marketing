-- IMDS Account security: email verification, TOTP MFA, recovery codes and security events.
alter table public.imds_auth_users
  add column if not exists mfa_enabled boolean not null default false,
  add column if not exists email_verified_at timestamptz;

update public.imds_auth_users
set email_verified_at = coalesce(email_verified_at, updated_at, created_at)
where email_verified = true and email_verified_at is null;

create table if not exists public.imds_auth_mfa_factors (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.imds_auth_users(id) on delete cascade,
  factor_type text not null default 'totp' check (factor_type = 'totp'),
  secret_ciphertext text not null,
  iv text not null,
  status text not null default 'pending' check (status in ('pending','verified','disabled')),
  last_used_step bigint,
  verified_at timestamptz,
  disabled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.imds_auth_mfa_recovery_codes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.imds_auth_users(id) on delete cascade,
  code_hash text not null,
  used_at timestamptz,
  created_at timestamptz not null default now(),
  unique(user_id, code_hash)
);
create index if not exists imds_auth_mfa_recovery_user_idx on public.imds_auth_mfa_recovery_codes(user_id, used_at);

create table if not exists public.imds_auth_mfa_challenges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.imds_auth_users(id) on delete cascade,
  token_hash text not null unique,
  provider text not null check (provider in ('password','google')),
  remember_me boolean not null default true,
  attempts integer not null default 0 check (attempts >= 0),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  user_agent text,
  ip_hash text,
  created_at timestamptz not null default now()
);
create index if not exists imds_auth_mfa_challenge_user_idx on public.imds_auth_mfa_challenges(user_id, expires_at desc);

create table if not exists public.imds_auth_email_verifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.imds_auth_users(id) on delete cascade,
  email text not null,
  token_hash text not null unique,
  attempts integer not null default 0 check (attempts >= 0),
  expires_at timestamptz not null,
  sent_at timestamptz,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists imds_auth_email_verification_user_idx on public.imds_auth_email_verifications(user_id, expires_at desc);

create table if not exists public.imds_auth_security_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.imds_auth_users(id) on delete cascade,
  event_type text not null,
  result text not null default 'success' check (result in ('success','failed','blocked','info')),
  ip_hash text,
  user_agent text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists imds_auth_security_events_user_idx on public.imds_auth_security_events(user_id, created_at desc);

alter table public.imds_auth_mfa_factors enable row level security;
alter table public.imds_auth_mfa_recovery_codes enable row level security;
alter table public.imds_auth_mfa_challenges enable row level security;
alter table public.imds_auth_email_verifications enable row level security;
alter table public.imds_auth_security_events enable row level security;

revoke all on public.imds_auth_mfa_factors, public.imds_auth_mfa_recovery_codes,
  public.imds_auth_mfa_challenges, public.imds_auth_email_verifications,
  public.imds_auth_security_events from anon, authenticated;
grant all on public.imds_auth_mfa_factors, public.imds_auth_mfa_recovery_codes,
  public.imds_auth_mfa_challenges, public.imds_auth_email_verifications,
  public.imds_auth_security_events to service_role;

notify pgrst,'reload schema';
