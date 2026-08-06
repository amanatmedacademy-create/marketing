alter table public.marketing_messages
  add column if not exists transcription_text text,
  add column if not exists transcription_status text,
  add column if not exists transcription_model text,
  add column if not exists transcription_error text,
  add column if not exists transcribed_at timestamptz;

alter table public.marketing_messages
  drop constraint if exists marketing_messages_transcription_status_check;

alter table public.marketing_messages
  add constraint marketing_messages_transcription_status_check
  check (transcription_status is null or transcription_status in ('processing', 'completed', 'failed'));

create index if not exists marketing_messages_transcription_status_idx
  on public.marketing_messages (transcription_status, sent_at desc)
  where transcription_status is not null;

notify pgrst, 'reload schema';
