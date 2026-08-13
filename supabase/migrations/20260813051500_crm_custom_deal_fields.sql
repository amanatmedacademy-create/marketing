-- Admin-managed custom fields for CRM deals.
-- Definitions are company-scoped; values are stored separately per deal and stable field UUID.

create table if not exists public.crm_custom_field_definitions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.crm_companies(id) on delete cascade,
  entity_type text not null default 'deal',
  field_key text not null,
  label text not null,
  field_type text not null,
  options jsonb not null default '[]'::jsonb,
  is_required boolean not null default false,
  is_active boolean not null default true,
  position integer not null default 0,
  created_by uuid references public.marketing_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint crm_custom_field_definitions_entity_type_check
    check (entity_type in ('deal')),
  constraint crm_custom_field_definitions_type_check
    check (field_type in ('text','textarea','number','date','select','checkbox','phone','email')),
  constraint crm_custom_field_definitions_label_check
    check (char_length(btrim(label)) between 1 and 80),
  constraint crm_custom_field_definitions_options_check
    check (jsonb_typeof(options) = 'array'),
  unique (company_id, entity_type, field_key)
);

create index if not exists crm_custom_field_definitions_company_position_idx
  on public.crm_custom_field_definitions (company_id, entity_type, is_active, position, created_at);

create table if not exists public.crm_custom_field_values (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.crm_companies(id) on delete cascade,
  deal_id uuid not null references public.crm_deals(id) on delete cascade,
  field_id uuid not null references public.crm_custom_field_definitions(id) on delete cascade,
  value jsonb not null default 'null'::jsonb,
  updated_by uuid references public.marketing_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, deal_id, field_id)
);

create index if not exists crm_custom_field_values_deal_idx
  on public.crm_custom_field_values (company_id, deal_id, field_id);

alter table public.crm_custom_field_definitions enable row level security;
alter table public.crm_custom_field_values enable row level security;

drop policy if exists crm_custom_field_definitions_member_select on public.crm_custom_field_definitions;
create policy crm_custom_field_definitions_member_select
  on public.crm_custom_field_definitions
  for select to authenticated
  using ((select public.is_company_member(company_id)));

drop policy if exists crm_custom_field_values_member_select on public.crm_custom_field_values;
create policy crm_custom_field_values_member_select
  on public.crm_custom_field_values
  for select to authenticated
  using ((select public.is_company_member(company_id)));

-- Writes intentionally have no authenticated RLS policy. They are performed by the
-- server-side Worker with the service role after explicit role/company checks.
