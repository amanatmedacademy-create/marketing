create table if not exists public.growth_recovery_settings (
  company_id uuid primary key references public.crm_companies(id) on delete cascade,
  enabled boolean not null default false,
  create_tasks boolean not null default true,
  stale_lead_enabled boolean not null default true,
  lost_opportunity_enabled boolean not null default true,
  whatsapp_enabled boolean not null default false,
  lost_task_delay_minutes integer not null default 15 check (lost_task_delay_minutes between 0 and 10080),
  whatsapp_template_name text,
  whatsapp_template_language text not null default 'ru',
  whatsapp_template_parameters jsonb not null default '[]'::jsonb check (jsonb_typeof(whatsapp_template_parameters) = 'array'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.growth_recovery_actions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.crm_companies(id) on delete cascade,
  lead_id uuid references public.marketing_leads(id) on delete cascade,
  lost_opportunity_id uuid references public.lost_opportunities(id) on delete cascade,
  conversation_id uuid references public.marketing_conversations(id) on delete set null,
  task_id uuid references public.crm_tasks(id) on delete set null,
  trigger_type text not null check (trigger_type in ('stale_lead','lost_opportunity')),
  action_type text not null check (action_type in ('task','whatsapp_template')),
  status text not null default 'pending' check (status in ('pending','sent','completed','skipped','failed')),
  scheduled_at timestamptz not null default now(),
  executed_at timestamptz,
  external_message_id text,
  template_name text,
  template_language text,
  last_error text,
  dedupe_key text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id, dedupe_key)
);

alter table public.growth_recovery_settings enable row level security;
alter table public.growth_recovery_actions enable row level security;
revoke all on public.growth_recovery_settings from anon, authenticated;
revoke all on public.growth_recovery_actions from anon, authenticated;
grant select, insert, update, delete on public.growth_recovery_settings to service_role;
grant select, insert, update, delete on public.growth_recovery_actions to service_role;

create index if not exists growth_recovery_actions_company_status_idx on public.growth_recovery_actions(company_id,status,scheduled_at desc);
create index if not exists growth_recovery_actions_lead_fk_idx on public.growth_recovery_actions(lead_id);
create index if not exists growth_recovery_actions_lost_fk_idx on public.growth_recovery_actions(lost_opportunity_id);
create index if not exists growth_recovery_actions_conversation_fk_idx on public.growth_recovery_actions(conversation_id);
create index if not exists growth_recovery_actions_task_fk_idx on public.growth_recovery_actions(task_id);

insert into public.growth_recovery_settings(company_id)
select id from public.crm_companies
on conflict(company_id) do nothing;
