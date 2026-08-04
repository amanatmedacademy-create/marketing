create table if not exists public.reporting_templates (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.crm_companies(id) on delete cascade,
  target_type text not null check (target_type in ('reports', 'dashboards')),
  name text not null,
  description text,
  category text not null default 'custom',
  config jsonb not null default '{}'::jsonb,
  is_default boolean not null default false,
  created_by uuid references public.marketing_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, target_type, name)
);

create table if not exists public.reporting_reports (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.crm_companies(id) on delete cascade,
  client_id uuid not null references public.marketing_clients(id) on delete cascade,
  template_id uuid references public.reporting_templates(id) on delete set null,
  title text not null,
  report_type text not null default 'custom',
  status text not null default 'active' check (status in ('active', 'archived')),
  schedule_status text not null default 'active' check (schedule_status in ('active', 'paused')),
  schedule jsonb not null default '{"frequency":"monthly","timezone":"Asia/Almaty"}'::jsonb,
  email_subject text,
  email_message text,
  config jsonb not null default '{}'::jsonb,
  deleted_at timestamptz,
  created_by uuid references public.marketing_users(id) on delete set null,
  updated_by uuid references public.marketing_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.reporting_dashboard_sections (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.crm_companies(id) on delete cascade,
  client_id uuid not null references public.marketing_clients(id) on delete cascade,
  template_id uuid references public.reporting_templates(id) on delete set null,
  title text not null,
  dashboard_type text not null default 'custom',
  status text not null default 'active' check (status in ('active', 'archived')),
  config jsonb not null default '{}'::jsonb,
  deleted_at timestamptz,
  created_by uuid references public.marketing_users(id) on delete set null,
  updated_by uuid references public.marketing_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.bulk_operations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.crm_companies(id) on delete cascade,
  target_type text not null check (target_type in ('reports', 'dashboards')),
  action text not null check (action in ('add', 'apply_template', 'download', 'remove', 'edit_email', 'edit_schedule')),
  status text not null default 'queued' check (status in ('queued', 'running', 'completed', 'partial', 'failed', 'cancelled')),
  total_items integer not null default 0,
  processed_items integer not null default 0,
  succeeded_items integer not null default 0,
  failed_items integer not null default 0,
  parameters jsonb not null default '{}'::jsonb,
  output jsonb not null default '{}'::jsonb,
  error_message text,
  created_by uuid references public.marketing_users(id) on delete set null,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.bulk_operation_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.crm_companies(id) on delete cascade,
  operation_id uuid not null references public.bulk_operations(id) on delete cascade,
  target_type text not null check (target_type in ('client', 'report', 'dashboard')),
  target_id uuid not null,
  target_name text not null,
  status text not null default 'pending' check (status in ('pending', 'running', 'completed', 'failed', 'skipped')),
  result jsonb not null default '{}'::jsonb,
  error_message text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists reporting_templates_company_type_idx
  on public.reporting_templates (company_id, target_type, created_at desc);
create index if not exists reporting_reports_company_client_idx
  on public.reporting_reports (company_id, client_id, status, created_at desc)
  where deleted_at is null;
create index if not exists reporting_dashboard_sections_company_client_idx
  on public.reporting_dashboard_sections (company_id, client_id, status, created_at desc)
  where deleted_at is null;
create index if not exists bulk_operations_company_created_idx
  on public.bulk_operations (company_id, created_at desc);
create index if not exists bulk_operation_items_operation_idx
  on public.bulk_operation_items (operation_id, status, created_at);

alter table public.reporting_templates enable row level security;
alter table public.reporting_reports enable row level security;
alter table public.reporting_dashboard_sections enable row level security;
alter table public.bulk_operations enable row level security;
alter table public.bulk_operation_items enable row level security;

revoke all on public.reporting_templates from anon, authenticated;
revoke all on public.reporting_reports from anon, authenticated;
revoke all on public.reporting_dashboard_sections from anon, authenticated;
revoke all on public.bulk_operations from anon, authenticated;
revoke all on public.bulk_operation_items from anon, authenticated;

grant all on public.reporting_templates to service_role;
grant all on public.reporting_reports to service_role;
grant all on public.reporting_dashboard_sections to service_role;
grant all on public.bulk_operations to service_role;
grant all on public.bulk_operation_items to service_role;

insert into public.marketing_clients (company_id, name, slug, status, currency, timezone)
select
  company.id,
  company.name,
  'primary-' || left(company.id::text, 8),
  'active',
  'KZT',
  'Asia/Almaty'
from public.crm_companies company
where not exists (
  select 1 from public.marketing_clients client where client.company_id = company.id
)
on conflict (company_id, slug) do nothing;

insert into public.reporting_templates (company_id, target_type, name, description, category, config, is_default, created_by)
select
  company.id,
  template.target_type,
  template.name,
  template.description,
  template.category,
  template.config,
  true,
  owner.user_id
from public.crm_companies company
cross join (values
  ('reports', 'Ежемесячный маркетинговый отчёт', 'Расход, показы, клики, лиды, CPL, продажи и ROAS.', 'paid-media', '{"layout":"monthly-marketing","widgets":["spend","impressions","clicks","leads","cpl","sales","roas"]}'::jsonb),
  ('reports', 'Executive Summary', 'Краткий управленческий отчёт для собственника.', 'executive', '{"layout":"executive-summary","widgets":["spend","revenue","sales","cac","roas"]}'::jsonb),
  ('dashboards', 'Paid Media Dashboard', 'Операционный dashboard по Meta Ads и TikTok Ads.', 'paid-media', '{"layout":"paid-media-dashboard","widgets":["accounts","campaigns","spend-trend","cpl-trend"]}'::jsonb),
  ('dashboards', 'Client Overview', 'Общий обзор показателей клиента.', 'overview', '{"layout":"client-overview","widgets":["channels","leads","sales","revenue"]}'::jsonb)
) as template(target_type, name, description, category, config)
left join lateral (
  select member.user_id
  from public.crm_company_members member
  where member.company_id = company.id and member.status = 'active'
  order by case when member.role = 'owner' then 0 else 1 end, member.created_at asc
  limit 1
) owner on true
on conflict (company_id, target_type, name) do nothing;

insert into public.platform_modules (id, name, description, category, route, navigation_label, navigation_order, metadata)
values (
  'operations.bulk',
  'Bulk Operations',
  'Массовое управление отчётами, dashboard sections, расписаниями и сообщениями.',
  'operations',
  '/bulk-operations',
  'Bulk Operations',
  120,
  '{"source":"imds-local","version":"1.0.0"}'::jsonb
)
on conflict (id) do update set
  name = excluded.name,
  description = excluded.description,
  category = excluded.category,
  route = excluded.route,
  navigation_label = excluded.navigation_label,
  navigation_order = excluded.navigation_order,
  metadata = excluded.metadata,
  updated_at = now();

insert into public.platform_capabilities (id, module_id, description)
values
  ('bulk_operations.read', 'operations.bulk', 'Просмотр массовых операций'),
  ('bulk_operations.execute', 'operations.bulk', 'Запуск массовых операций'),
  ('bulk_operations.remove', 'operations.bulk', 'Массовое удаление отчётов и dashboard sections')
on conflict (id) do update set module_id = excluded.module_id, description = excluded.description;

insert into public.platform_product_modules (product_id, module_id, enabled_by_default)
values ('imds_marketing', 'operations.bulk', true)
on conflict (product_id, module_id) do update set enabled_by_default = true;

insert into public.platform_company_entitlements (company_id, entitlement_type, entitlement_id)
select id, 'module', 'operations.bulk' from public.crm_companies
on conflict (company_id, entitlement_type, entitlement_id) do nothing;

comment on table public.bulk_operations is 'Tenant-scoped asynchronous bulk actions for reports and dashboard sections.';
comment on table public.bulk_operation_items is 'Per-target execution log and retry state for each bulk operation.';
