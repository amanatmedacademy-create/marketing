-- Production has tenant-scoped marketing_messages, but the historical ALTER
-- that introduced company_id is missing from the checked-in migration chain.
-- Reconstruct it before speed-to-lead functions reference NEW.company_id.

alter table public.marketing_messages
  add column if not exists company_id uuid;

update public.marketing_messages m
set company_id = c.company_id
from public.marketing_conversations c
where c.id = m.conversation_id
  and m.company_id is null;

-- A clean replay has no orphaned messages. If historical rows are ever loaded
-- before this migration, fail rather than silently assigning the wrong tenant.
do $$
begin
  if exists (select 1 from public.marketing_messages where company_id is null) then
    raise exception 'marketing_messages contains rows without resolvable company_id';
  end if;
end
$$;

alter table public.marketing_messages
  alter column company_id set not null;

create index if not exists marketing_messages_company_conversation_sent_idx
  on public.marketing_messages(company_id, conversation_id, sent_at);
create index if not exists marketing_messages_conversation_company_idx
  on public.marketing_messages(conversation_id, company_id);

create unique index if not exists marketing_conversations_id_company_uidx
  on public.marketing_conversations(id, company_id);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'marketing_messages_company_id_fkey'
      and conrelid = 'public.marketing_messages'::regclass
  ) then
    alter table public.marketing_messages
      add constraint marketing_messages_company_id_fkey
      foreign key (company_id) references public.crm_companies(id) on delete cascade;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'marketing_messages_conversation_company_fkey'
      and conrelid = 'public.marketing_messages'::regclass
  ) then
    alter table public.marketing_messages
      add constraint marketing_messages_conversation_company_fkey
      foreign key (conversation_id, company_id)
      references public.marketing_conversations(id, company_id) on delete cascade;
  end if;
end
$$;
