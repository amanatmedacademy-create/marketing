create schema if not exists private;

create or replace function private.guard_clinic_appointment_against_blocks()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status in ('BOOKED','CONFIRMED') and exists (
    select 1
    from public.waba_clinic_schedule_blocks b
    where b.company_id = new.company_id
      and b.doctor_id = new.doctor_id
      and b.starts_at < new.ends_at
      and b.ends_at > new.starts_at
  ) then
    raise exception using errcode = '23514', message = 'В выбранном времени специалист недоступен';
  end if;
  return new;
end;
$$;

revoke all on function private.guard_clinic_appointment_against_blocks() from public, anon, authenticated;

drop trigger if exists waba_clinic_appointments_block_guard on public.waba_clinic_appointments;
create trigger waba_clinic_appointments_block_guard
before insert or update of doctor_id, starts_at, ends_at, status
on public.waba_clinic_appointments
for each row execute function private.guard_clinic_appointment_against_blocks();

create or replace function private.guard_clinic_block_against_appointments()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.waba_clinic_appointments a
    where a.company_id = new.company_id
      and a.doctor_id = new.doctor_id
      and a.status in ('BOOKED','CONFIRMED')
      and a.starts_at < new.ends_at
      and a.ends_at > new.starts_at
  ) then
    raise exception using errcode = '23514', message = 'Нельзя закрыть время: в интервале уже есть активная запись';
  end if;
  return new;
end;
$$;

revoke all on function private.guard_clinic_block_against_appointments() from public, anon, authenticated;

drop trigger if exists waba_clinic_schedule_blocks_appointment_guard on public.waba_clinic_schedule_blocks;
create trigger waba_clinic_schedule_blocks_appointment_guard
before insert or update of doctor_id, starts_at, ends_at
on public.waba_clinic_schedule_blocks
for each row execute function private.guard_clinic_block_against_appointments();
