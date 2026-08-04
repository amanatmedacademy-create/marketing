create table if not exists public.marketing_oauth_connections (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.crm_companies(id) on delete cascade,
  provider text not null check (provider in ('tiktok_ads', 'google_ads')),
  status text not null default 'connected' check (status in ('connected', 'expired', 'error', 'disabled')),
  external_user_id text,
  token_payload text not null,
  token_type text,
  scopes text[] not null default '{}'::text[],
  accounts jsonb not null default '[]'::jsonb,
  expires_at timestamptz,
  refresh_expires_at timestamptz,
  last_error text,
  connected_by uuid not null,
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, provider)
);

create table if not exists public.marketing_oauth_states (
  id uuid primary key default gen_random_uuid(),
  state_hash text not null unique,
  company_id uuid not null references public.crm_companies(id) on delete cascade,
  user_id uuid not null,
  provider text not null check (provider in ('tiktok_ads', 'google_ads')),
  redirect_uri text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists marketing_oauth_connections_company_provider_idx
  on public.marketing_oauth_connections (company_id, provider, status);
create index if not exists marketing_oauth_states_expiry_idx
  on public.marketing_oauth_states (expires_at);

alter table public.marketing_oauth_connections enable row level security;
alter table public.marketing_oauth_states enable row level security;

revoke all on public.marketing_oauth_connections from anon, authenticated;
revoke all on public.marketing_oauth_states from anon, authenticated;
grant all on public.marketing_oauth_connections to service_role;
grant all on public.marketing_oauth_states to service_role;

comment on table public.marketing_oauth_connections is 'Server-only encrypted OAuth tokens and authorized advertising accounts for marketing providers.';
comment on table public.marketing_oauth_states is 'Short-lived single-use OAuth state records used to bind provider callbacks to an authenticated tenant.';
