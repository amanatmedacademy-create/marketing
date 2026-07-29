create extension if not exists pgcrypto;

create table if not exists marketing_campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  channel text not null,
  objective text not null default 'Лиды',
  owner text not null default 'Не назначен',
  budget numeric(14,2) not null default 0,
  status text not null default 'План' check (status in ('Активна','План','Пауза','Завершена')),
  starts_on date,
  ends_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists marketing_tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  owner text not null default 'Не назначен',
  due_on date,
  priority text not null default 'Средний' check (priority in ('Высокий','Средний','Низкий')),
  done boolean not null default false,
  campaign_id uuid references marketing_campaigns(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists marketing_content_plan (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  publish_on date,
  platform text,
  owner text,
  production_stage text not null default 'План',
  status text not null default 'План',
  campaign_id uuid references marketing_campaigns(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists marketing_automations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  trigger_text text not null,
  action_text text not null,
  enabled boolean not null default true,
  last_run_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists marketing_activity_log (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,
  message text not null,
  entity_type text,
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists marketing_tasks_due_idx on marketing_tasks(done, due_on);
create index if not exists marketing_content_publish_idx on marketing_content_plan(publish_on);
create index if not exists marketing_activity_created_idx on marketing_activity_log(created_at desc);

alter table marketing_campaigns enable row level security;
alter table marketing_tasks enable row level security;
alter table marketing_content_plan enable row level security;
alter table marketing_automations enable row level security;
alter table marketing_activity_log enable row level security;

comment on table marketing_campaigns is 'Marketing operating system campaigns';
comment on table marketing_tasks is 'Execution queue for marketing team';
comment on table marketing_content_plan is 'Content production and publishing calendar';
comment on table marketing_automations is 'Rules for alerts and marketing operations';
comment on table marketing_activity_log is 'Audit trail for operations module';
