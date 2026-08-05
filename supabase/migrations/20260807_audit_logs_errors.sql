-- FR-060: Журнал и аудит.
-- Канонический audit_logs + реестр ошибок с дедупликацией и повторной обработкой.

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid,
  user_id uuid,
  action text not null,
  entity_type text,
  entity_id text,
  before jsonb,
  after jsonb,
  ip text,
  user_agent text,
  correlation_id text,
  created_at timestamptz not null default now()
);

create index if not exists audit_logs_created_idx on public.audit_logs (created_at desc);
create index if not exists audit_logs_action_idx on public.audit_logs (action, created_at desc);
create index if not exists audit_logs_entity_idx on public.audit_logs (entity_type, entity_id, created_at desc);
create index if not exists audit_logs_user_idx on public.audit_logs (user_id, created_at desc);
create index if not exists audit_logs_correlation_idx on public.audit_logs (correlation_id);

-- Реестр ошибок: одна строка на уникальную ошибку (fingerprint),
-- повторные возникновения увеличивают repeat_count и last_seen_at.
create table if not exists public.error_logs (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  endpoint text not null,
  code text not null,
  message text not null,
  correlation_id text,
  fingerprint text not null unique,
  repeat_count integer not null default 1,
  retry_attempts integer not null default 0,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  status text not null default 'OPEN' check (status in ('OPEN','RETRYING','RESOLVED')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists error_logs_last_seen_idx on public.error_logs (last_seen_at desc);
create index if not exists error_logs_status_idx on public.error_logs (status, last_seen_at desc);
create index if not exists error_logs_source_idx on public.error_logs (source, last_seen_at desc);

alter table public.audit_logs enable row level security;
alter table public.error_logs enable row level security;
