-- Воронка Продаж: порт CRM-модуля (РОП workspace) из МИС.
-- Лиды воронки, журнал действий и настраиваемые канбан-доски.
-- Контакты берутся из marketing_leads, сотрудники — из marketing_users.

create table if not exists public.sales_funnel_leads (
  id text primary key,
  contact_id uuid references public.marketing_leads(id) on delete set null,
  full_name text not null,
  phone text,
  diagnosis text,
  source text not null default 'Маркетинг',
  priority text not null default 'MEDIUM' check (priority in ('LOW','MEDIUM','HIGH','URGENT')),
  stage text not null default 'NEW' check (stage in ('NEW','QUALIFICATION','APPOINTMENT','DIAGNOSTIC','COURSE','LOST')),
  diagnost_user_id uuid references public.marketing_users(id) on delete set null,
  manager_user_id uuid references public.marketing_users(id) on delete set null,
  amount numeric(14,2) not null default 0,
  paid boolean not null default false,
  whatsapp_count integer not null default 0,
  lost_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz
);

create table if not exists public.sales_funnel_activities (
  id text primary key,
  lead_id text not null references public.sales_funnel_leads(id) on delete cascade,
  type text not null,
  title text not null,
  details jsonb not null default '{}'::jsonb,
  actor_user_id uuid references public.marketing_users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.sales_funnel_boards (
  id text primary key,
  name text not null,
  description text,
  columns jsonb not null default '[]'::jsonb,
  filters jsonb not null default '{}'::jsonb,
  show_totals boolean not null default true,
  is_default boolean not null default false,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sales_funnel_boards_name_check check (length(trim(name)) between 1 and 120),
  constraint sales_funnel_boards_columns_array_check check (jsonb_typeof(columns) = 'array'),
  constraint sales_funnel_boards_filters_object_check check (jsonb_typeof(filters) = 'object')
);

create index if not exists sales_funnel_leads_stage_updated_idx
  on public.sales_funnel_leads (stage, updated_at desc);
create index if not exists sales_funnel_leads_manager_idx
  on public.sales_funnel_leads (manager_user_id);
create index if not exists sales_funnel_leads_diagnost_idx
  on public.sales_funnel_leads (diagnost_user_id);
create index if not exists sales_funnel_leads_updated_id_idx
  on public.sales_funnel_leads (updated_at desc, id desc);
create index if not exists sales_funnel_activities_lead_created_idx
  on public.sales_funnel_activities (lead_id, created_at desc);
create index if not exists sales_funnel_boards_active_order_idx
  on public.sales_funnel_boards (is_active, sort_order, created_at);

-- Одна основная доска.
create unique index if not exists sales_funnel_boards_one_default_idx
  on public.sales_funnel_boards ((true))
  where is_default = true and is_active = true;

-- Ускорение серверного поиска (как в МИС): trigram-индексы.
create extension if not exists pg_trgm;

create index if not exists sales_funnel_leads_full_name_trgm_idx
  on public.sales_funnel_leads using gin (lower(full_name) gin_trgm_ops);
create index if not exists sales_funnel_leads_phone_trgm_idx
  on public.sales_funnel_leads using gin (phone gin_trgm_ops)
  where phone is not null;
create index if not exists sales_funnel_leads_diagnosis_trgm_idx
  on public.sales_funnel_leads using gin (lower(diagnosis) gin_trgm_ops)
  where diagnosis is not null;
create index if not exists sales_funnel_leads_source_trgm_idx
  on public.sales_funnel_leads using gin (lower(source) gin_trgm_ops);
create index if not exists marketing_leads_name_trgm_idx
  on public.marketing_leads using gin (lower(name) gin_trgm_ops);

-- Точные KPI воронки: фронтенд не должен считать итоги по странице канбана.
create or replace function public.marketing_funnel_stats()
returns jsonb
language sql
stable
set search_path = public
as $$
  select jsonb_build_object(
    'total', count(*),
    'open', count(*) filter (where stage not in ('COURSE', 'LOST')),
    'won', count(*) filter (where stage = 'COURSE'),
    'lost', count(*) filter (where stage = 'LOST'),
    'courseAmount', coalesce(sum(amount) filter (where stage = 'COURSE'), 0),
    'byStage', jsonb_build_object(
      'NEW', count(*) filter (where stage = 'NEW'),
      'QUALIFICATION', count(*) filter (where stage = 'QUALIFICATION'),
      'APPOINTMENT', count(*) filter (where stage = 'APPOINTMENT'),
      'DIAGNOSTIC', count(*) filter (where stage = 'DIAGNOSTIC'),
      'COURSE', count(*) filter (where stage = 'COURSE'),
      'LOST', count(*) filter (where stage = 'LOST')
    )
  )
  from public.sales_funnel_leads;
$$;

revoke all on function public.marketing_funnel_stats() from public, anon, authenticated;
grant execute on function public.marketing_funnel_stats() to service_role;

-- Привязка лидов воронки к контактам marketing_leads по нормализованному телефону.
-- Связывает только однозначные совпадения (ровно один контакт на номер),
-- возвращает количество обновлённых строк — записи наружу не отдаёт.
create or replace function public.marketing_funnel_reconcile_contacts()
returns integer
language sql
volatile
set search_path = public
as $$
  with contact_phones as (
    select
      id,
      case
        when digits ~ '^8\d{10}$' then '7' || substr(digits, 2)
        when length(digits) = 10 then '7' || digits
        else digits
      end as normalized
    from (
      select id, regexp_replace(phone, '\D', '', 'g') as digits
      from public.marketing_leads
      where phone is not null
    ) raw
    where length(digits) >= 10
  ),
  unique_contacts as (
    select normalized, max(id::text)::uuid as contact_id
    from contact_phones
    group by normalized
    having count(*) = 1
  ),
  lead_phones as (
    select
      id,
      case
        when digits ~ '^8\d{10}$' then '7' || substr(digits, 2)
        when length(digits) = 10 then '7' || digits
        else digits
      end as normalized
    from (
      select id, regexp_replace(phone, '\D', '', 'g') as digits
      from public.sales_funnel_leads
      where contact_id is null and phone is not null
    ) raw
    where length(digits) >= 10
  ),
  updated as (
    update public.sales_funnel_leads lead
    set contact_id = unique_contacts.contact_id
    from lead_phones
    join unique_contacts on unique_contacts.normalized = lead_phones.normalized
    where lead.id = lead_phones.id
    returning lead.id
  )
  select count(*)::integer from updated;
$$;

revoke all on function public.marketing_funnel_reconcile_contacts() from public, anon, authenticated;
grant execute on function public.marketing_funnel_reconcile_contacts() to service_role;

alter table public.sales_funnel_leads enable row level security;
alter table public.sales_funnel_activities enable row level security;
alter table public.sales_funnel_boards enable row level security;
