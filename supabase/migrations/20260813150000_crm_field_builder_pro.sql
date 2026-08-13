-- Advanced company-scoped CRM deal field builder.
-- Adds sections, stage-aware requirements and field-level visibility/edit policies
-- without replacing existing custom-field definitions or values.

create table if not exists public.crm_custom_field_sections (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.crm_companies(id) on delete cascade,
  entity_type text not null default 'deal',
  name text not null,
  description text,
  position integer not null default 0,
  is_active boolean not null default true,
  created_by uuid references public.marketing_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint crm_custom_field_sections_entity_check check (entity_type = 'deal'),
  constraint crm_custom_field_sections_name_check check (char_length(btrim(name)) between 1 and 80)
);

create index if not exists crm_custom_field_sections_company_idx
  on public.crm_custom_field_sections (company_id, entity_type, is_active, position, created_at);

alter table public.crm_custom_field_definitions
  add column if not exists section_id uuid references public.crm_custom_field_sections(id) on delete set null,
  add column if not exists help_text text,
  add column if not exists visible_roles text[] not null default array['administrator','marketer','analyst','viewer']::text[],
  add column if not exists editable_roles text[] not null default array['administrator','marketer']::text[],
  add column if not exists required_stage_ids uuid[] not null default '{}'::uuid[],
  add column if not exists show_in_summary boolean not null default false,
  add column if not exists archived_at timestamptz;

alter table public.crm_custom_field_definitions
  drop constraint if exists crm_custom_field_definitions_visible_roles_check,
  add constraint crm_custom_field_definitions_visible_roles_check
    check (visible_roles <@ array['administrator','marketer','analyst','viewer']::text[]),
  drop constraint if exists crm_custom_field_definitions_editable_roles_check,
  add constraint crm_custom_field_definitions_editable_roles_check
    check (editable_roles <@ array['administrator','marketer','analyst','viewer']::text[]),
  drop constraint if exists crm_custom_field_definitions_help_text_check,
  add constraint crm_custom_field_definitions_help_text_check
    check (help_text is null or char_length(help_text) <= 300);

create index if not exists crm_custom_field_definitions_section_idx
  on public.crm_custom_field_definitions (company_id, entity_type, section_id, position)
  where archived_at is null;

alter table public.crm_custom_field_sections enable row level security;

drop policy if exists crm_custom_field_sections_member_select on public.crm_custom_field_sections;
create policy crm_custom_field_sections_member_select
  on public.crm_custom_field_sections
  for select to authenticated
  using ((select public.is_company_member(company_id)));

-- Enforce administrator-configured required fields on every stage transition.
-- This keeps the rule effective even when a deal is moved through an API/RPC rather than the UI.
create or replace function public.crm_enforce_required_custom_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  missing_labels text;
begin
  if new.stage_id is distinct from old.stage_id then
    select string_agg(d.label, ', ' order by d.position, d.created_at)
      into missing_labels
    from public.crm_custom_field_definitions d
    left join public.crm_custom_field_values v
      on v.company_id = new.company_id
     and v.deal_id = new.id
     and v.field_id = d.id
    where d.company_id = new.company_id
      and d.entity_type = 'deal'
      and d.is_active = true
      and d.archived_at is null
      and (d.is_required = true or new.stage_id = any(d.required_stage_ids))
      and (
        v.id is null
        or v.value is null
        or v.value = 'null'::jsonb
        or (jsonb_typeof(v.value) = 'string' and btrim(v.value #>> '{}') = '')
      );

    if missing_labels is not null then
      raise exception 'Заполните обязательные поля: %', missing_labels
        using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists crm_deals_required_custom_fields on public.crm_deals;
create trigger crm_deals_required_custom_fields
before update of stage_id on public.crm_deals
for each row execute function public.crm_enforce_required_custom_fields();

-- Writes remain server-side only after explicit company administrator checks.
