-- The live production marketing_calls table contains these CRM/call-center
-- fields, but the historical CREATE sequence in Git reaches Growth Engine
-- before guaranteeing that they exist. Keep the replay idempotent and aligned
-- with the production contract.
alter table public.marketing_calls
  add column if not exists channel text,
  add column if not exists operator_user_id uuid,
  add column if not exists scheduled_at timestamptz;

create index if not exists marketing_calls_company_started_idx
  on public.marketing_calls(company_id, started_at desc);

notify pgrst, 'reload schema';
