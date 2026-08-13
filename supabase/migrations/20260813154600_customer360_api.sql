-- Harden tenant-safe FK delete semantics and expose compact service-role Customer 360 RPCs.

do $$
begin
  if exists (select 1 from pg_constraint where conname = 'marketing_calls_contact_company_fkey') then
    alter table public.marketing_calls drop constraint marketing_calls_contact_company_fkey;
  end if;
  alter table public.marketing_calls
    add constraint marketing_calls_contact_company_fkey
    foreign key (contact_id, company_id) references public.crm_contacts(id, company_id)
    on delete set null (contact_id);

  if exists (select 1 from pg_constraint where conname = 'waba_clinic_appointments_contact_company_fkey') then
    alter table public.waba_clinic_appointments drop constraint waba_clinic_appointments_contact_company_fkey;
  end if;
  alter table public.waba_clinic_appointments
    add constraint waba_clinic_appointments_contact_company_fkey
    foreign key (contact_id, company_id) references public.crm_contacts(id, company_id)
    on delete set null (contact_id);

  if exists (select 1 from pg_constraint where conname = 'patient_journey_events_contact_company_fkey') then
    alter table public.patient_journey_events drop constraint patient_journey_events_contact_company_fkey;
  end if;
  alter table public.patient_journey_events
    add constraint patient_journey_events_contact_company_fkey
    foreign key (contact_id, company_id) references public.crm_contacts(id, company_id)
    on delete set null (contact_id);

  if exists (select 1 from pg_constraint where conname = 'clinic_patients_crm_contact_company_fkey') then
    alter table public.clinic_patients drop constraint clinic_patients_crm_contact_company_fkey;
  end if;
  alter table public.clinic_patients
    add constraint clinic_patients_crm_contact_company_fkey
    foreign key (crm_contact_id, company_id) references public.crm_contacts(id, company_id)
    on delete set null (crm_contact_id);
end $$;

create or replace function public.crm_customer360_list(
  p_company_id uuid,
  p_query text default null,
  p_limit integer default 250
)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
with contacts as (
  select c.*,
         btrim(concat_ws(' ', c.first_name, c.last_name)) as full_name
  from public.crm_contacts c
  where c.company_id = p_company_id
    and c.deleted_at is null
    and (
      nullif(btrim(p_query), '') is null
      or btrim(concat_ws(' ', c.first_name, c.last_name)) ilike '%' || btrim(p_query) || '%'
      or coalesce(c.phone, '') ilike '%' || btrim(p_query) || '%'
      or coalesce(c.email, '') ilike '%' || btrim(p_query) || '%'
    )
  order by c.updated_at desc, c.created_at desc
  limit greatest(1, least(coalesce(p_limit, 250), 500))
), summary as (
  select c.id,
    jsonb_build_object(
      'id', c.id,
      'fullName', coalesce(nullif(c.full_name, ''), nullif(c.phone, ''), nullif(c.email, ''), 'Без имени'),
      'firstName', c.first_name,
      'lastName', c.last_name,
      'phone', c.phone,
      'email', c.email,
      'source', c.source,
      'createdAt', c.created_at,
      'updatedAt', c.updated_at,
      'leadCount', (select count(*) from public.marketing_leads l where l.company_id=p_company_id and l.crm_contact_id=c.id),
      'dealCount', (select count(*) from public.crm_deals d where d.company_id=p_company_id and d.contact_id=c.id and d.deleted_at is null),
      'openDealCount', (select count(*) from public.crm_deals d where d.company_id=p_company_id and d.contact_id=c.id and d.deleted_at is null and d.status='open'),
      'callCount', (select count(*) from public.marketing_calls x where x.company_id=p_company_id and x.contact_id=c.id),
      'conversationCount', (select count(*) from public.marketing_conversations x where x.company_id=p_company_id and x.contact_id=c.id and x.archived_at is null),
      'appointmentCount', (select count(*) from public.waba_clinic_appointments a where a.company_id=p_company_id and a.contact_id=c.id),
      'revenue', coalesce((select sum(d.amount) from public.crm_deals d where d.company_id=p_company_id and d.contact_id=c.id and d.deleted_at is null and (d.status='won' or d.paid=true)), 0),
      'lastActivityAt', greatest(
        coalesce((select max(l.updated_at) from public.marketing_leads l where l.company_id=p_company_id and l.crm_contact_id=c.id), '-infinity'::timestamptz),
        coalesce((select max(d.updated_at) from public.crm_deals d where d.company_id=p_company_id and d.contact_id=c.id and d.deleted_at is null), '-infinity'::timestamptz),
        coalesce((select max(x.started_at) from public.marketing_calls x where x.company_id=p_company_id and x.contact_id=c.id), '-infinity'::timestamptz),
        coalesce((select max(x.last_message_at) from public.marketing_conversations x where x.company_id=p_company_id and x.contact_id=c.id and x.archived_at is null), '-infinity'::timestamptz),
        coalesce((select max(a.updated_at) from public.waba_clinic_appointments a where a.company_id=p_company_id and a.contact_id=c.id), '-infinity'::timestamptz),
        c.updated_at
      )
    ) as item
  from contacts c
)
select coalesce(jsonb_agg(item order by (item->>'lastActivityAt')::timestamptz desc), '[]'::jsonb) from summary;
$$;

create or replace function public.crm_customer360_detail(
  p_company_id uuid,
  p_contact_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  result jsonb;
begin
  if not exists (
    select 1 from public.crm_contacts
    where id=p_contact_id and company_id=p_company_id and deleted_at is null
  ) then
    return null;
  end if;

  select jsonb_build_object(
    'contact', jsonb_build_object(
      'id', c.id,
      'fullName', coalesce(nullif(btrim(concat_ws(' ',c.first_name,c.last_name)),''), nullif(c.phone,''), nullif(c.email,''), 'Без имени'),
      'firstName', c.first_name, 'lastName', c.last_name, 'phone', c.phone,
      'email', c.email, 'source', c.source, 'createdAt', c.created_at, 'updatedAt', c.updated_at
    ),
    'leads', coalesce((select jsonb_agg(jsonb_build_object(
      'id',l.id,'name',l.name,'phone',l.phone,'email',l.email,'source',l.source,'platform',l.platform,
      'stage',l.stage,'createdAt',l.created_at,'updatedAt',l.updated_at,'dealId',l.crm_deal_id
    ) order by l.created_at desc) from public.marketing_leads l where l.company_id=p_company_id and l.crm_contact_id=c.id), '[]'::jsonb),
    'deals', coalesce((select jsonb_agg(jsonb_build_object(
      'id',d.id,'title',d.title,'phone',d.phone,'email',d.email,'source',d.source,'status',d.status,
      'amount',d.amount,'currency',d.currency,'paid',d.paid,'priority',d.priority,'nextAction',d.next_action,
      'nextActionAt',d.next_action_at,'stageId',d.stage_id,'stageName',s.name,'pipelineId',d.pipeline_id,'pipelineName',p.name,
      'marketingLeadId',d.marketing_lead_id,'createdAt',d.created_at,'updatedAt',d.updated_at
    ) order by d.updated_at desc) from public.crm_deals d
      left join public.crm_pipeline_stages s on s.id=d.stage_id and s.company_id=d.company_id
      left join public.crm_pipelines p on p.id=d.pipeline_id and p.company_id=d.company_id
      where d.company_id=p_company_id and d.contact_id=c.id and d.deleted_at is null), '[]'::jsonb),
    'calls', coalesce((select jsonb_agg(jsonb_build_object(
      'id',x.id,'leadId',x.lead_id,'conversationId',x.conversation_id,'phone',x.client_phone,'status',x.call_status,
      'channel',x.channel,'direction',x.direction,'startedAt',x.started_at,'durationSeconds',x.duration_seconds,
      'result',x.call_result,'summary',x.summary,'nextAction',x.next_action,'recordingUrl',x.recording_url
    ) order by x.started_at desc) from public.marketing_calls x where x.company_id=p_company_id and x.contact_id=c.id), '[]'::jsonb),
    'conversations', coalesce((select jsonb_agg(jsonb_build_object(
      'id',x.id,'leadId',x.lead_id,'title',x.title,'phone',x.phone,'channel',x.channel,'status',x.status,
      'unreadCount',x.unread_count,'lastMessageAt',x.last_message_at,'assignedUserId',x.assigned_user_id
    ) order by x.last_message_at desc nulls last) from public.marketing_conversations x
      where x.company_id=p_company_id and x.contact_id=c.id and x.archived_at is null), '[]'::jsonb),
    'messages', coalesce((select jsonb_agg(jsonb_build_object(
      'id',m.id,'conversationId',m.conversation_id,'body',m.body,'direction',m.direction,'senderName',m.sender_name,
      'status',m.status,'sentAt',m.sent_at,'attachmentName',m.attachment_name
    ) order by m.sent_at desc) from public.marketing_messages m
      join public.marketing_conversations x on x.id=m.conversation_id and x.company_id=m.company_id
      where m.company_id=p_company_id and x.contact_id=c.id), '[]'::jsonb),
    'appointments', coalesce((select jsonb_agg(jsonb_build_object(
      'id',a.id,'leadId',a.lead_id,'conversationId',a.conversation_id,'patientId',a.patient_id,'patientName',a.patient_name,
      'phone',a.phone,'status',a.status,'source',a.source,'startsAt',a.starts_at,'endsAt',a.ends_at,'doctorId',a.doctor_id,'branchId',a.branch_id
    ) order by a.starts_at desc) from public.waba_clinic_appointments a where a.company_id=p_company_id and a.contact_id=c.id), '[]'::jsonb),
    'journey', coalesce((select jsonb_agg(jsonb_build_object(
      'id',e.id,'leadId',e.lead_id,'type',e.event_type,'occurredAt',e.occurred_at,'channel',e.channel,'source',e.source,
      'value',e.value,'currency',e.currency,'campaignId',e.campaign_id,'adsetId',e.adset_id,'adId',e.ad_id
    ) order by e.occurred_at desc) from public.patient_journey_events e where e.company_id=p_company_id and e.contact_id=c.id), '[]'::jsonb),
    'patients', coalesce((select jsonb_agg(jsonb_build_object(
      'id',p.id,'name',p.name,'phone',p.phone,'email',p.email,'sourceSystem',p.source_system,'lastVisitAt',p.last_visit_at,'nextVisitAt',p.next_visit_at
    ) order by p.updated_at desc) from public.clinic_patients p where p.company_id=p_company_id and p.crm_contact_id=c.id), '[]'::jsonb),
    'tasks', coalesce((select jsonb_agg(jsonb_build_object(
      'id',t.id,'title',t.title,'description',t.description,'status',t.status,'priority',t.priority,'dueAt',t.due_at,
      'completedAt',t.completed_at,'assigneeId',t.assignee_id,'linkType',t.link_type,'linkId',t.link_id,'linkLabel',t.link_label
    ) order by t.due_at asc nulls last, t.created_at desc) from public.crm_tasks t
      where t.company_id=p_company_id and (
        (t.link_type in ('contact','customer') and t.link_id=c.id::text)
        or (t.link_type='deal' and t.link_id in (select d.id::text from public.crm_deals d where d.company_id=p_company_id and d.contact_id=c.id and d.deleted_at is null))
        or (t.link_type='lead' and t.link_id in (select l.id::text from public.marketing_leads l where l.company_id=p_company_id and l.crm_contact_id=c.id))
      )), '[]'::jsonb),
    'stats', jsonb_build_object(
      'leadCount',(select count(*) from public.marketing_leads l where l.company_id=p_company_id and l.crm_contact_id=c.id),
      'dealCount',(select count(*) from public.crm_deals d where d.company_id=p_company_id and d.contact_id=c.id and d.deleted_at is null),
      'callCount',(select count(*) from public.marketing_calls x where x.company_id=p_company_id and x.contact_id=c.id),
      'conversationCount',(select count(*) from public.marketing_conversations x where x.company_id=p_company_id and x.contact_id=c.id and x.archived_at is null),
      'appointmentCount',(select count(*) from public.waba_clinic_appointments a where a.company_id=p_company_id and a.contact_id=c.id),
      'revenue',coalesce((select sum(d.amount) from public.crm_deals d where d.company_id=p_company_id and d.contact_id=c.id and d.deleted_at is null and (d.status='won' or d.paid=true)),0)
    )
  ) into result
  from public.crm_contacts c
  where c.id=p_contact_id and c.company_id=p_company_id and c.deleted_at is null;

  return result;
end;
$$;

revoke all on function public.crm_customer360_list(uuid,text,integer) from public, anon, authenticated;
revoke all on function public.crm_customer360_detail(uuid,uuid) from public, anon, authenticated;
grant execute on function public.crm_customer360_list(uuid,text,integer) to service_role;
grant execute on function public.crm_customer360_detail(uuid,uuid) to service_role;
