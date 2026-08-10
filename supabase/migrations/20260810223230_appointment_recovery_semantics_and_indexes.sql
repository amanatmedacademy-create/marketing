alter table public.growth_recovery_actions
  drop constraint growth_recovery_actions_trigger_type_check;

alter table public.growth_recovery_actions
  add constraint growth_recovery_actions_trigger_type_check
  check (trigger_type = any(array[
    'stale_lead'::text,
    'lost_opportunity'::text,
    'appointment_no_show'::text,
    'appointment_cancelled'::text,
    'appointment_unconfirmed'::text
  ]));

create index if not exists waba_clinic_appointments_company_status_ends_idx
  on public.waba_clinic_appointments(company_id, status, ends_at);
create index if not exists waba_clinic_appointments_lead_fk_idx
  on public.waba_clinic_appointments(lead_id);
create index if not exists waba_clinic_appointments_conversation_fk_idx
  on public.waba_clinic_appointments(conversation_id);
create index if not exists waba_clinic_appointments_branch_fk_idx
  on public.waba_clinic_appointments(branch_id);
