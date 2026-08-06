-- Rebuild the sales funnel on the existing normalized CRM core.
-- Legacy sales_funnel_* tables remain untouched until the migration is verified.

alter table public.crm_deals
  add column if not exists marketing_lead_id uuid references public.marketing_leads(id) on delete set null,
  add column if not exists diagnost_user_id uuid references public.marketing_users(id) on delete set null,
  add column if not exists priority text not null default 'MEDIUM',
  add column if not exists description text,
  add column if not exists lost_reason text,
  add column if not exists next_action text,
  add column if not exists next_action_at timestamptz,
  add column if not exists stage_entered_at timestamptz not null default now(),
  add column if not exists paid boolean not null default false;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'crm_deals_priority_check'
      and conrelid = 'public.crm_deals'::regclass
  ) then
    alter table public.crm_deals
      add constraint crm_deals_priority_check
      check (priority in ('LOW','MEDIUM','HIGH','URGENT'));
  end if;
end $$;

create index if not exists crm_deals_pipeline_stage_position_idx
  on public.crm_deals (company_id, pipeline_id, stage_id, position, updated_at desc)
  where deleted_at is null;

create index if not exists crm_deals_marketing_lead_idx
  on public.crm_deals (marketing_lead_id)
  where marketing_lead_id is not null and deleted_at is null;

create index if not exists crm_deals_diagnost_idx
  on public.crm_deals (diagnost_user_id)
  where diagnost_user_id is not null and deleted_at is null;

create index if not exists crm_deals_next_action_idx
  on public.crm_deals (company_id, next_action_at)
  where next_action_at is not null and deleted_at is null and status = 'open';

create index if not exists crm_pipeline_stages_pipeline_position_idx
  on public.crm_pipeline_stages (company_id, pipeline_id, position);

create table if not exists public.crm_deal_stage_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.crm_companies(id) on delete cascade,
  deal_id uuid not null references public.crm_deals(id) on delete cascade,
  pipeline_id uuid not null references public.crm_pipelines(id) on delete cascade,
  from_stage_id uuid references public.crm_pipeline_stages(id) on delete set null,
  to_stage_id uuid not null references public.crm_pipeline_stages(id) on delete restrict,
  actor_user_id uuid references public.marketing_users(id) on delete set null,
  reason text,
  created_at timestamptz not null default now()
);

create index if not exists crm_deal_stage_events_deal_created_idx
  on public.crm_deal_stage_events (deal_id, created_at desc);
create index if not exists crm_deal_stage_events_pipeline_created_idx
  on public.crm_deal_stage_events (company_id, pipeline_id, created_at desc);
create index if not exists crm_deal_stage_events_actor_idx
  on public.crm_deal_stage_events (actor_user_id)
  where actor_user_id is not null;

alter table public.crm_deal_stage_events enable row level security;

drop policy if exists crm_deal_stage_events_member_select on public.crm_deal_stage_events;
create policy crm_deal_stage_events_member_select
  on public.crm_deal_stage_events for select to authenticated
  using ((select public.is_company_member(company_id)));

drop policy if exists crm_deal_stage_events_member_insert on public.crm_deal_stage_events;
create policy crm_deal_stage_events_member_insert
  on public.crm_deal_stage_events for insert to authenticated
  with check ((select public.is_company_member(company_id)));

create or replace function public.crm_apply_deal_stage_state()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  target_type text;
begin
  select stage_type into target_type
  from public.crm_pipeline_stages
  where id = new.stage_id
    and pipeline_id = new.pipeline_id
    and company_id = new.company_id;

  if target_type is null then
    raise exception 'Target stage does not belong to the deal pipeline and company';
  end if;

  if tg_op = 'INSERT' or new.stage_id is distinct from old.stage_id then
    new.stage_entered_at := now();
  end if;

  if target_type = 'won' then
    new.status := 'won';
    new.won_at := coalesce(new.won_at, now());
    new.lost_at := null;
    new.lost_reason := null;
  elsif target_type = 'lost' then
    new.status := 'lost';
    new.lost_at := coalesce(new.lost_at, now());
    new.won_at := null;
  else
    new.status := 'open';
    new.won_at := null;
    new.lost_at := null;
    new.lost_reason := null;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_crm_apply_deal_stage_state on public.crm_deals;
create trigger trg_crm_apply_deal_stage_state
before insert or update of company_id, pipeline_id, stage_id
on public.crm_deals
for each row execute function public.crm_apply_deal_stage_state();

create or replace function public.crm_log_deal_stage_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' or new.stage_id is distinct from old.stage_id or new.pipeline_id is distinct from old.pipeline_id then
    insert into public.crm_deal_stage_events (
      company_id, deal_id, pipeline_id, from_stage_id, to_stage_id, actor_user_id, reason
    ) values (
      new.company_id,
      new.id,
      new.pipeline_id,
      case when tg_op = 'INSERT' then null else old.stage_id end,
      new.stage_id,
      public.current_marketing_user_id(),
      null
    );
  end if;
  return new;
end;
$$;

revoke all on function public.crm_log_deal_stage_change() from public, anon, authenticated;
grant execute on function public.crm_log_deal_stage_change() to service_role;

drop trigger if exists trg_crm_log_deal_stage_change on public.crm_deals;
create trigger trg_crm_log_deal_stage_change
after insert or update of pipeline_id, stage_id
on public.crm_deals
for each row execute function public.crm_log_deal_stage_change();

create or replace function public.crm_move_deal(
  deal_id_value uuid,
  pipeline_id_value uuid,
  stage_id_value uuid,
  position_value numeric default null,
  reason_value text default null,
  actor_user_id_value uuid default null
)
returns public.crm_deals
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_deal public.crm_deals%rowtype;
  target_stage public.crm_pipeline_stages%rowtype;
  updated_deal public.crm_deals%rowtype;
begin
  select * into current_deal
  from public.crm_deals
  where id = deal_id_value and deleted_at is null
  for update;

  if not found then raise exception 'Deal not found'; end if;

  select * into target_stage
  from public.crm_pipeline_stages
  where id = stage_id_value
    and pipeline_id = pipeline_id_value
    and company_id = current_deal.company_id;

  if not found then raise exception 'Target stage not found in target pipeline'; end if;

  update public.crm_deals
  set pipeline_id = pipeline_id_value,
      stage_id = stage_id_value,
      position = coalesce(position_value, extract(epoch from clock_timestamp()) * 1000),
      updated_at = now()
  where id = deal_id_value
  returning * into updated_deal;

  update public.crm_deal_stage_events
  set reason = nullif(btrim(reason_value), ''),
      actor_user_id = coalesce(actor_user_id_value, actor_user_id)
  where id = (
    select id from public.crm_deal_stage_events
    where deal_id = deal_id_value
    order by created_at desc
    limit 1
  );

  return updated_deal;
end;
$$;

revoke all on function public.crm_move_deal(uuid, uuid, uuid, numeric, text, uuid) from public, anon, authenticated;
grant execute on function public.crm_move_deal(uuid, uuid, uuid, numeric, text, uuid) to service_role;

-- Link unambiguous existing marketing leads to matching CRM deals by normalized phone.
with marketing_normalized as (
  select id,
    case
      when digits ~ '^8\d{10}$' then '7' || substr(digits, 2)
      when length(digits) = 10 then '7' || digits
      else digits
    end normalized
  from (
    select id, regexp_replace(phone, '\D', '', 'g') digits
    from public.marketing_leads
    where phone is not null and crm_deal_id is null
  ) x
),
deal_normalized as (
  select id,
    case
      when digits ~ '^8\d{10}$' then '7' || substr(digits, 2)
      when length(digits) = 10 then '7' || digits
      else digits
    end normalized
  from (
    select id, regexp_replace(phone, '\D', '', 'g') digits
    from public.crm_deals
    where phone is not null and deleted_at is null
  ) x
),
unique_matches as (
  select m.id marketing_lead_id, min(d.id) deal_id
  from marketing_normalized m
  join deal_normalized d using (normalized)
  where length(m.normalized) >= 10
  group by m.id
  having count(*) = 1
)
update public.marketing_leads ml
set crm_deal_id = u.deal_id,
    updated_at = now()
from unique_matches u
where ml.id = u.marketing_lead_id;

update public.crm_deals d
set marketing_lead_id = ml.id,
    updated_at = now()
from public.marketing_leads ml
where ml.crm_deal_id = d.id
  and d.marketing_lead_id is null;
