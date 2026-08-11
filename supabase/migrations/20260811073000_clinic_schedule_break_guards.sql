create or replace function private.guard_clinic_appointment_against_schedule_breaks()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  local_start time;
  local_end time;
  local_weekday smallint;
begin
  if new.status not in ('BOOKED','CONFIRMED','ARRIVED') then
    return new;
  end if;

  local_start := (new.starts_at at time zone 'Asia/Almaty')::time;
  local_end := (new.ends_at at time zone 'Asia/Almaty')::time;
  local_weekday := extract(dow from (new.starts_at at time zone 'Asia/Almaty'))::smallint;

  if exists (
    select 1
    from public.waba_clinic_schedules s
    where s.company_id = new.company_id
      and s.doctor_id = new.doctor_id
      and s.weekday = local_weekday
      and s.active = true
      and s.break_start is not null
      and s.break_end is not null
      and local_start < s.break_end
      and local_end > s.break_start
  ) then
    raise exception using errcode = '23514', message = 'Время попадает в перерыв специалиста';
  end if;

  return new;
end;
$$;

revoke all on function private.guard_clinic_appointment_against_schedule_breaks() from public, anon, authenticated;

drop trigger if exists waba_clinic_appointments_break_guard on public.waba_clinic_appointments;
create trigger waba_clinic_appointments_break_guard
before insert or update of doctor_id, starts_at, ends_at, status
on public.waba_clinic_appointments
for each row execute function private.guard_clinic_appointment_against_schedule_breaks();
