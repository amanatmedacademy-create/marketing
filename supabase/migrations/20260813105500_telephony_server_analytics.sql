create index if not exists marketing_calls_company_started_idx
  on public.marketing_calls (company_id, started_at desc);

create index if not exists marketing_calls_company_operator_started_idx
  on public.marketing_calls (company_id, operator_name, started_at desc);

create or replace function public.telephony_call_analytics(
  p_company_id uuid,
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_operator text default null
)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
with filtered_calls as materialized (
  select c.*
  from public.marketing_calls c
  where c.company_id = p_company_id
    and (p_from is null or c.started_at >= p_from)
    and (p_to is null or c.started_at <= p_to)
),
call_leads as (
  select
    coalesce(nullif(btrim(c.operator_name), ''), 'Не назначен') as operator_name,
    c.lead_id,
    min(c.started_at) as first_call_at
  from filtered_calls c
  where c.lead_id is not null
  group by 1, c.lead_id
),
overall_call_leads as (
  select c.lead_id, min(c.started_at) as first_call_at
  from filtered_calls c
  where c.lead_id is not null
  group by c.lead_id
),
operator_base as (
  select
    coalesce(nullif(btrim(c.operator_name), ''), 'Не назначен') as name,
    count(*)::bigint as calls,
    count(*) filter (where c.call_status = 'COMPLETED')::bigint as completed,
    count(*) filter (where c.appointment_created is true)::bigint as appointments,
    count(*) filter (where nullif(btrim(c.next_action), '') is not null)::bigint as "followUps",
    count(c.quality_score)::bigint as scored,
    case when count(c.quality_score) > 0 then round(avg(c.quality_score), 1) else null end as "averageQuality",
    coalesce(round(avg(c.duration_seconds) filter (where c.call_status = 'COMPLETED'), 1), 0)::numeric as "averageDuration"
  from filtered_calls c
  group by 1
),
operator_funnel as (
  select
    cl.operator_name as name,
    count(*)::bigint as "linkedLeads",
    count(*) filter (where l.appointment_at is not null and l.appointment_at >= cl.first_call_at)::bigint as "funnelAppointments",
    count(*) filter (where l.arrived_at is not null and l.arrived_at >= cl.first_call_at)::bigint as arrived,
    count(*) filter (where l.sold_at is not null and l.sold_at >= cl.first_call_at)::bigint as sales,
    coalesce(sum(l.sale_amount) filter (where l.sold_at is not null and l.sold_at >= cl.first_call_at), 0)::numeric as revenue
  from call_leads cl
  join public.marketing_leads l
    on l.id = cl.lead_id
   and l.company_id = p_company_id
  group by cl.operator_name
),
operator_metrics as (
  select
    ob.name,
    ob.calls,
    ob.completed,
    ob.appointments,
    ob."followUps",
    ob.scored,
    ob."averageQuality",
    ob."averageDuration",
    coalesce(ofn."linkedLeads", 0)::bigint as "linkedLeads",
    coalesce(ofn."funnelAppointments", 0)::bigint as "funnelAppointments",
    coalesce(ofn.arrived, 0)::bigint as arrived,
    coalesce(ofn.sales, 0)::bigint as sales,
    coalesce(ofn.revenue, 0)::numeric as revenue
  from operator_base ob
  left join operator_funnel ofn using (name)
),
overall_base as (
  select
    'Все операторы'::text as name,
    count(*)::bigint as calls,
    count(*) filter (where c.call_status = 'COMPLETED')::bigint as completed,
    count(*) filter (where c.appointment_created is true)::bigint as appointments,
    count(*) filter (where nullif(btrim(c.next_action), '') is not null)::bigint as "followUps",
    count(c.quality_score)::bigint as scored,
    case when count(c.quality_score) > 0 then round(avg(c.quality_score), 1) else null end as "averageQuality",
    coalesce(round(avg(c.duration_seconds) filter (where c.call_status = 'COMPLETED'), 1), 0)::numeric as "averageDuration"
  from filtered_calls c
),
overall_funnel as (
  select
    count(*)::bigint as "linkedLeads",
    count(*) filter (where l.appointment_at is not null and l.appointment_at >= cl.first_call_at)::bigint as "funnelAppointments",
    count(*) filter (where l.arrived_at is not null and l.arrived_at >= cl.first_call_at)::bigint as arrived,
    count(*) filter (where l.sold_at is not null and l.sold_at >= cl.first_call_at)::bigint as sales,
    coalesce(sum(l.sale_amount) filter (where l.sold_at is not null and l.sold_at >= cl.first_call_at), 0)::numeric as revenue
  from overall_call_leads cl
  join public.marketing_leads l
    on l.id = cl.lead_id
   and l.company_id = p_company_id
),
overall_metric as (
  select
    ob.name,
    ob.calls,
    ob.completed,
    ob.appointments,
    ob."followUps",
    ob.scored,
    ob."averageQuality",
    ob."averageDuration",
    coalesce(ofn."linkedLeads", 0)::bigint as "linkedLeads",
    coalesce(ofn."funnelAppointments", 0)::bigint as "funnelAppointments",
    coalesce(ofn.arrived, 0)::bigint as arrived,
    coalesce(ofn.sales, 0)::bigint as sales,
    coalesce(ofn.revenue, 0)::numeric as revenue
  from overall_base ob
  cross join overall_funnel ofn
),
recent_rows as (
  select c.*
  from filtered_calls c
  where p_operator is null
     or coalesce(nullif(btrim(c.operator_name), ''), 'Не назначен') = p_operator
  order by c.started_at desc
  limit 12
)
select jsonb_build_object(
  'overall', (select to_jsonb(o) from overall_metric o),
  'selected', case
    when p_operator is null then (select to_jsonb(o) from overall_metric o)
    else coalesce(
      (select to_jsonb(m) from operator_metrics m where m.name = p_operator limit 1),
      jsonb_build_object(
        'name', p_operator,
        'calls', 0,
        'completed', 0,
        'appointments', 0,
        'followUps', 0,
        'scored', 0,
        'averageQuality', null,
        'averageDuration', 0,
        'linkedLeads', 0,
        'funnelAppointments', 0,
        'arrived', 0,
        'sales', 0,
        'revenue', 0
      )
    )
  end,
  'operators', coalesce(
    (select jsonb_agg(to_jsonb(m) order by m.appointments desc, m.calls desc, m.name) from operator_metrics m),
    '[]'::jsonb
  ),
  'recent', coalesce(
    (select jsonb_agg(to_jsonb(r) order by r.started_at desc) from recent_rows r),
    '[]'::jsonb
  ),
  'range', jsonb_build_object('from', p_from, 'to', p_to, 'operator', p_operator)
);
$$;

revoke all on function public.telephony_call_analytics(uuid, timestamptz, timestamptz, text) from public;
revoke all on function public.telephony_call_analytics(uuid, timestamptz, timestamptz, text) from anon;
revoke all on function public.telephony_call_analytics(uuid, timestamptz, timestamptz, text) from authenticated;
grant execute on function public.telephony_call_analytics(uuid, timestamptz, timestamptz, text) to service_role;
