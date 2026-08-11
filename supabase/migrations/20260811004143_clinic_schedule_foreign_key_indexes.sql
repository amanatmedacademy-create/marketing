create index waba_clinic_doctors_branch_company_idx
  on public.waba_clinic_doctors(branch_id, company_id);

create index waba_clinic_schedules_doctor_company_idx
  on public.waba_clinic_schedules(doctor_id, company_id);

create index waba_clinic_appointments_branch_company_idx
  on public.waba_clinic_appointments(branch_id, company_id);

create index waba_clinic_appointments_doctor_company_idx
  on public.waba_clinic_appointments(doctor_id, company_id);
