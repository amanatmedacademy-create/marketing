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
  select c.*, btrim(concat_ws(' ', c.first_name, c.last_name)) as full_name
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
  select c.id, jsonb_build_object(
    'id', c.id,
    'fullName', coalesce(nullif(c.full_name, ''), nullif(c.phone, ''), nullif(c.email, ''), 'Без имени'),
    'firstName', c.first_name, 'lastName', c.last_name, 'phone', c.phone, 'email', c.email,
    'source', c.source, 'createdAt', c.created_at, 'updatedAt', c.updated_at,
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
  ) as item from contacts c
)
select coalesce(jsonb_agg(item order by (item->>'lastActivityAt')::timestamptz desc), '[]'::jsonb) from summary;
$$;

revoke all on function public.crm_customer360_list(uuid,text,integer) from public, anon, authenticated;
grant execute on function public.crm_customer360_list(uuid,text,integer) to service_role;
