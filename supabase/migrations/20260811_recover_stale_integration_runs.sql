update public.integration_runs
set status = 'failed',
    finished_at = coalesce(finished_at, now()),
    error = coalesce(error, 'stale_run_recovered'),
    metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('recovered_stale_run', true, 'recovered_at', now())
where status = 'running'
  and started_at < now() - interval '2 hours';

create or replace function public.recover_stale_integration_runs(max_age interval default interval '2 hours')
returns integer
language plpgsql
security invoker
as $$
declare
  affected integer;
begin
  update public.integration_runs
  set status = 'failed',
      finished_at = coalesce(finished_at, now()),
      error = coalesce(error, 'stale_run_recovered'),
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('recovered_stale_run', true, 'recovered_at', now())
  where status = 'running'
    and started_at < now() - max_age;
  get diagnostics affected = row_count;
  return affected;
end;
$$;
