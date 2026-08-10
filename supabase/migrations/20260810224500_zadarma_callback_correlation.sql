create table if not exists public.telephony_callback_requests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.crm_companies(id) on delete cascade,
  marketing_call_id uuid not null references public.marketing_calls(id) on delete cascade,
  provider text not null default 'zadarma' check (provider in ('zadarma')),
  extension text not null,
  destination text not null,
  status text not null default 'requested' check (status in ('requested','matched','completed','failed','expired')),
  pbx_call_id text,
  external_recording_id text,
  requested_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '10 minutes'),
  matched_at timestamptz,
  completed_at timestamptz,
  last_error text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists telephony_callback_requests_company_pending_idx
  on public.telephony_callback_requests(company_id, status, destination, extension, requested_at desc);
create index if not exists telephony_callback_requests_call_fk_idx
  on public.telephony_callback_requests(marketing_call_id);
create unique index if not exists telephony_callback_requests_company_pbx_uidx
  on public.telephony_callback_requests(company_id, pbx_call_id)
  where pbx_call_id is not null;

alter table public.telephony_callback_requests enable row level security;
revoke all on public.telephony_callback_requests from anon, authenticated;
grant select, insert, update, delete on public.telephony_callback_requests to service_role;
