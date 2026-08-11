alter table public.waba_clinic_branches
  add constraint waba_clinic_branches_id_company_key unique (id, company_id);

alter table public.waba_clinic_doctors
  add constraint waba_clinic_doctors_id_company_key unique (id, company_id);

alter table public.waba_clinic_doctors
  add constraint waba_clinic_doctors_branch_company_fkey
  foreign key (branch_id, company_id)
  references public.waba_clinic_branches(id, company_id)
  on delete cascade;

alter table public.waba_clinic_schedules
  add constraint waba_clinic_schedules_doctor_company_fkey
  foreign key (doctor_id, company_id)
  references public.waba_clinic_doctors(id, company_id)
  on delete cascade;

alter table public.waba_clinic_appointments
  add constraint waba_clinic_appointments_branch_company_fkey
  foreign key (branch_id, company_id)
  references public.waba_clinic_branches(id, company_id)
  on delete cascade;

alter table public.waba_clinic_appointments
  add constraint waba_clinic_appointments_doctor_company_fkey
  foreign key (doctor_id, company_id)
  references public.waba_clinic_doctors(id, company_id)
  on delete cascade;

create unique index waba_clinic_schedules_exact_uidx
  on public.waba_clinic_schedules(company_id, doctor_id, weekday, start_time, end_time);
