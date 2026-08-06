create table if not exists public.crm_deal_activities (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.crm_companies(id) on delete cascade,
  deal_id uuid not null references public.crm_deals(id) on delete cascade,
  activity_type text not null,
  body text not null,
  due_at timestamptz,
  completed_at timestamptz,
  actor_user_id uuid references public.marketing_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint crm_deal_activities_type_check check (activity_type in ('comment','task','note')),
  constraint crm_deal_activities_body_check check (char_length(btrim(body)) between 1 and 5000)
);

create index if not exists crm_deal_activities_deal_created_idx
  on public.crm_deal_activities (company_id, deal_id, created_at desc);

create index if not exists crm_deal_activities_due_idx
  on public.crm_deal_activities (company_id, due_at)
  where activity_type = 'task' and completed_at is null and due_at is not null;

alter table public.crm_deal_activities enable row level security;

drop policy if exists crm_deal_activities_member_select on public.crm_deal_activities;
create policy crm_deal_activities_member_select
  on public.crm_deal_activities for select to authenticated
  using ((select public.is_company_member(company_id)));

drop policy if exists crm_deal_activities_member_insert on public.crm_deal_activities;
create policy crm_deal_activities_member_insert
  on public.crm_deal_activities for insert to authenticated
  with check ((select public.is_company_member(company_id)));

drop policy if exists crm_deal_activities_member_update on public.crm_deal_activities;
create policy crm_deal_activities_member_update
  on public.crm_deal_activities for update to authenticated
  using ((select public.is_company_member(company_id)))
  with check ((select public.is_company_member(company_id)));

create or replace function public.crm_deal_activities_set_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_crm_deal_activities_set_updated_at on public.crm_deal_activities;
create trigger trg_crm_deal_activities_set_updated_at
before update on public.crm_deal_activities
for each row execute function public.crm_deal_activities_set_updated_at();
