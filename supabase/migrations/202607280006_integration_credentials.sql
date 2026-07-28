create table if not exists public.integration_credentials (
  provider text primary key check (provider in ('bitrix', 'meta', 'tiktok', 'n8n')),
  encrypted_payload text not null,
  iv text not null,
  config_summary jsonb not null default '{}'::jsonb,
  status text not null default 'configured',
  last_error text,
  last_verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists integration_credentials_set_updated_at on public.integration_credentials;
create trigger integration_credentials_set_updated_at
before update on public.integration_credentials
for each row execute function public.set_updated_at();

alter table public.integration_credentials enable row level security;
revoke all on public.integration_credentials from anon, authenticated;
grant all on public.integration_credentials to service_role;

notify pgrst, 'reload schema';
