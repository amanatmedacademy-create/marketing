create table if not exists public.meta_connections (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.crm_companies(id) on delete cascade,
  product text not null check (product in ('waba', 'ads')),
  status text not null default 'connected' check (status in ('connected', 'error', 'disconnected')),
  meta_user_id text,
  meta_user_name text,
  business_id text,
  waba_id text,
  phone_number_id text,
  ad_accounts jsonb not null default '[]'::jsonb,
  access_token text not null,
  token_type text not null default 'bearer',
  expires_at timestamptz,
  connected_by uuid references public.marketing_users(id) on delete set null,
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, product)
);

create index if not exists meta_connections_company_idx
  on public.meta_connections (company_id, product);

alter table public.meta_connections enable row level security;

revoke all on public.meta_connections from anon, authenticated;

grant all on public.meta_connections to service_role;

comment on table public.meta_connections is
  'Server-only Meta Login for Business connections. Access tokens are never exposed to browser clients.';
