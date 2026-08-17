-- Team administration foundation: richer tenant roles and personal invitations.

do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid='public.crm_company_members'::regclass
      and contype='c' and pg_get_constraintdef(oid) ilike '%role%'
  loop execute format('alter table public.crm_company_members drop constraint %I', c.conname); end loop;
end $$;

alter table public.crm_company_members
  add constraint crm_company_members_role_check
  check (role in ('owner','administrator','manager','marketer','operator','analyst','viewer'));

do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid='public.crm_company_onboarding'::regclass
      and contype='c' and pg_get_constraintdef(oid) ilike '%requested_role%'
  loop execute format('alter table public.crm_company_onboarding drop constraint %I', c.conname); end loop;
end $$;

alter table public.crm_company_onboarding
  add constraint crm_company_onboarding_requested_role_check
  check (requested_role in ('administrator','manager','marketer','operator','analyst','viewer'));

create table if not exists public.crm_company_invitations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.crm_companies(id) on delete cascade,
  email text not null,
  phone text,
  role text not null default 'viewer' check (role in ('administrator','manager','marketer','operator','analyst','viewer')),
  status text not null default 'pending' check (status in ('pending','accepted','revoked','expired')),
  code_hash text not null unique,
  join_code_id uuid references public.crm_company_join_codes(id) on delete set null,
  invited_by uuid references public.marketing_users(id) on delete set null,
  accepted_by uuid references public.marketing_users(id) on delete set null,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists crm_company_invitations_company_status_idx
  on public.crm_company_invitations(company_id,status,created_at desc);
create index if not exists crm_company_invitations_email_idx
  on public.crm_company_invitations(company_id,lower(btrim(email)),status);
create unique index if not exists crm_company_invitations_pending_email_uidx
  on public.crm_company_invitations(company_id,lower(btrim(email))) where status='pending';

alter table public.crm_company_invitations enable row level security;
revoke all on public.crm_company_invitations from anon, authenticated;
grant all on public.crm_company_invitations to service_role;

notify pgrst, 'reload schema';
