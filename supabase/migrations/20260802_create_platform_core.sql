create table if not exists public.platform_products (
  id text primary key,
  name text not null,
  description text,
  status text not null default 'active' check (status in ('active', 'inactive', 'deprecated')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.platform_modules (
  id text primary key,
  name text not null,
  description text,
  category text not null,
  route text,
  navigation_label text,
  navigation_order integer not null default 0,
  status text not null default 'active' check (status in ('active', 'inactive', 'deprecated')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.platform_capabilities (
  id text primary key,
  module_id text not null references public.platform_modules(id) on delete cascade,
  description text,
  created_at timestamptz not null default now()
);

create table if not exists public.platform_product_modules (
  product_id text not null references public.platform_products(id) on delete cascade,
  module_id text not null references public.platform_modules(id) on delete cascade,
  enabled_by_default boolean not null default true,
  limits jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  primary key (product_id, module_id)
);

create table if not exists public.platform_company_entitlements (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.crm_companies(id) on delete cascade,
  entitlement_type text not null check (entitlement_type in ('product', 'module', 'capability')),
  entitlement_id text not null,
  status text not null default 'active' check (status in ('active', 'suspended', 'expired', 'revoked')),
  limits jsonb not null default '{}'::jsonb,
  starts_at timestamptz not null default now(),
  expires_at timestamptz,
  granted_by uuid references public.marketing_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, entitlement_type, entitlement_id)
);

create index if not exists platform_entitlements_company_idx
  on public.platform_company_entitlements (company_id, status, entitlement_type);

alter table public.platform_products enable row level security;
alter table public.platform_modules enable row level security;
alter table public.platform_capabilities enable row level security;
alter table public.platform_product_modules enable row level security;
alter table public.platform_company_entitlements enable row level security;

revoke all on public.platform_products from anon, authenticated;
revoke all on public.platform_modules from anon, authenticated;
revoke all on public.platform_capabilities from anon, authenticated;
revoke all on public.platform_product_modules from anon, authenticated;
revoke all on public.platform_company_entitlements from anon, authenticated;

grant all on public.platform_products to service_role;
grant all on public.platform_modules to service_role;
grant all on public.platform_capabilities to service_role;
grant all on public.platform_product_modules to service_role;
grant all on public.platform_company_entitlements to service_role;

insert into public.platform_products (id, name, description, metadata)
values
  ('imds_marketing', 'IMDS Marketing', 'Маркетинг, CRM, коммуникации, реклама и сквозная аналитика.', '{"brand":"IMDS"}'::jsonb),
  ('imds_dashboard', 'IMDS Dashboard', 'Управленческие и операционные дашборды.', '{"brand":"IMDS"}'::jsonb),
  ('imds_contract', 'IMDS Contract', 'Договоры и документооборот.', '{"brand":"IMDS"}'::jsonb)
on conflict (id) do update set
  name = excluded.name,
  description = excluded.description,
  metadata = excluded.metadata,
  updated_at = now();

insert into public.platform_modules (id, name, description, category, route, navigation_label, navigation_order)
values
  ('dashboard', 'Dashboard', 'Главная аналитическая панель.', 'analytics', '/', 'Dashboard', 10),
  ('crm.deals', 'CRM Deals', 'Сделки, контакты, воронки и канбан.', 'crm', '/deals', 'Сделки', 20),
  ('work.tasks', 'Tasks', 'Задачи сотрудников.', 'work', '/tasks', 'Задачи', 30),
  ('work.projects', 'Projects', 'Проекты и элементы проектов.', 'work', '/projects', 'Проекты', 40),
  ('team', 'Team', 'Пользователи и роли компании.', 'platform', '/team', 'Команда', 50),
  ('accounting', 'Accounting', 'Бухгалтерия и финансовый контур.', 'finance', '/accounting', 'Бухгалтерия', 60),
  ('communications.whatsapp', 'WhatsApp', 'WhatsApp Business inbox и шаблоны.', 'communications', '/whatsapp', 'WhatsApp', 70),
  ('communications.instagram', 'Instagram', 'Instagram Direct и комментарии.', 'communications', '/instagram', 'Instagram', 80),
  ('communications.email', 'Email', 'Почта и история коммуникаций.', 'communications', '/email', 'Email', 90),
  ('advertising', 'Advertising', 'Рекламные кабинеты и показатели.', 'marketing', '/ads', 'Реклама', 100),
  ('analytics.attribution', 'Attribution Analytics', 'Сквозная аналитика и атрибуция.', 'analytics', '/analytics', 'Сквозная аналитика', 110),
  ('cloud', 'Cloud', 'Файлы и документы.', 'platform', '/cloud', 'Облако', 120),
  ('meetings', 'Video Meetings', 'Видеовстречи и онлайн-консультации.', 'communications', '/meetings', 'Видеовстречи', 130),
  ('integrations', 'Integrations', 'Подключение внешних сервисов.', 'platform', '/integrations', 'Интеграции', 140)
on conflict (id) do update set
  name = excluded.name,
  description = excluded.description,
  category = excluded.category,
  route = excluded.route,
  navigation_label = excluded.navigation_label,
  navigation_order = excluded.navigation_order,
  updated_at = now();

insert into public.platform_capabilities (id, module_id, description)
values
  ('crm.deals.read', 'crm.deals', 'Просмотр сделок'),
  ('crm.deals.create', 'crm.deals', 'Создание сделок'),
  ('crm.deals.update', 'crm.deals', 'Редактирование сделок'),
  ('crm.deals.delete', 'crm.deals', 'Удаление сделок'),
  ('crm.pipelines.manage', 'crm.deals', 'Управление воронками'),
  ('ads.insights.read', 'advertising', 'Просмотр рекламных показателей'),
  ('ads.sync.run', 'advertising', 'Запуск синхронизации рекламы'),
  ('integrations.meta.connect', 'integrations', 'Подключение Meta'),
  ('integrations.meta.disconnect', 'integrations', 'Отключение Meta'),
  ('analytics.read', 'analytics.attribution', 'Просмотр сквозной аналитики'),
  ('team.manage', 'team', 'Управление пользователями и ролями')
on conflict (id) do update set
  module_id = excluded.module_id,
  description = excluded.description;

insert into public.platform_product_modules (product_id, module_id, enabled_by_default)
select 'imds_marketing', id, true
from public.platform_modules
where id in (
  'dashboard','crm.deals','work.tasks','work.projects','team','accounting',
  'communications.whatsapp','communications.instagram','communications.email',
  'advertising','analytics.attribution','cloud','meetings','integrations'
)
on conflict (product_id, module_id) do nothing;

insert into public.platform_company_entitlements (company_id, entitlement_type, entitlement_id, limits)
select id, 'product', 'imds_marketing', '{"users":50,"pipelines":20,"adAccounts":20}'::jsonb
from public.crm_companies
on conflict (company_id, entitlement_type, entitlement_id) do nothing;

insert into public.platform_company_entitlements (company_id, entitlement_type, entitlement_id)
select c.id, 'module', pm.module_id
from public.crm_companies c
cross join public.platform_product_modules pm
where pm.product_id = 'imds_marketing' and pm.enabled_by_default = true
on conflict (company_id, entitlement_type, entitlement_id) do nothing;

comment on table public.platform_company_entitlements is
  'Server-managed products, modules and capabilities available to each tenant.';
