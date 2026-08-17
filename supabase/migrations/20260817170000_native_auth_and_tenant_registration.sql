create extension if not exists pgcrypto;

-- Native IMDS identity. This replaces the Supabase Auth dependency on the VPS.
create table if not exists public.imds_auth_users (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  display_name text not null,
  status text not null default 'active' check (status in ('active','blocked','disabled')),
  email_verified boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_login_at timestamptz
);
create unique index if not exists imds_auth_users_email_uidx on public.imds_auth_users(lower(btrim(email)));

create table if not exists public.imds_auth_passwords (
  user_id uuid primary key references public.imds_auth_users(id) on delete cascade,
  password_hash text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.imds_auth_identities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.imds_auth_users(id) on delete cascade,
  provider text not null check (provider in ('password','google')),
  provider_subject text not null,
  email text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, provider_subject)
);
create index if not exists imds_auth_identities_user_idx on public.imds_auth_identities(user_id);
create index if not exists imds_auth_identities_email_idx on public.imds_auth_identities(lower(btrim(email))) where email is not null;

create table if not exists public.imds_auth_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.imds_auth_users(id) on delete cascade,
  token_hash text not null unique,
  remember_me boolean not null default false,
  user_agent text,
  ip_hash text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz
);
create index if not exists imds_auth_sessions_user_idx on public.imds_auth_sessions(user_id, expires_at desc);
create index if not exists imds_auth_sessions_active_idx on public.imds_auth_sessions(expires_at) where revoked_at is null;

-- Per-company registration codes. Only the SHA-256 hash is stored.
create table if not exists public.crm_company_join_codes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.crm_companies(id) on delete cascade,
  code_hash text not null unique,
  label text,
  active boolean not null default true,
  expires_at timestamptz,
  max_uses integer check (max_uses is null or max_uses > 0),
  use_count integer not null default 0 check (use_count >= 0),
  created_by uuid references public.marketing_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists crm_company_join_codes_company_idx on public.crm_company_join_codes(company_id, active, created_at desc);

-- Employee registration request, modelled after IMDS MIS onboarding.
create table if not exists public.crm_company_onboarding (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.crm_companies(id) on delete cascade,
  user_id uuid not null references public.marketing_users(id) on delete cascade,
  status text not null default 'needs_profile' check (status in ('needs_profile','pending_approval','approved','rejected')),
  requested_role text not null default 'viewer' check (requested_role in ('administrator','manager','viewer')),
  full_name text,
  phone text,
  position text,
  notes text,
  profile jsonb not null default '{}'::jsonb,
  rejection_reason text,
  submitted_at timestamptz,
  reviewed_at timestamptz,
  reviewed_by uuid references public.marketing_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, user_id)
);
create index if not exists crm_company_onboarding_company_status_idx on public.crm_company_onboarding(company_id, status, created_at desc);
create index if not exists crm_company_onboarding_user_idx on public.crm_company_onboarding(user_id, updated_at desc);

-- Preserve current production Google users. Their existing auth_user_id remains
-- the stable local identity id, so marketing_users links do not need to change.
insert into public.imds_auth_users(id, email, display_name, status, email_verified, created_at, updated_at, last_login_at)
select
  mu.auth_user_id,
  lower(btrim(mu.email)),
  coalesce(nullif(btrim(mu.full_name),''), nullif(btrim(mu.name),''), split_part(mu.email,'@',1)),
  case when mu.status = 'blocked' then 'blocked' else 'active' end,
  true,
  mu.created_at,
  mu.updated_at,
  mu.last_seen_at
from public.marketing_users mu
where mu.auth_user_id is not null
on conflict (id) do update set
  email = excluded.email,
  display_name = excluded.display_name,
  status = excluded.status,
  updated_at = excluded.updated_at,
  last_login_at = excluded.last_login_at;

insert into public.imds_auth_identities(user_id, provider, provider_subject, email, metadata)
select
  mu.auth_user_id,
  'google',
  mu.auth_user_id::text,
  lower(btrim(mu.email)),
  coalesce(mu.provider_metadata, '{}'::jsonb) || jsonb_build_object('legacy_supabase_identity', true)
from public.marketing_users mu
where mu.auth_user_id is not null
on conflict (provider, provider_subject) do nothing;

revoke all on public.imds_auth_users, public.imds_auth_passwords, public.imds_auth_identities,
  public.imds_auth_sessions, public.crm_company_join_codes, public.crm_company_onboarding
from anon, authenticated;

grant all on public.imds_auth_users, public.imds_auth_passwords, public.imds_auth_identities,
  public.imds_auth_sessions, public.crm_company_join_codes, public.crm_company_onboarding
to service_role;

notify pgrst, 'reload schema';
