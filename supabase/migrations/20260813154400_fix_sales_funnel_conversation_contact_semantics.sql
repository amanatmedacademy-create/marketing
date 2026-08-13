-- sales_funnel_leads.contact_id is a legacy FK to marketing_leads.id.
-- marketing_conversations.contact_id now means crm_contacts.id, so never feed it into
-- the legacy funnel relation. Keep that bridge linked only through conversation.lead_id.

create or replace function public.sync_callcenter_dialog_to_sales_funnel()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  funnel_id text := 'chat_' || new.id::text;
  desired_stage text := public.callcenter_status_to_funnel_stage(new.status);
  resolved_contact_id uuid := new.lead_id;
  lead_name text;
  lead_source text;
  resolved_name text;
  resolved_source text;
begin
  if resolved_contact_id is not null then
    select nullif(name, 'Без имени'), source
      into lead_name, lead_source
      from public.marketing_leads
     where id = resolved_contact_id;
  end if;

  resolved_name := coalesce(nullif(btrim(lead_name), ''), nullif(btrim(new.title), ''), nullif(btrim(new.phone), ''), 'Диалог ' || left(new.id::text, 8));
  resolved_source := coalesce(nullif(btrim(lead_source), ''), 'Колл-центр · ' || public.marketing_source_for_channel(new.channel));

  insert into public.sales_funnel_leads (
    id, contact_id, full_name, phone, diagnosis, source, priority, stage,
    manager_user_id, amount, paid, whatsapp_count, lost_reason, created_at, updated_at, closed_at
  ) values (
    funnel_id,
    resolved_contact_id,
    resolved_name,
    nullif(new.phone, ''),
    'Диалог колл-центра',
    resolved_source,
    'MEDIUM',
    desired_stage,
    new.assigned_user_id,
    0,
    false,
    case when upper(new.channel) = 'WHATSAPP' then 1 else 0 end,
    case when desired_stage = 'LOST' then 'Диалог закрыт в колл-центре' else null end,
    coalesce(new.created_at, now()),
    now(),
    case when desired_stage = 'LOST' then now() else null end
  )
  on conflict (id) do update set
    contact_id = coalesce(excluded.contact_id, sales_funnel_leads.contact_id),
    full_name = excluded.full_name,
    phone = coalesce(excluded.phone, sales_funnel_leads.phone),
    diagnosis = coalesce(sales_funnel_leads.diagnosis, excluded.diagnosis),
    source = excluded.source,
    stage = case
      when sales_funnel_leads.stage in ('APPOINTMENT', 'DIAGNOSTIC', 'COURSE') then sales_funnel_leads.stage
      else excluded.stage
    end,
    manager_user_id = coalesce(excluded.manager_user_id, sales_funnel_leads.manager_user_id),
    whatsapp_count = greatest(sales_funnel_leads.whatsapp_count, excluded.whatsapp_count),
    lost_reason = case
      when sales_funnel_leads.stage in ('APPOINTMENT', 'DIAGNOSTIC', 'COURSE') then sales_funnel_leads.lost_reason
      when excluded.stage = 'LOST' then 'Диалог закрыт в колл-центре'
      else null
    end,
    updated_at = now(),
    closed_at = case
      when sales_funnel_leads.stage = 'COURSE' then sales_funnel_leads.closed_at
      when sales_funnel_leads.stage in ('APPOINTMENT', 'DIAGNOSTIC') then null
      when excluded.stage = 'LOST' then now()
      else null
    end;

  return new;
end;
$$;
