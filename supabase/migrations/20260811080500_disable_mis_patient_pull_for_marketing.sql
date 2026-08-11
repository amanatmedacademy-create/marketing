alter table public.mis_settings
  alter column sync_patients set default false;

update public.mis_settings
set sync_patients = false,
    updated_at = now()
where sync_patients is distinct from false;
