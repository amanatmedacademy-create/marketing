create or replace function public.set_marketing_conversation_company_id()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.company_id is null and new.lead_id is not null then
    select l.company_id
      into new.company_id
      from public.marketing_leads l
     where l.id = new.lead_id;
  end if;

  if new.company_id is null then
    raise exception 'company_id is required for marketing_conversations';
  end if;

  return new;
end;
$$;

create or replace function public.set_marketing_message_company_id()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.company_id is null and new.conversation_id is not null then
    select c.company_id
      into new.company_id
      from public.marketing_conversations c
     where c.id = new.conversation_id;
  end if;

  if new.company_id is null then
    raise exception 'company_id is required for marketing_messages';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_marketing_conversations_set_company_id on public.marketing_conversations;
create trigger trg_marketing_conversations_set_company_id
before insert on public.marketing_conversations
for each row execute function public.set_marketing_conversation_company_id();

drop trigger if exists trg_marketing_messages_set_company_id on public.marketing_messages;
create trigger trg_marketing_messages_set_company_id
before insert on public.marketing_messages
for each row execute function public.set_marketing_message_company_id();
