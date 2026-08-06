-- WABA: click-to-WhatsApp attribution, media messages and Meta CAPI delivery log.

alter table public.integration_credentials
  drop constraint if exists integration_credentials_provider_check;

alter table public.integration_credentials
  add constraint integration_credentials_provider_check
  check (provider in ('bitrix', 'meta', 'tiktok', 'n8n', 'waba'));

alter table public.marketing_leads
  add column if not exists referral_source_url text,
  add column if not exists referral_source_id text,
  add column if not exists referral_source_type text,
  add column if not exists referral_headline text,
  add column if not exists referral_body text,
  add column if not exists referral_media_type text,
  add column if not exists referral_media_url text;

create index if not exists marketing_leads_referral_source_id_idx
  on public.marketing_leads (referral_source_id)
  where referral_source_id is not null;

create table if not exists public.meta_conversion_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default private.resolve_single_company_id(),
  lead_id uuid references public.marketing_leads(id) on delete set null,
  dataset_id text not null,
  event_name text not null,
  event_id text not null,
  event_time timestamptz not null default now(),
  value numeric(16,2),
  currency text,
  status text not null default 'pending' check (status in ('pending','sent','failed')),
  response jsonb not null default '{}'::jsonb,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, event_id)
);

create index if not exists meta_conversion_events_lead_idx
  on public.meta_conversion_events (company_id, lead_id, created_at desc);
create index if not exists meta_conversion_events_status_idx
  on public.meta_conversion_events (company_id, status, created_at desc);

alter table public.meta_conversion_events enable row level security;
revoke all on public.meta_conversion_events from anon, authenticated;
grant all on public.meta_conversion_events to service_role;

notify pgrst, 'reload schema';
