-- Automatic inbound integration -> branch routing.
-- Short-lived claims are created by the worker before provider handlers write data.
-- The branch trigger consumes an unambiguous active claim before falling back to primary branch.

create table if not exists public.imds_integration_route_claims (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.crm_companies(id) on delete cascade,
  branch_id uuid not null references public.crm_branches(id) on delete cascade,
  provider text not null check (provider in ('waba','zadarma','bitrix','meta','tiktok')),
  route_kind text not null,
  route_value text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create index if not exists imds_integration_route_claims_lookup_idx
  on public.imds_integration_route_claims(company_id, provider, route_kind, route_value, expires_at desc);
create index if not exists imds_integration_route_claims_expiry_idx
  on public.imds_integration_route_claims(expires_at);

alter table public.imds_integration_route_claims enable row level security;
revoke all on public.imds_integration_route_claims from anon, authenticated;
grant all on public.imds_integration_route_claims to service_role;

create or replace function public.imds_current_route_claim_branch(p_company_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  resolved uuid;
  route_count integer;
begin
  if p_company_id is null then return null; end if;
  select count(distinct c.branch_id), min(c.branch_id)
    into route_count, resolved
  from public.imds_integration_route_claims c
  join public.crm_branches b on b.id = c.branch_id and b.company_id = c.company_id and b.status <> 'archived'
  where c.company_id = p_company_id and c.expires_at > now();
  if route_count = 1 then return resolved; end if;
  return null;
end;
$$;
revoke all on function public.imds_current_route_claim_branch(uuid) from public, anon, authenticated;
grant execute on function public.imds_current_route_claim_branch(uuid) to service_role;

create or replace function public.imds_assign_validate_branch()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  resolved_branch uuid;
begin
  if new.company_id is null then return new; end if;
  if new.branch_id is null then
    resolved_branch := public.imds_current_route_claim_branch(new.company_id);
  end if;
  if new.branch_id is null and resolved_branch is null then
    select b.id into resolved_branch
    from public.crm_branches b
    where b.company_id = new.company_id and b.is_primary = true and b.status <> 'archived'
    order by b.created_at asc limit 1;
  end if;
  if new.branch_id is null then new.branch_id := resolved_branch; end if;
  if new.branch_id is not null and not exists (
    select 1 from public.crm_branches b where b.id = new.branch_id and b.company_id = new.company_id and b.status <> 'archived'
  ) then raise exception 'Branch does not belong to company'; end if;
  return new;
end;
$$;
revoke all on function public.imds_assign_validate_branch() from public, anon, authenticated;
grant execute on function public.imds_assign_validate_branch() to service_role;

-- Webhook event rows also need branch provenance for diagnostics/idempotency.
do $$
begin
  if to_regclass('public.integration_events') is not null then
    alter table public.integration_events add column if not exists branch_id uuid references public.crm_branches(id) on delete set null;
    create index if not exists integration_events_company_branch_idx on public.integration_events(company_id, branch_id);
    drop trigger if exists trg_integration_events_branch_scope on public.integration_events;
    create trigger trg_integration_events_branch_scope before insert or update of company_id, branch_id on public.integration_events for each row execute function public.imds_assign_validate_branch();
  end if;
end $$;

-- Helpful branch-local uniqueness. Legacy indexes remain for compatibility with existing PostgREST on_conflict calls;
-- routed inserts still receive branch_id before conflict evaluation and keep branch provenance.
create index if not exists marketing_leads_branch_external_idx on public.marketing_leads(company_id, branch_id, external_id) where external_id is not null;
create index if not exists marketing_ads_branch_external_date_idx on public.marketing_ads(company_id, branch_id, external_id, report_date) where external_id is not null and report_date is not null;
create index if not exists marketing_daily_metrics_branch_date_idx on public.marketing_daily_metrics(company_id, branch_id, date, source, platform);

notify pgrst, 'reload schema';
