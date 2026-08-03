create table if not exists public.content_types (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.crm_companies(id) on delete cascade,
  api_id text not null,
  display_name text not null,
  description text,
  fields jsonb not null default '[]'::jsonb,
  icon text not null default 'file-text',
  draft_and_publish boolean not null default true,
  localized boolean not null default true,
  created_by uuid references public.marketing_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, api_id)
);

create table if not exists public.content_entries (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.crm_companies(id) on delete cascade,
  content_type_id uuid not null references public.content_types(id) on delete cascade,
  document_id uuid not null default gen_random_uuid(),
  locale text not null default 'ru',
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  title text not null,
  slug text not null,
  data jsonb not null default '{}'::jsonb,
  published_at timestamptz,
  created_by uuid references public.marketing_users(id) on delete set null,
  updated_by uuid references public.marketing_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, content_type_id, locale, slug),
  unique (document_id, locale)
);

create table if not exists public.content_entry_versions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.crm_companies(id) on delete cascade,
  entry_id uuid not null references public.content_entries(id) on delete cascade,
  version integer not null,
  status text not null,
  title text not null,
  slug text not null,
  data jsonb not null,
  created_by uuid references public.marketing_users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (entry_id, version)
);

create table if not exists public.content_media (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.crm_companies(id) on delete cascade,
  name text not null,
  url text not null,
  mime_type text,
  size_bytes bigint,
  alt_text jsonb not null default '{}'::jsonb,
  folder text not null default '/',
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references public.marketing_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists content_types_company_idx on public.content_types (company_id, updated_at desc);
create index if not exists content_entries_company_type_idx on public.content_entries (company_id, content_type_id, status, updated_at desc);
create index if not exists content_entries_document_idx on public.content_entries (document_id, locale);
create index if not exists content_versions_entry_idx on public.content_entry_versions (entry_id, version desc);
create index if not exists content_media_company_idx on public.content_media (company_id, folder, created_at desc);

alter table public.content_types enable row level security;
alter table public.content_entries enable row level security;
alter table public.content_entry_versions enable row level security;
alter table public.content_media enable row level security;

revoke all on public.content_types from anon, authenticated;
revoke all on public.content_entries from anon, authenticated;
revoke all on public.content_entry_versions from anon, authenticated;
revoke all on public.content_media from anon, authenticated;

grant all on public.content_types to service_role;
grant all on public.content_entries to service_role;
grant all on public.content_entry_versions to service_role;
grant all on public.content_media to service_role;

insert into public.platform_modules (id, name, description, category, route, navigation_label, navigation_order, metadata)
values (
  'content.studio',
  'IMDS Content Studio',
  'Управление типами контента, публикациями, языками, медиатекой и версиями.',
  'content',
  '/content/studio',
  'Контент',
  115,
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
  ('content.read', 'content.studio', 'Просмотр контента'),
  ('content.write', 'content.studio', 'Создание и редактирование контента'),
  ('content.publish', 'content.studio', 'Публикация контента'),
  ('content.schema.manage', 'content.studio', 'Управление типами контента'),
  ('content.media.manage', 'content.studio', 'Управление медиатекой')
on conflict (id) do update set module_id = excluded.module_id, description = excluded.description;

insert into public.platform_product_modules (product_id, module_id, enabled_by_default)
values ('imds_marketing', 'content.studio', true)
on conflict (product_id, module_id) do update set enabled_by_default = true;

insert into public.platform_company_entitlements (company_id, entitlement_type, entitlement_id)
select id, 'module', 'content.studio' from public.crm_companies
on conflict (company_id, entitlement_type, entitlement_id) do nothing;

insert into public.content_types (company_id, api_id, display_name, description, fields, icon, created_by)
select
  c.id,
  'article',
  'Статья',
  'Статьи, инструкции, новости и публикации.',
  '[{"name":"summary","label":"Краткое описание","type":"text","required":false},{"name":"body","label":"Содержание","type":"richtext","required":true},{"name":"coverUrl","label":"Обложка","type":"media","required":false},{"name":"seoTitle","label":"SEO title","type":"string","required":false},{"name":"seoDescription","label":"SEO description","type":"text","required":false}]'::jsonb,
  'newspaper',
  owner.user_id
from public.crm_companies c
left join lateral (
  select m.user_id from public.crm_company_members m
  where m.company_id = c.id and m.status = 'active'
  order by case when m.role = 'owner' then 0 else 1 end, m.created_at asc
  limit 1
) owner on true
on conflict (company_id, api_id) do nothing;

comment on table public.content_entries is 'Tenant-scoped content documents inspired by headless CMS workflows; not a Strapi fork.';