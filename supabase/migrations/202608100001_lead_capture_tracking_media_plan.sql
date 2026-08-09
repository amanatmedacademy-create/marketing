create extension if not exists pgcrypto;

create table if not exists public.marketing_lead_forms (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.crm_companies(id) on delete cascade default private.resolve_single_company_id(),
  name text not null,
  public_token text not null unique default encode(gen_random_bytes(18), 'hex'),
  status text not null default 'active' check (status in ('active','inactive')),
  source text,
  campaign text,
  success_message text not null default 'Спасибо! Мы свяжемся с вами.',
  fields jsonb not null default '[{"key":"name","label":"Имя","required":true},{"key":"phone","label":"Телефон","required":true},{"key":"email","label":"Email","required":false}]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.marketing_tracking_links (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.crm_companies(id) on delete cascade default private.resolve_single_company_id(),
  name text not null,
  destination_url text not null,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_content text,
  utm_term text,
  final_url text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.marketing_media_plan (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.crm_companies(id) on delete cascade default private.resolve_single_company_id(),
  month date not null,
  channel text not null,
  campaign text,
  planned_budget numeric(16,2) not null default 0,
  target_leads integer not null default 0,
  target_sales integer not null default 0,
  target_revenue numeric(16,2) not null default 0,
  owner text,
  status text not null default 'План' check (status in ('План','Активен','Закрыт')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists marketing_lead_forms_company_idx on public.marketing_lead_forms(company_id, status);
create index if not exists marketing_tracking_links_company_idx on public.marketing_tracking_links(company_id, created_at desc);
create index if not exists marketing_media_plan_company_month_idx on public.marketing_media_plan(company_id, month desc);

alter table public.marketing_lead_forms enable row level security;
alter table public.marketing_tracking_links enable row level security;
alter table public.marketing_media_plan enable row level security;

revoke all on public.marketing_lead_forms from anon, authenticated;
revoke all on public.marketing_tracking_links from anon, authenticated;
revoke all on public.marketing_media_plan from anon, authenticated;
grant all on public.marketing_lead_forms to service_role;
grant all on public.marketing_tracking_links to service_role;
grant all on public.marketing_media_plan to service_role;

notify pgrst, 'reload schema';
