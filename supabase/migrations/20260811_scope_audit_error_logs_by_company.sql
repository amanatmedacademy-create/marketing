do $$
declare
  v_company_id uuid;
  v_has_unscoped_rows boolean;
begin
  alter table public.audit_logs add column if not exists company_id uuid;
  alter table public.error_logs add column if not exists company_id uuid;

  select exists(select 1 from public.audit_logs where company_id is null)
      or exists(select 1 from public.error_logs where company_id is null)
    into v_has_unscoped_rows;

  select id into v_company_id
  from public.crm_companies
  order by created_at asc
  limit 1;

  -- Clean self-hosted bootstrap legitimately has no company and no log rows yet.
  -- Existing unscoped rows, however, must never be silently accepted without a tenant.
  if v_company_id is null and v_has_unscoped_rows then
    raise exception 'Cannot backfill audit/error logs: unscoped rows exist but no crm company exists';
  end if;

  if v_company_id is not null then
    update public.audit_logs set company_id = v_company_id where company_id is null;
    update public.error_logs set company_id = v_company_id where company_id is null;
  end if;
end $$;

alter table public.audit_logs alter column company_id set not null;
alter table public.error_logs alter column company_id set not null;

alter table public.audit_logs drop constraint if exists audit_logs_company_id_fkey;
alter table public.error_logs drop constraint if exists error_logs_company_id_fkey;
alter table public.audit_logs add constraint audit_logs_company_id_fkey foreign key (company_id) references public.crm_companies(id) on delete restrict;
alter table public.error_logs add constraint error_logs_company_id_fkey foreign key (company_id) references public.crm_companies(id) on delete restrict;

alter table public.error_logs drop constraint if exists error_logs_fingerprint_key;
alter table public.error_logs add constraint error_logs_company_fingerprint_key unique (company_id, fingerprint);

create index if not exists audit_logs_company_created_idx on public.audit_logs(company_id, created_at desc);
create index if not exists error_logs_company_last_seen_idx on public.error_logs(company_id, last_seen_at desc);
