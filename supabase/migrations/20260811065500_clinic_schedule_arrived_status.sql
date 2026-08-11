alter table public.waba_clinic_appointments
  drop constraint if exists waba_clinic_appointments_status_check;

alter table public.waba_clinic_appointments
  add constraint waba_clinic_appointments_status_check
  check (status = any (array['BOOKED'::text,'CONFIRMED'::text,'ARRIVED'::text,'COMPLETED'::text,'CANCELLED'::text,'NO_SHOW'::text]));

create or replace function private.guard_clinic_appointment_against_blocks()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status in ('BOOKED','CONFIRMED','ARRIVED') and exists (
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
      and a.status in ('BOOKED','CONFIRMED','ARRIVED')
      and a.starts_at < new.ends_at
      and a.ends_at > new.starts_at
  ) then
    raise exception using errcode = '23514', message = 'Нельзя закрыть время: в интервале уже есть активная запись';
  end if;
  return new;
end;
$$;

revoke all on function private.guard_clinic_block_against_appointments() from public, anon, authenticated;

create or replace function private.sync_clinic_appointment_arrival_growth()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'ARRIVED'
     and new.lead_id is not null
     and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    insert into public.patient_journey_events (
      company_id, lead_id, event_type, occurred_at, channel, source,
      external_id, dedupe_key, metadata
    ) values (
      new.company_id, new.lead_id, 'arrived', coalesce(new.updated_at, now()),
      'clinic', coalesce(new.source, 'Clinic Schedule'), new.id::text,
      'appointment:' || new.id::text || ':arrived',
      jsonb_build_object('appointment_id', new.id, 'doctor_id', new.doctor_id, 'branch_id', new.branch_id)
    )
    on conflict (company_id, dedupe_key) do nothing;

    insert into public.conversion_events (
      company_id, lead_id, event_name, occurred_at, destination,
      sync_status, dedupe_key, payload
    ) values (
      new.company_id, new.lead_id, 'arrived', coalesce(new.updated_at, now()),
      'unknown', 'skipped', 'appointment:' || new.id::text || ':arrived',
      jsonb_build_object('appointment_id', new.id, 'source', coalesce(new.source, 'Clinic Schedule'))
    )
    on conflict (company_id, dedupe_key) do nothing;
  end if;
  return new;
end;
$$;

revoke all on function private.sync_clinic_appointment_arrival_growth() from public, anon, authenticated;

drop trigger if exists waba_clinic_appointments_arrival_growth on public.waba_clinic_appointments;
create trigger waba_clinic_appointments_arrival_growth
after insert or update of status
on public.waba_clinic_appointments
for each row execute function private.sync_clinic_appointment_arrival_growth();
