-- Branch operational scope for CRM, tasks, inbox, telephony, integrations and analytics.
-- crm_companies remains the tenant boundary. Existing rows are assigned to each clinic's primary branch.

create or replace function public.imds_assign_validate_branch()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  resolved_branch uuid;
begin
  if new.company_id is null then
    return new;
  end if;

  if new.branch_id is null then
    select b.id into resolved_branch
    from public.crm_branches b
    where b.company_id = new.company_id and b.is_primary = true and b.status <> 'archived'
    order by b.created_at asc
    limit 1;
    new.branch_id := resolved_branch;
  end if;

  if new.branch_id is not null and not exists (
    select 1 from public.crm_branches b
    where b.id = new.branch_id and b.company_id = new.company_id and b.status <> 'archived'
  ) then
    raise exception 'Branch does not belong to company';
  end if;
  return new;
end;
$$;

revoke all on function public.imds_assign_validate_branch() from public, anon, authenticated;
grant execute on function public.imds_assign_validate_branch() to service_role;

do $$
declare
  table_name text;
  tables text[] := array[
    'marketing_leads',
    'crm_tasks',
    'integration_credentials',
    'marketing_calls',
    'marketing_conversations',
    'marketing_messages',
    'marketing_daily_metrics',
    'marketing_ads',
    'telephony_callback_requests',
    'integration_runs'
  ];
begin
  foreach table_name in array tables loop
    if to_regclass('public.' || table_name) is not null
      and exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = table_name and column_name = 'company_id'
      ) then
      execute format('alter table public.%I add column if not exists branch_id uuid references public.crm_branches(id) on delete set null', table_name);
      execute format('create index if not exists %I on public.%I(company_id, branch_id)', table_name || '_company_branch_idx', table_name);
      execute format('drop trigger if exists %I on public.%I', 'trg_' || table_name || '_branch_scope', table_name);
      execute format('create trigger %I before insert or update of company_id, branch_id on public.%I for each row execute function public.imds_assign_validate_branch()', 'trg_' || table_name || '_branch_scope', table_name);
    end if;
  end loop;
end $$;

-- Backfill primary branch for all operational rows that already belong to a clinic.
do $$
declare
  table_name text;
  tables text[] := array[
    'marketing_leads',
    'crm_tasks',
    'integration_credentials',
    'marketing_calls',
    'marketing_conversations',
    'marketing_daily_metrics',
    'marketing_ads',
    'telephony_callback_requests',
    'integration_runs'
  ];
begin
  foreach table_name in array tables loop
    if to_regclass('public.' || table_name) is not null
      and exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = table_name and column_name = 'branch_id'
      ) then
      execute format(
        'update public.%I t set branch_id = b.id from public.crm_branches b where t.company_id = b.company_id and b.is_primary = true and b.status <> ''archived'' and t.branch_id is null',
        table_name
      );
    end if;
  end loop;
end $$;

-- Messages inherit their conversation branch when possible.
do $$
begin
  if to_regclass('public.marketing_messages') is not null
    and to_regclass('public.marketing_conversations') is not null
    and exists (select 1 from information_schema.columns where table_schema='public' and table_name='marketing_messages' and column_name='branch_id') then
    update public.marketing_messages m
      set branch_id = c.branch_id
    from public.marketing_conversations c
    where m.conversation_id = c.id and m.company_id = c.company_id and c.branch_id is not null
      and m.branch_id is distinct from c.branch_id;
  end if;
end $$;

-- Optional funnel scope when the table is tenant-aware.
do $$
begin
  if to_regclass('public.sales_funnel_leads') is not null
    and exists (select 1 from information_schema.columns where table_schema='public' and table_name='sales_funnel_leads' and column_name='company_id') then
    alter table public.sales_funnel_leads add column if not exists branch_id uuid references public.crm_branches(id) on delete set null;
    create index if not exists sales_funnel_leads_company_branch_idx on public.sales_funnel_leads(company_id, branch_id);
    update public.sales_funnel_leads t set branch_id = b.id
      from public.crm_branches b
      where t.company_id=b.company_id and b.is_primary=true and b.status<>'archived' and t.branch_id is null;
    drop trigger if exists trg_sales_funnel_leads_branch_scope on public.sales_funnel_leads;
    create trigger trg_sales_funnel_leads_branch_scope before insert or update of company_id, branch_id on public.sales_funnel_leads
      for each row execute function public.imds_assign_validate_branch();
  end if;
end $$;

notify pgrst, 'reload schema';
