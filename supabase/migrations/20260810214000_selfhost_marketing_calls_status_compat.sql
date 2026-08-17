-- Align clean self-hosted replays with the live production contract used by
-- Speed-to-Lead triggers. This column exists in production before the checked-in
-- 20260810214611 migration references it.
alter table public.marketing_calls
  add column if not exists call_status text not null default 'COMPLETED';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'marketing_calls_status_check'
      and conrelid = 'public.marketing_calls'::regclass
  ) then
    alter table public.marketing_calls
      add constraint marketing_calls_status_check
      check (call_status in ('PENDING','COMPLETED','CANCELLED'));
  end if;
end
$$;

notify pgrst, 'reload schema';
