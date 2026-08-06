-- Deleting an assigned position must be explicit. The composite company key cannot be nulled.
alter table public.crm_access_user_assignments
  drop constraint if exists crm_access_user_assignments_position_id_company_id_fkey;

alter table public.crm_access_user_assignments
  add constraint crm_access_user_assignments_position_id_company_id_fkey
  foreign key (position_id, company_id)
  references public.crm_access_positions(id, company_id)
  on delete restrict;
