create extension if not exists pgcrypto;
create schema if not exists analytics;

create table if not exists analytics.agencies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  language text not null default 'ru',
  timezone text not null default 'Asia/Almaty',
  plan text not null default 'trial',
  trial_ends_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists analytics.users (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references analytics.agencies(id) on delete cascade,
  external_auth_id text not null,
  email text not null,
  name text not null,
  role text not null check (role in ('admin','staff','client')),
  status text not null default 'active',
  permissions_json jsonb not null default '{}'::jsonb,
  unique (agency_id, external_auth_id),
  unique (id, agency_id)
);

create table if not exists analytics.clients (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references analytics.agencies(id) on delete cascade,
  company text not null,
  url text,
  timezone text not null default 'Asia/Almaty',
  country text not null default 'KZ',
  language text not null default 'ru',
  logo_url text,
  brand_color text not null default '#0072EE',
  portal_subdomain text,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, agency_id)
);

create table if not exists analytics.client_users (
  agency_id uuid not null references analytics.agencies(id) on delete cascade,
  client_id uuid not null,
  user_id uuid not null,
  permissions_json jsonb not null default '{}'::jsonb,
  primary key (client_id, user_id),
  foreign key (client_id, agency_id) references analytics.clients(id, agency_id) on delete cascade,
  foreign key (user_id, agency_id) references analytics.users(id, agency_id) on delete cascade
);

create table if not exists analytics.integrations (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  category text not null,
  auth_type text not null check (auth_type in ('oauth2','api_key','basic','file')),
  is_beta boolean not null default false,
  badges text[] not null default '{}'
);

create table if not exists analytics.data_sources (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references analytics.agencies(id) on delete cascade,
  client_id uuid not null,
  integration_id uuid not null references analytics.integrations(id),
  label text not null,
  external_identifier text,
  credentials_encrypted bytea,
  status text not null default 'connected',
  last_sync_at timestamptz,
  sync_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (client_id, agency_id) references analytics.clients(id, agency_id) on delete cascade
);

create table if not exists analytics.sync_jobs (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references analytics.agencies(id) on delete cascade,
  data_source_id uuid not null references analytics.data_sources(id) on delete cascade,
  period_from date not null,
  period_to date not null,
  state text not null default 'queued',
  attempts integer not null default 0,
  payload jsonb not null default '{}'::jsonb,
  error_code text,
  error_message text,
  created_at timestamptz not null default now()
);

create table if not exists analytics.dashboards (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references analytics.agencies(id) on delete cascade,
  client_id uuid not null,
  name text not null,
  layout_json jsonb not null default '{}'::jsonb,
  position integer not null default 0,
  foreign key (client_id, agency_id) references analytics.clients(id, agency_id) on delete cascade
);

create table if not exists analytics.reports (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references analytics.agencies(id) on delete cascade,
  client_id uuid not null,
  name text not null,
  schedule_json jsonb not null default '{}'::jsonb,
  recipients_json jsonb not null default '[]'::jsonb,
  status text not null default 'draft',
  foreign key (client_id, agency_id) references analytics.clients(id, agency_id) on delete cascade
);

create table if not exists analytics.report_sections (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references analytics.agencies(id) on delete cascade,
  report_id uuid references analytics.reports(id) on delete cascade,
  dashboard_id uuid references analytics.dashboards(id) on delete cascade,
  title text not null,
  position integer not null default 0,
  check ((report_id is not null) <> (dashboard_id is not null))
);

create table if not exists analytics.widgets (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references analytics.agencies(id) on delete cascade,
  section_id uuid not null references analytics.report_sections(id) on delete cascade,
  type text not null,
  integration_slug text,
  metric_key text,
  dimension_key text,
  date_range_json jsonb not null default '{}'::jsonb,
  filters_json jsonb not null default '[]'::jsonb,
  settings_json jsonb not null default '{}'::jsonb,
  x integer not null default 0,
  y integer not null default 0,
  w integer not null default 4,
  h integer not null default 3
);

create table if not exists analytics.api_keys (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references analytics.agencies(id) on delete cascade,
  key_hash text not null unique,
  label text not null,
  scopes text[] not null default '{}',
  last_used_at timestamptz,
  revoked_at timestamptz
);

create table if not exists analytics.metric_definitions (
  key text primary key,
  label text not null,
  value_type text not null,
  aggregation text not null,
  format text not null,
  formula text,
  dependencies text[] not null default '{}'
);

create or replace function analytics.is_agency_member(p_subject text, p_agency_id uuid)
returns boolean language sql stable security definer set search_path = analytics, public as $$
  select exists(select 1 from analytics.users where agency_id=p_agency_id and external_auth_id=p_subject and status='active');
$$;

create or replace function analytics.resolve_api_key(p_key_hash text)
returns uuid language sql volatile security definer set search_path = analytics, public as $$
  update analytics.api_keys set last_used_at=now() where key_hash=p_key_hash and revoked_at is null returning agency_id;
$$;

alter table analytics.users enable row level security;
alter table analytics.clients enable row level security;
alter table analytics.client_users enable row level security;
alter table analytics.data_sources enable row level security;
alter table analytics.sync_jobs enable row level security;
alter table analytics.dashboards enable row level security;
alter table analytics.reports enable row level security;
alter table analytics.report_sections enable row level security;
alter table analytics.widgets enable row level security;
alter table analytics.api_keys enable row level security;

do $$ declare t text; begin
  foreach t in array array['users','clients','client_users','data_sources','sync_jobs','dashboards','reports','report_sections','widgets','api_keys'] loop
    execute format('create policy tenant_isolation on analytics.%I using (agency_id = nullif(current_setting(''app.agency_id'', true), '''')::uuid) with check (agency_id = nullif(current_setting(''app.agency_id'', true), '''')::uuid)', t);
  end loop;
end $$;

insert into analytics.integrations(slug,name,category,auth_type,badges) values
 ('google-ads','Google Ads','Paid Ads','oauth2',array['POPULAR']),
 ('ga4','Google Analytics 4','Analytics','oauth2',array['POPULAR']),
 ('meta-ads','Meta Ads','Paid Ads','oauth2',array['POPULAR']),
 ('tiktok-ads','TikTok Ads','Paid Ads','oauth2',array['POPULAR']),
 ('google-search-console','Google Search Console','SEO','oauth2',array['POPULAR'])
on conflict(slug) do update set name=excluded.name,category=excluded.category,auth_type=excluded.auth_type,badges=excluded.badges;
