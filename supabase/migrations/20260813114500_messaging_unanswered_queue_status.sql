create or replace function private.mark_messaging_unanswered_queue()
returns trigger
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
begin
  if new.conversation_id is null or new.company_id is null then
    return new;
  end if;

  if upper(coalesce(new.direction, '')) = 'INBOUND' then
    update public.marketing_conversations
    set status = 'PENDING', updated_at = greatest(coalesce(updated_at, new.sent_at), new.sent_at)
    where id = new.conversation_id and company_id = new.company_id and archived_at is null;
  elsif upper(coalesce(new.direction, '')) = 'OUTBOUND' then
    update public.marketing_conversations
    set status = 'OPEN', updated_at = greatest(coalesce(updated_at, new.sent_at), new.sent_at)
    where id = new.conversation_id and company_id = new.company_id and archived_at is null;
  end if;
  return new;
end;
$$;

revoke all on function private.mark_messaging_unanswered_queue() from public, anon, authenticated;
grant execute on function private.mark_messaging_unanswered_queue() to service_role;

drop trigger if exists zz_mark_messaging_unanswered_queue on public.marketing_messages;
create trigger zz_mark_messaging_unanswered_queue
after insert on public.marketing_messages
for each row execute function private.mark_messaging_unanswered_queue();

update public.marketing_conversations
set status = 'PENDING', updated_at = now()
where archived_at is null
  and awaiting_reply_since is not null
  and status <> 'CLOSED';

notify pgrst, 'reload schema';