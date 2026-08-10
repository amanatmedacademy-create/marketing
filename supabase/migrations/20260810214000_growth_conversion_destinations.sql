create table public.growth_conversion_destinations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.crm_companies(id) on delete cascade,
  provider text not null check (provider in ('meta','google','tiktok')),
  external_destination_id text not null,
  enabled boolean not null default true,
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id, provider)
);

create index growth_conversion_destinations_company_idx
  on public.growth_conversion_destinations(company_id);

alter table public.growth_conversion_destinations enable row level security;
revoke all on public.growth_conversion_destinations from anon, authenticated;
grant select, insert, update, delete on public.growth_conversion_destinations to service_role;
