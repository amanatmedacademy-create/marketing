alter table public.telephony_settings
  add column if not exists webhook_configured_at timestamptz,
  add column if not exists webhook_last_checked_at timestamptz,
  add column if not exists webhook_last_error text,
  add column if not exists last_webhook_event_at timestamptz,
  add column if not exists last_webhook_event_type text,
  add column if not exists last_webhook_pbx_call_id text;
