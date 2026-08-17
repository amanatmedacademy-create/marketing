-- Local fallback trial for newly registered IMDS Marketing organizations.
-- Super Admin remains authoritative once a managed platform entitlement exists.

create table if not exists public.imds_product_trial_access (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.crm_companies(id) on delete cascade,
  product_code text not null default 'imds-marketing',
  status text not null default 'trial' check (status in ('trial','active','expired','suspended')),
  trial_started_at timestamptz not null default now(),
  trial_ends_at timestamptz not null default (now() + interval '3 days'),
  current_period_ends_at timestamptz,
  source text not null default 'local_trial' check (source in ('local_trial','platform')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id, product_code),
  check (trial_ends_at > trial_started_at),
  check (jsonb_typeof(metadata) = 'object')
);

create index if not exists imds_product_trial_access_company_idx
  on public.imds_product_trial_access(company_id, product_code, status, trial_ends_at);

create or replace function public.imds_create_default_marketing_trial()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  insert into public.imds_product_trial_access(
    company_id, product_code, status, trial_started_at, trial_ends_at, source
  ) values(
    new.id, 'imds-marketing', 'trial', now(), now() + interval '3 days', 'local_trial'
  )
  on conflict(company_id, product_code) do nothing;
  return new;
end;
$$;

revoke all on function public.imds_create_default_marketing_trial() from public;

drop trigger if exists crm_companies_create_marketing_trial on public.crm_companies;
create trigger crm_companies_create_marketing_trial
after insert on public.crm_companies
for each row execute function public.imds_create_default_marketing_trial();

-- Resolve expiry at read time so access is correct even if no scheduler is running.
create or replace function public.imds_marketing_trial_state(target_company_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select case
    when trial.id is null then null
    else jsonb_build_object(
      'status', case
        when trial.status = 'trial' and trial.trial_ends_at <= now() then 'expired'
        else trial.status
      end,
      'trialStartedAt', trial.trial_started_at,
      'trialEndsAt', trial.trial_ends_at,
      'periodEndsAt', trial.current_period_ends_at,
      'accessEndsAt', case
        when trial.status = 'trial' then trial.trial_ends_at
        when trial.status = 'active' then trial.current_period_ends_at
        else coalesce(trial.current_period_ends_at, trial.trial_ends_at)
      end,
      'source', trial.source
    )
  end
  from public.imds_product_trial_access trial
  where trial.company_id = target_company_id
    and trial.product_code = 'imds-marketing'
  limit 1;
$$;

revoke all on function public.imds_marketing_trial_state(uuid) from public, anon, authenticated;
grant execute on function public.imds_marketing_trial_state(uuid) to service_role;

revoke all on public.imds_product_trial_access from anon, authenticated;
grant all on public.imds_product_trial_access to service_role;

notify pgrst, 'reload schema';
