alter table public.marketing_conversations
  add column if not exists last_inbound_at timestamptz,
  add column if not exists last_outbound_at timestamptz,
  add column if not exists awaiting_reply_since timestamptz,
  add column if not exists sla_due_at timestamptz,
  add column if not exists sla_escalation_level smallint not null default 0,
  add column if not exists routing_assigned_at timestamptz,
  add column if not exists routing_strategy text;

alter table public.marketing_conversations
  drop constraint if exists marketing_conversations_sla_escalation_level_check;
alter table public.marketing_conversations
  add constraint marketing_conversations_sla_escalation_level_check
  check (sla_escalation_level between 0 and 2);

create index if not exists marketing_conversations_company_awaiting_reply_idx
  on public.marketing_conversations(company_id, awaiting_reply_since)
  where awaiting_reply_since is not null and archived_at is null;

create index if not exists marketing_conversations_company_sla_due_idx
  on public.marketing_conversations(company_id, sla_due_at)
  where awaiting_reply_since is not null and sla_due_at is not null and archived_at is null;

create index if not exists marketing_conversations_company_assignee_open_idx
  on public.marketing_conversations(company_id, assigned_user_id, status)
  where archived_at is null;

create or replace function private.sync_messaging_conversation_state()
returns trigger
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_assignee uuid;
  v_first_response_minutes integer := 5;
  v_auto_assign boolean := true;
  v_config jsonb;
begin
  if new.conversation_id is null or new.company_id is null then
    return new;
  end if;

  select r.config
    into v_config
  from public.crm_task_automation_rules r
  where r.company_id = new.company_id
    and r.key = 'messaging_sla'
  limit 1;

  if v_config is not null then
    v_first_response_minutes := greatest(1, least(120, coalesce((v_config ->> 'firstResponseMinutes')::integer, 5)));
    v_auto_assign := coalesce((v_config ->> 'autoAssign')::boolean, true);
  end if;

  if upper(coalesce(new.direction, '')) = 'INBOUND' then
    select c.assigned_user_id
      into v_assignee
    from public.marketing_conversations c
    where c.id = new.conversation_id
      and c.company_id = new.company_id
    for update;

    if v_assignee is null and v_auto_assign then
      select candidate.user_id
        into v_assignee
      from (
        select
          m.user_id,
          case when p.system_key = 'call_center' then 0 else 1 end as position_rank,
          (
            select count(*)
            from public.marketing_conversations c2
            where c2.company_id = new.company_id
              and c2.assigned_user_id = m.user_id
              and c2.archived_at is null
              and coalesce(c2.status, 'OPEN') <> 'CLOSED'
          ) as open_load,
          u.last_seen_at
        from public.crm_company_members m
        join public.marketing_users u on u.id = m.user_id and u.status = 'active'
        left join public.crm_access_user_assignments a
          on a.company_id = m.company_id and a.user_id = m.user_id
        left join public.crm_access_positions p
          on p.company_id = a.company_id and p.id = a.position_id
        where m.company_id = new.company_id
          and m.status = 'active'
          and m.role in ('owner', 'administrator', 'manager')
        order by
          case when p.system_key = 'call_center' then 0 else 1 end,
          open_load,
          u.last_seen_at desc nulls last,
          m.user_id
        limit 1
      ) candidate;
    end if;

    update public.marketing_conversations c
    set last_inbound_at = new.sent_at,
        awaiting_reply_since = new.sent_at,
        sla_due_at = new.sent_at + make_interval(mins => v_first_response_minutes),
        sla_escalation_level = 0,
        status = 'OPEN',
        assigned_user_id = coalesce(c.assigned_user_id, v_assignee),
        routing_assigned_at = case
          when c.assigned_user_id is null and v_assignee is not null then now()
          else c.routing_assigned_at
        end,
        routing_strategy = case
          when c.assigned_user_id is null and v_assignee is not null then 'least_loaded'
          else c.routing_strategy
        end,
        updated_at = greatest(coalesce(c.updated_at, new.sent_at), new.sent_at)
    where c.id = new.conversation_id
      and c.company_id = new.company_id;

  elsif upper(coalesce(new.direction, '')) = 'OUTBOUND' then
    update public.marketing_conversations c
    set last_outbound_at = new.sent_at,
        awaiting_reply_since = null,
        sla_due_at = null,
        sla_escalation_level = 0,
        status = 'OPEN',
        updated_at = greatest(coalesce(c.updated_at, new.sent_at), new.sent_at)
    where c.id = new.conversation_id
      and c.company_id = new.company_id;
  end if;

  return new;
end;
$$;

revoke all on function private.sync_messaging_conversation_state() from public, anon, authenticated;
grant execute on function private.sync_messaging_conversation_state() to service_role;

drop trigger if exists marketing_messages_sync_conversation_state on public.marketing_messages;
create trigger marketing_messages_sync_conversation_state
after insert on public.marketing_messages
for each row execute function private.sync_messaging_conversation_state();

with message_state as (
  select
    conversation_id,
    max(sent_at) filter (where upper(direction) = 'INBOUND') as last_inbound_at,
    max(sent_at) filter (where upper(direction) = 'OUTBOUND') as last_outbound_at
  from public.marketing_messages
  where conversation_id is not null
  group by conversation_id
)
update public.marketing_conversations c
set last_inbound_at = s.last_inbound_at,
    last_outbound_at = s.last_outbound_at,
    awaiting_reply_since = case
      when s.last_inbound_at is not null
       and s.last_inbound_at > coalesce(s.last_outbound_at, '-infinity'::timestamptz)
       and coalesce(c.status, 'OPEN') <> 'CLOSED'
      then s.last_inbound_at else null end,
    sla_due_at = case
      when s.last_inbound_at is not null
       and s.last_inbound_at > coalesce(s.last_outbound_at, '-infinity'::timestamptz)
       and coalesce(c.status, 'OPEN') <> 'CLOSED'
      then s.last_inbound_at + interval '5 minutes' else null end,
    sla_escalation_level = 0
from message_state s
where s.conversation_id = c.id;

insert into public.crm_task_automation_rules(company_id, key, name, description, enabled, config)
select distinct c.id,
  'messaging_sla',
  'Messaging SLA и маршрутизация',
  'Автоназначение входящих диалогов, контроль первого ответа и двухуровневая SLA-эскалация с задачами.',
  true,
  jsonb_build_object('firstResponseMinutes', 5, 'escalationMinutes', 15, 'autoAssign', true)
from public.crm_companies c
on conflict (company_id, key) do nothing;

update public.crm_task_automation_rules
set enabled = false,
    updated_at = now()
where key = 'whatsapp_unanswered'
  and enabled = true;

create or replace function public.run_messaging_sla_scan()
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_conv record;
  v_config jsonb;
  v_enabled boolean;
  v_first integer;
  v_escalation integer;
  v_assignee uuid;
  v_supervisor uuid;
  v_task_id uuid;
  v_event_key text;
  v_scanned integer := 0;
  v_l1 integer := 0;
  v_l2 integer := 0;
  v_tasks integer := 0;
begin
  insert into public.crm_task_automation_rules(company_id, key, name, description, enabled, config)
  select distinct c.company_id,
    'messaging_sla',
    'Messaging SLA и маршрутизация',
    'Автоназначение входящих диалогов, контроль первого ответа и двухуровневая SLA-эскалация с задачами.',
    true,
    jsonb_build_object('firstResponseMinutes', 5, 'escalationMinutes', 15, 'autoAssign', true)
  from public.marketing_conversations c
  where c.company_id is not null
  on conflict (company_id, key) do nothing;

  for v_conv in
    select c.*
    from public.marketing_conversations c
    where c.archived_at is null
      and c.awaiting_reply_since is not null
      and coalesce(c.status, 'OPEN') <> 'CLOSED'
    order by c.awaiting_reply_since asc
    limit 1000
  loop
    v_scanned := v_scanned + 1;

    select r.enabled, r.config
      into v_enabled, v_config
    from public.crm_task_automation_rules r
    where r.company_id = v_conv.company_id
      and r.key = 'messaging_sla'
    limit 1;

    if coalesce(v_enabled, true) is false then
      continue;
    end if;

    v_first := greatest(1, least(120, coalesce((v_config ->> 'firstResponseMinutes')::integer, 5)));
    v_escalation := greatest(v_first + 1, least(1440, coalesce((v_config ->> 'escalationMinutes')::integer, 15)));
    v_assignee := v_conv.assigned_user_id;

    if v_assignee is null and coalesce((v_config ->> 'autoAssign')::boolean, true) then
      select candidate.user_id into v_assignee
      from (
        select
          m.user_id,
          case when p.system_key = 'call_center' then 0 else 1 end as position_rank,
          (
            select count(*)
            from public.marketing_conversations c2
            where c2.company_id = v_conv.company_id
              and c2.assigned_user_id = m.user_id
              and c2.archived_at is null
              and coalesce(c2.status, 'OPEN') <> 'CLOSED'
          ) as open_load,
          u.last_seen_at
        from public.crm_company_members m
        join public.marketing_users u on u.id = m.user_id and u.status = 'active'
        left join public.crm_access_user_assignments a
          on a.company_id = m.company_id and a.user_id = m.user_id
        left join public.crm_access_positions p
          on p.company_id = a.company_id and p.id = a.position_id
        where m.company_id = v_conv.company_id
          and m.status = 'active'
          and m.role in ('owner', 'administrator', 'manager')
        order by
          case when p.system_key = 'call_center' then 0 else 1 end,
          open_load,
          u.last_seen_at desc nulls last,
          m.user_id
        limit 1
      ) candidate;

      if v_assignee is not null then
        update public.marketing_conversations
        set assigned_user_id = v_assignee,
            routing_assigned_at = now(),
            routing_strategy = 'least_loaded',
            updated_at = now()
        where id = v_conv.id
          and assigned_user_id is null;
      end if;
    end if;

    v_event_key := v_conv.id::text || ':' || v_conv.awaiting_reply_since::text;

    if now() >= v_conv.awaiting_reply_since + make_interval(mins => v_first)
       and coalesce(v_conv.sla_escalation_level, 0) < 1 then
      insert into public.crm_tasks(
        company_id, title, description, status, stage_key, workflow_key, priority,
        due_at, sla_minutes, sla_due_at, source, assignment_mode,
        link_type, link_id, link_label, automation_key, automation_event_key
      ) values (
        v_conv.company_id,
        'SLA: ответить клиенту',
        'Клиент ожидает ответ в Messaging дольше установленного SLA.',
        'todo', 'new', 'call_center', 'urgent', now(), 5, now() + interval '5 minutes',
        'work_tasks', case when v_assignee is null then 'shared' else 'individual' end,
        'messaging_conversation', v_conv.id::text,
        coalesce(nullif(v_conv.title, ''), nullif(v_conv.phone, ''), 'Диалог'),
        'messaging_sla_l1', v_event_key
      )
      on conflict do nothing
      returning id into v_task_id;

      if v_task_id is not null then
        v_tasks := v_tasks + 1;
        if v_assignee is not null then
          insert into public.crm_task_targets(company_id, task_id, target_type, target_value, target_label)
          select v_conv.company_id, v_task_id, 'user', v_assignee::text,
                 coalesce(nullif(u.name, ''), nullif(u.email, ''), 'Ответственный менеджер')
          from public.marketing_users u where u.id = v_assignee
          on conflict do nothing;
        else
          insert into public.crm_task_targets(company_id, task_id, target_type, target_value, target_label)
          values (v_conv.company_id, v_task_id, 'all', null, 'Колл-центр')
          on conflict do nothing;
        end if;
      end if;
      v_task_id := null;

      update public.marketing_conversations
      set sla_escalation_level = greatest(sla_escalation_level, 1),
          status = 'PENDING',
          updated_at = now()
      where id = v_conv.id;
      v_l1 := v_l1 + 1;
    end if;

    if now() >= v_conv.awaiting_reply_since + make_interval(mins => v_escalation)
       and coalesce(v_conv.sla_escalation_level, 0) < 2 then
      select m.user_id into v_supervisor
      from public.crm_company_members m
      join public.marketing_users u on u.id = m.user_id and u.status = 'active'
      where m.company_id = v_conv.company_id
        and m.status = 'active'
        and m.role in ('owner', 'administrator')
      order by case when m.role = 'owner' then 0 else 1 end, u.last_seen_at desc nulls last, m.user_id
      limit 1;

      if v_supervisor is null then v_supervisor := v_assignee; end if;

      insert into public.crm_tasks(
        company_id, title, description, status, stage_key, workflow_key, priority,
        due_at, sla_minutes, sla_due_at, source, assignment_mode,
        link_type, link_id, link_label, automation_key, automation_event_key
      ) values (
        v_conv.company_id,
        'Эскалация SLA: клиент без ответа',
        'Messaging SLA нарушен повторно. Требуется вмешательство руководителя и контроль ответа клиенту.',
        'todo', 'new', 'call_center', 'urgent', now(), 5, now() + interval '5 minutes',
        'work_tasks', case when v_supervisor is null then 'shared' else 'individual' end,
        'messaging_conversation', v_conv.id::text,
        coalesce(nullif(v_conv.title, ''), nullif(v_conv.phone, ''), 'Диалог'),
        'messaging_sla_l2', v_event_key
      )
      on conflict do nothing
      returning id into v_task_id;

      if v_task_id is not null then
        v_tasks := v_tasks + 1;
        if v_supervisor is not null then
          insert into public.crm_task_targets(company_id, task_id, target_type, target_value, target_label)
          select v_conv.company_id, v_task_id, 'user', v_supervisor::text,
                 coalesce(nullif(u.name, ''), nullif(u.email, ''), 'Руководитель')
          from public.marketing_users u where u.id = v_supervisor
          on conflict do nothing;
        else
          insert into public.crm_task_targets(company_id, task_id, target_type, target_value, target_label)
          values (v_conv.company_id, v_task_id, 'all', null, 'Руководитель')
          on conflict do nothing;
        end if;
      end if;
      v_task_id := null;

      update public.marketing_conversations
      set sla_escalation_level = 2,
          status = 'PENDING',
          updated_at = now()
      where id = v_conv.id;
      v_l2 := v_l2 + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'scanned', v_scanned,
    'level1', v_l1,
    'level2', v_l2,
    'tasksCreated', v_tasks
  );
end;
$$;

revoke all on function public.run_messaging_sla_scan() from public, anon, authenticated;
grant execute on function public.run_messaging_sla_scan() to service_role;

notify pgrst, 'reload schema';