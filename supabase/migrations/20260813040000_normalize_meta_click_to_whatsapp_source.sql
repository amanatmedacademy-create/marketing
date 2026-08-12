create or replace function public.refresh_crm_daily_metrics(
  p_company_id uuid,
  p_date_from date default null,
  p_date_to date default null
)
returns void
language sql
security invoker
set search_path = public
as $$
  insert into public.marketing_daily_metrics (
    company_id,
    date,
    source,
    platform,
    leads,
    target_leads,
    arrived,
    sales,
    revenue,
    crm_synced_at,
    updated_at
  )
  select
    leads.company_id,
    leads.lead_created_at::date,
    case
      when leads.source = 'Meta Click-to-WhatsApp' then 'Meta'
      else coalesce(nullif(leads.source, ''), 'Не определено')
    end,
    coalesce(nullif(leads.platform, ''), 'Не определено'),
    count(*)::integer,
    count(*) filter (where leads.is_target)::integer,
    count(*) filter (where leads.arrived_at is not null)::integer,
    count(*) filter (where leads.sold_at is not null)::integer,
    sum(coalesce(leads.sale_amount, 0)),
    now(),
    now()
  from public.marketing_leads leads
  where leads.company_id = p_company_id
    and (p_date_from is null or leads.lead_created_at::date >= p_date_from)
    and (p_date_to is null or leads.lead_created_at::date <= p_date_to)
  group by
    leads.company_id,
    leads.lead_created_at::date,
    case
      when leads.source = 'Meta Click-to-WhatsApp' then 'Meta'
      else coalesce(nullif(leads.source, ''), 'Не определено')
    end,
    coalesce(nullif(leads.platform, ''), 'Не определено')
  on conflict (company_id, date, source, platform)
  do update set
    leads = excluded.leads,
    target_leads = excluded.target_leads,
    arrived = excluded.arrived,
    sales = excluded.sales,
    revenue = excluded.revenue,
    crm_synced_at = excluded.crm_synced_at,
    updated_at = excluded.updated_at;
$$;

grant execute on function public.refresh_crm_daily_metrics(uuid, date, date) to service_role;
