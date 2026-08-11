create or replace function private.enqueue_mis_appointment_outbox()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if current_setting('imds.mis_inbound', true) = 'true' then
    return new;
  end if;

  if not exists (
    select 1
    from public.mis_settings s
    where s.company_id = new.company_id
      and s.enabled = true
      and s.push_appointments = true
  ) then
    return new;
  end if;

  insert into public.mis_outbox(company_id, appointment_id, action, status, available_at)
  select
    new.company_id,
    new.id,
    case
      when new.status = 'CANCELLED'
       and (tg_op = 'INSERT' or old.status is distinct from new.status)
        then 'cancel'
      else 'upsert'
    end,
    'pending',
    now()
  where not exists (
    select 1
    from public.mis_outbox o
    where o.company_id = new.company_id
      and o.appointment_id = new.id
      and o.action = case
        when new.status = 'CANCELLED'
         and (tg_op = 'INSERT' or old.status is distinct from new.status)
          then 'cancel'
        else 'upsert'
      end
      and o.status in ('pending', 'processing')
  );

  return new;
end;
$$;

drop trigger if exists waba_clinic_appointments_mis_outbox on public.waba_clinic_appointments;
create trigger waba_clinic_appointments_mis_outbox
after insert or update on public.waba_clinic_appointments
for each row execute function private.enqueue_mis_appointment_outbox();
