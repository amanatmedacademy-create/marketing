create extension if not exists pgcrypto;

-- Marketing is a read-model and analytics contour. These identifiers link every
-- record to the operational source of truth in MIS.
alter table public.marketing_leads
  add column if not exists organization_id uuid,
  add column if not exists branch_id uuid,
  add column if not exists contact_id uuid,
  add column if not exists lead_id uuid,
  add column if not exists patient_id uuid,
  add column if not exists deal_id uuid,
  add column if not exists conversation_id uuid,
  add column if not exists appointment_id uuid,
  add column if not exists payment_id uuid,
  add column if not exists source_system text not null default 'marketing',
  add column if not exists source_version bigint not null default 1,
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid;

alter table public.marketing_ads
  add column if not exists organization_id uuid,
  add column if not exists branch_id uuid;

alter table public.marketing_attribution_events
  add column if not exists organization_id uuid,
  add column if not exists branch_id uuid,
  add column if not exists contact_id uuid,
  add column if not exists lead_id uuid,
  add column if not exists patient_id uuid,
  add column if not exists deal_id uuid,
  add column if not exists conversation_id uuid,
  add column if not exists appointment_id uuid,
  add column if not exists payment_id uuid,
  add column if not exists source_system text not null default 'marketing';

create index if not exists marketing_leads_org_branch_idx
  on public.marketing_leads (organization_id, branch_id);
create index if not exists marketing_leads_shared_ids_idx
  on public.marketing_leads (lead_id, contact_id, patient_id, deal_id, appointment_id);
create index if not exists marketing_leads_active_idx
  on public.marketing_leads (organization_id, lead_created_at desc)
  where archived_at is null;
create index if not exists marketing_ads_org_branch_idx
  on public.marketing_ads (organization_id, branch_id);
create index if not exists marketing_attribution_org_time_idx
  on public.marketing_attribution_events (organization_id, event_at desc);

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid,
  branch_id uuid,
  request_id text not null,
  event_id text,
  idempotency_key text,
  actor_type text not null check (actor_type in ('user','ai','system','integration','patient')),
  actor_id text,
  source_system text not null,
  action text not null,
  entity_type text not null,
  entity_id text,
  before_data jsonb,
  after_data jsonb,
  metadata jsonb not null default '{}'::jsonb,
  status text not null default 'success' check (status in ('success','failed')),
  error text,
  occurred_at timestamptz not null default now(),
  processed_at timestamptz not null default now()
);

create index if not exists audit_logs_org_time_idx
  on public.audit_logs (organization_id, occurred_at desc);
create index if not exists audit_logs_entity_idx
  on public.audit_logs (entity_type, entity_id, occurred_at desc);
create unique index if not exists audit_logs_idempotency_uidx
  on public.audit_logs (organization_id, idempotency_key)
  where idempotency_key is not null;

create table if not exists public.integration_inbox (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid,
  event_id text not null,
  event_type text not null,
  source_system text not null,
  payload jsonb not null,
  status text not null default 'pending' check (status in ('pending','processing','processed','failed','dead_letter')),
  attempts integer not null default 0,
  available_at timestamptz not null default now(),
  processed_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  unique (source_system, event_id)
);

create table if not exists public.integration_outbox (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid,
  event_id text not null unique,
  event_type text not null,
  destination text not null,
  payload jsonb not null,
  status text not null default 'pending' check (status in ('pending','processing','published','failed','dead_letter')),
  attempts integer not null default 0,
  available_at timestamptz not null default now(),
  published_at timestamptz,
  last_error text,
  created_at timestamptz not null default now()
);

create index if not exists integration_inbox_pending_idx
  on public.integration_inbox (status, available_at)
  where status in ('pending','failed');
create index if not exists integration_outbox_pending_idx
  on public.integration_outbox (status, available_at)
  where status in ('pending','failed');

alter table public.audit_logs enable row level security;
alter table public.integration_inbox enable row level security;
alter table public.integration_outbox enable row level security;

revoke all on public.audit_logs from anon, authenticated;
revoke all on public.integration_inbox from anon, authenticated;
revoke all on public.integration_outbox from anon, authenticated;

grant all on public.audit_logs to service_role;
grant all on public.integration_inbox to service_role;
grant all on public.integration_outbox to service_role;

notify pgrst, 'reload schema';
