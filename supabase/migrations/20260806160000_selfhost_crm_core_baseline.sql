create extension if not exists pgcrypto;

-- Production CRM core existed before the checked-in funnel migration, but the
-- original CREATE migration is absent from repository history. Reconstruct the
-- normalized core idempotently so a clean self-hosted PostgreSQL replay matches
-- the live production contract.

alter table public.marketing_users
  add column if not exists first_name text,
  add column if not exists last_name text,
  add column if not exists full_name text,
  add column if not exists phone text;

alter table public.crm_companies
  add column if not exists slug text,
  add column if not exists timezone text not null default 'Asia/Almaty',
  add column if not exists currency text not null default 'KZT',
  add column if not exists created_by uuid;

do $$
begin
  if not exists (select 1 from pg_constraint where conname='crm_companies_name_check' and conrelid='public.crm_companies'::regclass) then
    alter table public.crm_companies add constraint crm_companies_name_check check (char_length(name) >= 2 and char_length(name) <= 150);
  end if;
  if not exists (select 1 from pg_constraint where conname='crm_companies_slug_key' and conrelid='public.crm_companies'::regclass) then
    alter table public.crm_companies add constraint crm_companies_slug_key unique (slug);
  end if;
  if not exists (select 1 from pg_constraint where conname='crm_companies_created_by_fkey' and conrelid='public.crm_companies'::regclass) then
    alter table public.crm_companies add constraint crm_companies_created_by_fkey foreign key (created_by) references public.marketing_users(id) on delete restrict;
  end if;
end $$;
create index if not exists crm_companies_created_by_idx on public.crm_companies(created_by);

create table if not exists public.crm_company_members (
  company_id uuid not null references public.crm_companies(id) on delete cascade,
  user_id uuid not null references public.marketing_users(id) on delete cascade,
  role text not null default 'manager' check (role in ('owner','administrator','manager','viewer')),
  status text not null default 'active' check (status in ('active','invited','blocked')),
  created_at timestamptz not null default now(),
  primary key (company_id, user_id)
);
create index if not exists crm_company_members_user_id_idx on public.crm_company_members(user_id);

create table if not exists public.crm_pipelines (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.crm_companies(id) on delete cascade,
  name text not null,
  is_default boolean not null default false,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists crm_pipelines_id_company_uidx on public.crm_pipelines(id, company_id);
create unique index if not exists crm_one_default_pipeline_per_company on public.crm_pipelines(company_id) where is_default = true;

create table if not exists public.crm_pipeline_stages (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.crm_companies(id) on delete cascade,
  pipeline_id uuid not null,
  name text not null,
  color text not null default '#64748B',
  position integer not null default 0,
  probability integer not null default 0 check (probability >= 0 and probability <= 100),
  stage_type text not null default 'open' check (stage_type in ('open','won','lost')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (pipeline_id, position),
  constraint crm_pipeline_stages_pipeline_company_fkey foreign key (pipeline_id, company_id)
    references public.crm_pipelines(id, company_id) on delete cascade
);
create index if not exists crm_pipeline_stages_company_id_idx on public.crm_pipeline_stages(company_id);
create unique index if not exists crm_pipeline_stages_id_company_uidx on public.crm_pipeline_stages(id, company_id);
create index if not exists crm_pipeline_stages_pipeline_company_idx on public.crm_pipeline_stages(pipeline_id, company_id);

create table if not exists public.crm_contacts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.crm_companies(id) on delete cascade,
  first_name text not null,
  last_name text,
  phone text,
  email text,
  source text,
  created_by uuid references public.marketing_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (company_id, id)
);
create unique index if not exists crm_contacts_id_company_uidx on public.crm_contacts(id, company_id);
create index if not exists crm_contacts_company_phone_idx on public.crm_contacts(company_id, phone);
create index if not exists crm_contacts_company_email_idx on public.crm_contacts(company_id, email);
create index if not exists crm_contacts_created_by_idx on public.crm_contacts(created_by);
create unique index if not exists crm_contacts_company_active_phone_uidx on public.crm_contacts(company_id, phone)
  where deleted_at is null and phone is not null and phone <> '';
create unique index if not exists crm_contacts_company_active_email_uidx on public.crm_contacts(company_id, lower(btrim(email)))
  where deleted_at is null and email is not null and btrim(email) <> '';

alter table public.marketing_leads
  add column if not exists crm_deal_id uuid,
  add column if not exists crm_contact_id uuid;

create table if not exists public.crm_deals (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.crm_companies(id) on delete cascade,
  pipeline_id uuid not null,
  stage_id uuid not null,
  contact_id uuid,
  assignee_id uuid references public.marketing_users(id) on delete set null,
  title text not null,
  phone text,
  email text,
  source text,
  amount numeric not null default 0,
  currency text not null default 'KZT',
  status text not null default 'open' check (status in ('open','won','lost','archived')),
  position numeric not null default 1024,
  created_by uuid references public.marketing_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  won_at timestamptz,
  lost_at timestamptz,
  deleted_at timestamptz,
  marketing_lead_id uuid references public.marketing_leads(id) on delete set null,
  diagnost_user_id uuid references public.marketing_users(id) on delete set null,
  priority text not null default 'MEDIUM' check (priority in ('LOW','MEDIUM','HIGH','URGENT')),
  description text,
  lost_reason text,
  next_action text,
  next_action_at timestamptz,
  stage_entered_at timestamptz not null default now(),
  paid boolean not null default false,
  constraint crm_deals_pipeline_company_fkey foreign key (pipeline_id, company_id)
    references public.crm_pipelines(id, company_id) on delete cascade,
  constraint crm_deals_stage_company_fkey foreign key (stage_id, company_id)
    references public.crm_pipeline_stages(id, company_id) on delete restrict,
  constraint crm_deals_contact_company_fkey foreign key (contact_id, company_id)
    references public.crm_contacts(id, company_id) on delete set null (contact_id)
);
create unique index if not exists crm_deals_id_company_uidx on public.crm_deals(id, company_id);
create index if not exists crm_deals_pipeline_id_idx on public.crm_deals(pipeline_id);
create index if not exists crm_deals_stage_id_idx on public.crm_deals(stage_id);
create index if not exists crm_deals_contact_id_idx on public.crm_deals(contact_id);
create index if not exists crm_deals_assignee_id_idx on public.crm_deals(assignee_id);
create index if not exists crm_deals_created_by_idx on public.crm_deals(created_by);
create index if not exists crm_deals_board_idx on public.crm_deals(company_id, pipeline_id, stage_id, position) where deleted_at is null;

create index if not exists marketing_leads_company_deal_idx on public.marketing_leads(company_id, crm_deal_id);
create index if not exists marketing_leads_company_contact_idx on public.marketing_leads(company_id, crm_contact_id);
create unique index if not exists marketing_leads_id_company_uidx on public.marketing_leads(id, company_id);

-- Add circular CRM links after both sides exist.
do $$
begin
  if not exists (select 1 from pg_constraint where conname='marketing_leads_crm_deal_company_fkey' and conrelid='public.marketing_leads'::regclass) then
    alter table public.marketing_leads add constraint marketing_leads_crm_deal_company_fkey
      foreign key (crm_deal_id, company_id) references public.crm_deals(id, company_id) on delete set null (crm_deal_id);
  end if;
  if not exists (select 1 from pg_constraint where conname='marketing_leads_crm_contact_company_fkey' and conrelid='public.marketing_leads'::regclass) then
    alter table public.marketing_leads add constraint marketing_leads_crm_contact_company_fkey
      foreign key (crm_contact_id, company_id) references public.crm_contacts(id, company_id) on delete set null (crm_contact_id);
  end if;
end $$;

create schema if not exists private;
create or replace function private.current_marketing_user_id()
returns uuid
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select mu.id
  from public.marketing_users mu
  where mu.auth_user_id = (select auth.uid())
    and mu.status = 'active'
  limit 1
$$;

create or replace function private.is_company_member(target_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, private
as $$
  select exists (
    select 1 from public.crm_company_members ccm
    where ccm.company_id = target_company_id
      and ccm.user_id = private.current_marketing_user_id()
      and ccm.status = 'active'
  )
$$;

create or replace function public.current_marketing_user_id()
returns uuid language sql stable set search_path = pg_catalog, private
as $$ select private.current_marketing_user_id() $$;

create or replace function public.is_company_member(target_company_id uuid)
returns boolean language sql stable set search_path = pg_catalog, private
as $$ select private.is_company_member(target_company_id) $$;

revoke all on function private.current_marketing_user_id() from public, anon, authenticated;
revoke all on function private.is_company_member(uuid) from public, anon, authenticated;
grant execute on function public.current_marketing_user_id() to authenticated, service_role;
grant execute on function public.is_company_member(uuid) to authenticated, service_role;

alter table public.crm_companies enable row level security;
alter table public.crm_company_members enable row level security;
alter table public.crm_pipelines enable row level security;
alter table public.crm_pipeline_stages enable row level security;
alter table public.crm_contacts enable row level security;
alter table public.crm_deals enable row level security;

grant all on public.crm_companies, public.crm_company_members, public.crm_pipelines,
  public.crm_pipeline_stages, public.crm_contacts, public.crm_deals to service_role;

notify pgrst, 'reload schema';
