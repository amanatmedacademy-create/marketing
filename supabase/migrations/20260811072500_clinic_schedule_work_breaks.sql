alter table public.waba_clinic_schedules
  add column if not exists break_start time without time zone,
  add column if not exists break_end time without time zone;

alter table public.waba_clinic_schedules
  drop constraint if exists waba_clinic_schedules_break_check;

alter table public.waba_clinic_schedules
  add constraint waba_clinic_schedules_break_check
  check (
    (break_start is null and break_end is null)
    or (
      break_start is not null and break_end is not null
      and break_start < break_end
      and break_start >= start_time
      and break_end <= end_time
    )
  );
