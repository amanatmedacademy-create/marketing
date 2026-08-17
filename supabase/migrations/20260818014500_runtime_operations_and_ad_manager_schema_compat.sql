begin;

-- The operations API is tenant-scoped. These legacy tables predate company isolation,
-- so add the same company boundary used by the newer Marketing resources.
alter table if exists public.marketing_campaigns
  add column if not exists company_id uuid;
alter table if exists public.marketing_tasks
  add column if not exists company_id uuid;
alter table if exists public.marketing_content_plan
  add column if not exists company_id uuid;
alter table if exists public.marketing_automations
  add column if not exists company_id uuid;
alter table if exists public.marketing_activity_log
  add column if not exists company_id uuid;

-- Existing rows belong to the legacy single-company tenant. Prefer the campaign
-- tenant for dependent rows and only fall back to the guarded single-company resolver.
update public.marketing_campaigns
set company_id = private.resolve_single_company_id()
where company_id is null;

update public.marketing_tasks as task
set company_id = coalesce(
  (select campaign.company_id from public.marketing_campaigns as campaign where campaign.id = task.campaign_id),
  private.resolve_single_company_id()
)
where task.company_id is null;

update public.marketing_content_plan as content
set company_id = coalesce(
  (select campaign.company_id from public.marketing_campaigns as campaign where campaign.id = content.campaign_id),
  private.resolve_single_company_id()
)
where content.company_id is null;

update public.marketing_automations
set company_id = private.resolve_single_company_id()
where company_id is null;

update public.marketing_activity_log
set company_id = private.resolve_single_company_id()
where company_id is null;

alter table public.marketing_campaigns
  alter column company_id set default private.resolve_single_company_id(),
  alter column company_id set not null;
alter table public.marketing_tasks
  alter column company_id set default private.resolve_single_company_id(),
  alter column company_id set not null;
alter table public.marketing_content_plan
  alter column company_id set default private.resolve_single_company_id(),
  alter column company_id set not null;
alter table public.marketing_automations
  alter column company_id set default private.resolve_single_company_id(),
  alter column company_id set not null;
alter table public.marketing_activity_log
  alter column company_id set default private.resolve_single_company_id(),
  alter column company_id set not null;

-- Add explicit tenant foreign keys once. The migration is intentionally idempotent.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'marketing_campaigns_company_id_fkey' and conrelid = 'public.marketing_campaigns'::regclass) then
    alter table public.marketing_campaigns add constraint marketing_campaigns_company_id_fkey foreign key (company_id) references public.crm_companies(id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'marketing_tasks_company_id_fkey' and conrelid = 'public.marketing_tasks'::regclass) then
    alter table public.marketing_tasks add constraint marketing_tasks_company_id_fkey foreign key (company_id) references public.crm_companies(id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'marketing_content_plan_company_id_fkey' and conrelid = 'public.marketing_content_plan'::regclass) then
    alter table public.marketing_content_plan add constraint marketing_content_plan_company_id_fkey foreign key (company_id) references public.crm_companies(id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'marketing_automations_company_id_fkey' and conrelid = 'public.marketing_automations'::regclass) then
    alter table public.marketing_automations add constraint marketing_automations_company_id_fkey foreign key (company_id) references public.crm_companies(id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'marketing_activity_log_company_id_fkey' and conrelid = 'public.marketing_activity_log'::regclass) then
    alter table public.marketing_activity_log add constraint marketing_activity_log_company_id_fkey foreign key (company_id) references public.crm_companies(id) on delete cascade;
  end if;
end
$$;

create index if not exists marketing_campaigns_company_created_idx
  on public.marketing_campaigns (company_id, created_at desc);
create index if not exists marketing_tasks_company_due_idx
  on public.marketing_tasks (company_id, done, due_on);
create index if not exists marketing_content_plan_company_publish_idx
  on public.marketing_content_plan (company_id, publish_on);
create index if not exists marketing_automations_company_created_idx
  on public.marketing_automations (company_id, created_at desc);
create index if not exists marketing_activity_log_company_created_idx
  on public.marketing_activity_log (company_id, created_at desc);

-- The current Meta SDK already persists these values and Ad Manager selects them.
-- Keep them nullable because historical advertising rows do not contain account metadata.
alter table if exists public.marketing_ads
  add column if not exists account_status text,
  add column if not exists account_timezone text,
  add column if not exists effective_status text;

update public.marketing_ads
set effective_status = status
where effective_status is null
  and status is not null;

create index if not exists marketing_ads_company_report_idx
  on public.marketing_ads (company_id, report_date desc);

notify pgrst, 'reload schema';

commit;
