create extension if not exists pgcrypto;

-- Historical production received the tenant backbone before the legacy
-- integration-context migration. A clean PostgreSQL replay needs the same
-- prerequisites explicitly because that intermediate migration is absent.
create table if not exists public.crm_companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.integration_credentials
  add column if not exists id uuid default gen_random_uuid(),
  add column if not exists user_id uuid,
  add column if not exists company_id uuid;

-- Old revisions used provider as the primary key. Tenant-scoped credentials
-- need a stable row id and allow the same provider in different companies.
do $$
declare
  pk_name text;
  pk_columns text;
begin
  select con.conname,
         pg_get_constraintdef(con.oid)
    into pk_name, pk_columns
  from pg_constraint con
  where con.conrelid = 'public.integration_credentials'::regclass
    and con.contype = 'p'
  limit 1;

  if pk_name is not null and pk_columns <> 'PRIMARY KEY (id)' then
    execute format('alter table public.integration_credentials drop constraint %I', pk_name);
  end if;

  if not exists (
    select 1 from pg_constraint con
    where con.conrelid = 'public.integration_credentials'::regclass
      and con.contype = 'p'
  ) then
    alter table public.integration_credentials alter column id set not null;
    alter table public.integration_credentials add primary key (id);
  end if;
end;
$$;

alter table public.integration_runs add column if not exists company_id uuid;
alter table public.integration_events add column if not exists company_id uuid;
alter table public.marketing_leads add column if not exists company_id uuid;
alter table public.marketing_ads add column if not exists company_id uuid;
alter table public.marketing_daily_metrics add column if not exists company_id uuid;
alter table public.marketing_calls add column if not exists company_id uuid;

create index if not exists integration_credentials_company_id_idx
  on public.integration_credentials (company_id);
create index if not exists integration_credentials_user_id_idx
  on public.integration_credentials (user_id);

notify pgrst, 'reload schema';
