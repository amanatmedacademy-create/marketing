-- Universal Telephony recording archive and automatic processing.

alter table public.telephony_settings
  drop constraint if exists telephony_settings_provider_check;

alter table public.telephony_settings
  add constraint telephony_settings_provider_check
  check (provider in ('zadarma', 'asterisk', 'freepbx', 'twilio', 'voximplant', 'sip'));

alter table public.telephony_settings
  alter column auto_transcribe set default true,
  alter column auto_analyze set default true;

alter table public.telephony_settings
  add column if not exists archive_recordings boolean not null default true,
  add column if not exists recording_retention_days integer not null default 365
    check (recording_retention_days between 1 and 3650);

-- The product requirement is automatic transcription/AI for completed recorded calls.
-- Existing tenants are switched on as part of this release; admins can disable it later.
update public.telephony_settings
set auto_transcribe = true,
    auto_analyze = true,
    archive_recordings = true,
    updated_at = now();

alter table public.marketing_calls
  add column if not exists telephony_provider text not null default 'zadarma',
  add column if not exists recording_ingest_status text not null default 'pending',
  add column if not exists recording_storage_bucket text,
  add column if not exists recording_storage_path text,
  add column if not exists recording_content_type text,
  add column if not exists recording_size_bytes bigint,
  add column if not exists recording_archived_at timestamptz,
  add column if not exists recording_ingest_error text;

alter table public.marketing_calls
  drop constraint if exists marketing_calls_telephony_provider_check;
alter table public.marketing_calls
  add constraint marketing_calls_telephony_provider_check
  check (telephony_provider in ('zadarma', 'asterisk', 'freepbx', 'twilio', 'voximplant', 'sip'));

alter table public.marketing_calls
  drop constraint if exists marketing_calls_recording_ingest_status_check;
alter table public.marketing_calls
  add constraint marketing_calls_recording_ingest_status_check
  check (recording_ingest_status in ('pending', 'processing', 'stored', 'failed', 'not_available'));

update public.marketing_calls
set telephony_provider = case
      when lower(coalesce(metadata ->> 'provider', '')) in ('zadarma', 'asterisk', 'freepbx', 'twilio', 'voximplant', 'sip')
        then lower(metadata ->> 'provider')
      when upper(coalesce(source, '')) = 'ZADARMA' then 'zadarma'
      else telephony_provider
    end,
    recording_ingest_status = case
      when recording_storage_path is not null then 'stored'
      when recording_external_id is not null or recording_url is not null or pbx_call_id is not null then 'pending'
      else recording_ingest_status
    end;

create index if not exists marketing_calls_recording_ingest_idx
  on public.marketing_calls(company_id, recording_ingest_status, recording_ready_at)
  where call_status = 'COMPLETED';

create index if not exists marketing_calls_recording_storage_idx
  on public.marketing_calls(company_id, recording_archived_at desc)
  where recording_storage_path is not null;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'telephony-recordings',
  'telephony-recordings',
  false,
  268435456,
  array[
    'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav', 'audio/ogg',
    'audio/webm', 'video/webm', 'audio/mp4', 'video/mp4', 'audio/flac',
    'audio/x-flac', 'application/octet-stream'
  ]::text[]
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;
