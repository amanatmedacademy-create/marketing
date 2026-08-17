-- Колл-Центр: порт Unified Inbox (режим колл-центра) из МИС в модуль «Чат».
-- Аддитивно расширяет существующие marketing_conversations / marketing_messages.

-- Статус PENDING («Ожидает») — как в МИС ChatThread.
alter table public.marketing_conversations
  drop constraint if exists marketing_conversations_status_check;
alter table public.marketing_conversations
  add constraint marketing_conversations_status_check
  check (status in ('OPEN','PENDING','CLOSED'));

-- Вложения сообщений. В Supabase это был private Storage bucket; в self-hosted
-- runtime attachment_path указывает на защищённое локальное хранилище VPS.
alter table public.marketing_messages
  add column if not exists attachment_path text,
  add column if not exists attachment_name text,
  add column if not exists attachment_mime_type text,
  add column if not exists attachment_size_bytes integer;

-- Быстрый подсчёт непрочитанных входящих по диалогу.
create index if not exists marketing_messages_unread_idx
  on public.marketing_messages (conversation_id)
  where direction = 'INBOUND' and read_at is null;

create index if not exists marketing_conversations_assigned_idx
  on public.marketing_conversations (assigned_user_id)
  where assigned_user_id is not null;

create index if not exists marketing_conversations_last_message_idx
  on public.marketing_conversations (last_message_at desc nulls last)
  where archived_at is null;

-- Preserve compatibility when replayed on Supabase, but do not require its
-- proprietary storage schema on our own PostgreSQL server.
do $$
begin
  if to_regclass('storage.buckets') is not null then
    execute $storage$
      insert into storage.buckets (id, name, public)
      values ('marketing-chat-attachments', 'marketing-chat-attachments', false)
      on conflict (id) do nothing
    $storage$;
  end if;
end $$;
