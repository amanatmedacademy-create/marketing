create index if not exists mis_outbox_appointment_company_idx
  on public.mis_outbox(appointment_id, company_id);

create or replace function private.enqueue_mis_appointment_outbox()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  outbox_action text := 'upsert';
begin
  if upper(coalesce(new.source, '')) = 'MIS' then
    return new;
  end if;

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

  if new.status = 'CANCELLED'
     and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    outbox_action := 'cancel';
  end if;

  if tg_op = 'UPDATE'
     and old.status is not distinct from new.status
     and old.starts_at is not distinct from new.starts_at
     and old.ends_at is not distinct from new.ends_at
     and old.patient_name is not distinct from new.patient_name
     and old.phone is not distinct from new.phone
     and old.branch_id is not distinct from new.branch_id
     and old.doctor_id is not distinct from new.doctor_id
     and old.patient_id is not distinct from new.patient_id then
    return new;
  end if;

  if not exists (
    select 1
    from public.mis_outbox o
    where o.company_id = new.company_id
      and o.appointment_id = new.id
      and o.action = outbox_action
      and o.status in ('pending', 'processing')
  ) then
    insert into public.mis_outbox(company_id, appointment_id, action, status, available_at)
    values (new.company_id, new.id, outbox_action, 'pending', now());
  end if;

  return new;
end;
$$;
