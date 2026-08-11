create or replace function private.mask_mis_appointment_for_marketing()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if upper(coalesce(new.source, '')) = 'MIS' then
    new.patient_name := 'Занято';
    new.phone := '';
    new.patient_id := null;
    new.lead_id := null;
    new.conversation_id := null;
    new.metadata := (coalesce(new.metadata, '{}'::jsonb) - 'mis') || jsonb_build_object('external_busy', true);
  end if;
  return new;
end;
$$;

revoke all on function private.mask_mis_appointment_for_marketing() from public, anon, authenticated;

drop trigger if exists waba_clinic_appointments_mask_mis on public.waba_clinic_appointments;
create trigger waba_clinic_appointments_mask_mis
before insert or update on public.waba_clinic_appointments
for each row execute function private.mask_mis_appointment_for_marketing();

update public.waba_clinic_appointments
set patient_name = 'Занято',
    phone = '',
    patient_id = null,
    lead_id = null,
    conversation_id = null,
    metadata = (coalesce(metadata, '{}'::jsonb) - 'mis') || jsonb_build_object('external_busy', true),
    updated_at = now()
where upper(source) = 'MIS';
