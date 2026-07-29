create table if not exists public.marketing_conversations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid null,
  branch_id uuid null,
  lead_id uuid null,
  contact_id uuid null,
  title text null,
  phone text null,
  channel text not null default 'WHATSAPP',
  status text not null default 'OPEN' check (status in ('OPEN','CLOSED')),
  assigned_user_id uuid null,
  unread_count integer not null default 0,
  last_message_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz null
);

create table if not exists public.marketing_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.marketing_conversations(id) on delete cascade,
  body text not null,
  direction text not null check (direction in ('INBOUND','OUTBOUND')),
  sender_name text null,
  external_message_id text null,
  status text not null default 'SENT',
  sent_at timestamptz not null default now(),
  read_at timestamptz null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists marketing_conversations_updated_idx
  on public.marketing_conversations(updated_at desc)
  where archived_at is null;

create index if not exists marketing_messages_conversation_sent_idx
  on public.marketing_messages(conversation_id, sent_at asc);

create unique index if not exists marketing_messages_external_unique
  on public.marketing_messages(external_message_id)
  where external_message_id is not null;

alter table public.marketing_conversations enable row level security;
alter table public.marketing_messages enable row level security;

revoke all on public.marketing_conversations from anon, authenticated;
revoke all on public.marketing_messages from anon, authenticated;
grant all on public.marketing_conversations to service_role;
grant all on public.marketing_messages to service_role;
