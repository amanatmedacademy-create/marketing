-- Match the existing tenant-safe contact FK semantics: only the contact id is nulled.

do $$
begin
  if exists (select 1 from pg_constraint where conname = 'marketing_calls_contact_company_fkey') then
    alter table public.marketing_calls drop constraint marketing_calls_contact_company_fkey;
  end if;
  alter table public.marketing_calls
    add constraint marketing_calls_contact_company_fkey
    foreign key (contact_id, company_id) references public.crm_contacts(id, company_id)
    on delete set null (contact_id);

  if exists (select 1 from pg_constraint where conname = 'waba_clinic_appointments_contact_company_fkey') then
    alter table public.waba_clinic_appointments drop constraint waba_clinic_appointments_contact_company_fkey;
  end if;
  alter table public.waba_clinic_appointments
    add constraint waba_clinic_appointments_contact_company_fkey
    foreign key (contact_id, company_id) references public.crm_contacts(id, company_id)
    on delete set null (contact_id);

  if exists (select 1 from pg_constraint where conname = 'patient_journey_events_contact_company_fkey') then
    alter table public.patient_journey_events drop constraint patient_journey_events_contact_company_fkey;
  end if;
  alter table public.patient_journey_events
    add constraint patient_journey_events_contact_company_fkey
    foreign key (contact_id, company_id) references public.crm_contacts(id, company_id)
    on delete set null (contact_id);

  if exists (select 1 from pg_constraint where conname = 'clinic_patients_crm_contact_company_fkey') then
    alter table public.clinic_patients drop constraint clinic_patients_crm_contact_company_fkey;
  end if;
  alter table public.clinic_patients
    add constraint clinic_patients_crm_contact_company_fkey
    foreign key (crm_contact_id, company_id) references public.crm_contacts(id, company_id)
    on delete set null (crm_contact_id);
end $$;
