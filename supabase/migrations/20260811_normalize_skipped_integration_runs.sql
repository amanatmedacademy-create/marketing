update public.integration_runs
set status = 'skipped'
where status = 'success'
  and coalesce((metadata->>'skipped')::boolean, false) = true;

create or replace function public.normalize_skipped_integration_run_status()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'success'
     and coalesce((new.metadata->>'skipped')::boolean, false) = true then
    new.status := 'skipped';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_normalize_skipped_integration_run_status on public.integration_runs;
create trigger trg_normalize_skipped_integration_run_status
before insert or update of status, metadata on public.integration_runs
for each row execute function public.normalize_skipped_integration_run_status();
