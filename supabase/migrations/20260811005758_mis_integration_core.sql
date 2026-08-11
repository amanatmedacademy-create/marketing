alter table public.integration_credentials drop constraint integration_credentials_provider_check;
alter table public.integration_credentials add constraint integration_credentials_provider_check
  check (provider = any (array['bitrix'::text,'meta'::text,'tiktok'::text,'n8n'::text,'waba'::text,'zadarma'::text,'mis'::text]));

create table public.clinic_patients (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.crm_companies(id) on delete cascade,
  external_id text,
  name text not null,
  phone text not null default '',
  email text,
  source_system text not null default 'imds',
  last_visit_at timestamptz,
  next_visit_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint clinic_patients_id_company_key unique (id, company_id)
);
create unique index clinic_patients_company_external_uidx
  on public.clinic_patients(company_id, external_id)
  where external_id is not null and btrim(external_id) <> '';
create index clinic_patients_company_phone_idx
  on public.clinic_patients(company_id, (regexp_replace(phone, '[^0-9]'::text, ''::text, 'g'::text)))
  where btrim(phone) <> '';

alter table public.marketing_leads add column clinic_patient_id uuid;
alter table public.marketing_leads
  add constraint marketing_leads_clinic_patient_company_fkey
  foreign key (clinic_patient_id, company_id)
  references public.clinic_patients(id, company_id) on delete restrict;
create index marketing_leads_clinic_patient_company_idx
  on public.marketing_leads(clinic_patient_id, company_id)
  where clinic_patient_id is not null;

alter table public.waba_clinic_appointments
  add constraint waba_clinic_appointments_id_company_key unique (id, company_id);
alter table public.waba_clinic_appointments add column patient_id uuid;
alter table public.waba_clinic_appointments
  add constraint waba_clinic_appointments_patient_company_fkey
  foreign key (patient_id, company_id)
  references public.clinic_patients(id, company_id) on delete restrict;
create index waba_clinic_appointments_patient_company_idx
  on public.waba_clinic_appointments(patient_id, company_id)
  where patient_id is not null;

create table public.mis_settings (
  company_id uuid primary key references public.crm_companies(id) on delete cascade,
  vendor text not null default 'generic_rest' check (vendor in ('generic_rest','custom')),
  source_of_truth text not null default 'mis' check (source_of_truth in ('mis','hybrid','imds')),
  enabled boolean not null default false,
  pull_enabled boolean not null default true,
  push_appointments boolean not null default false,
  inbound_enabled boolean not null default false,
  sync_branches boolean not null default true,
  sync_doctors boolean not null default true,
  sync_schedules boolean not null default true,
  sync_patients boolean not null default true,
  sync_appointments boolean not null default true,
  last_sync_at timestamptz,
  last_success_at timestamptz,
  last_error text,
  last_cursor text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.mis_entity_mappings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.crm_companies(id) on delete cascade,
  entity_type text not null check (entity_type in ('branch','doctor','schedule','patient','appointment')),
  external_id text not null,
  local_id uuid not null,
  source_hash text,
  last_synced_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint mis_entity_mappings_company_external_key unique (company_id, entity_type, external_id),
  constraint mis_entity_mappings_company_local_key unique (company_id, entity_type, local_id)
);
create index mis_entity_mappings_company_type_idx
  on public.mis_entity_mappings(company_id, entity_type, last_synced_at desc);

create table public.mis_sync_runs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.crm_companies(id) on delete cascade,
  vendor text not null,
  mode text not null check (mode in ('pull','push','inbound')),
  status text not null default 'running' check (status in ('running','success','partial','failed','skipped')),
  counts jsonb not null default '{}'::jsonb,
  error text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  created_at timestamptz not null default now()
);
create index mis_sync_runs_company_started_idx
  on public.mis_sync_runs(company_id, started_at desc);

create table public.mis_outbox (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  appointment_id uuid not null,
  action text not null default 'upsert' check (action in ('upsert','cancel')),
  status text not null default 'pending' check (status in ('pending','processing','sent','failed','skipped')),
  attempts integer not null default 0 check (attempts >= 0),
  available_at timestamptz not null default now(),
  last_error text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint mis_outbox_appointment_company_fkey
    foreign key (appointment_id, company_id)
    references public.waba_clinic_appointments(id, company_id) on delete cascade
);
create index mis_outbox_company_status_idx
  on public.mis_outbox(company_id, status, available_at, created_at);

alter table public.clinic_patients enable row level security;
alter table public.mis_settings enable row level security;
alter table public.mis_entity_mappings enable row level security;
alter table public.mis_sync_runs enable row level security;
alter table public.mis_outbox enable row level security;

revoke all on table public.clinic_patients, public.mis_settings, public.mis_entity_mappings, public.mis_sync_runs, public.mis_outbox from anon, authenticated;
grant select, insert, update, delete on table public.clinic_patients, public.mis_settings, public.mis_entity_mappings, public.mis_sync_runs, public.mis_outbox to service_role;
