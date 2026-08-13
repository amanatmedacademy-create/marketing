-- Empty custom field values are represented as JSON null / SQL NULL by the Worker.
-- Allow clearing a field without violating the table constraint.
alter table public.crm_custom_field_values
  alter column value drop not null;
