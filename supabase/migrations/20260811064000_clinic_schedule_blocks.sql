create table if not exists public.waba_clinic_schedule_blocks (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  doctor_id uuid not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  block_type text not null default 'other',
  title text not null,
  note text,
  created_by text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint waba_clinic_schedule_blocks_time_check check (ends_at > starts_at),
  constraint waba_clinic_schedule_blocks_type_check check (block_type in ('training','lunch','meeting','maintenance','personal','other')),
  constraint waba_clinic_schedule_blocks_company_fkey foreign key (company_id) references public.crm_companies(id) on delete cascade,
  constraint waba_clinic_schedule_blocks_doctor_company_fkey foreign key (doctor_id, company_id) references public.waba_clinic_doctors(id, company_id) on delete cascade
);

create index if not exists waba_clinic_schedule_blocks_company_time_idx
  on public.waba_clinic_schedule_blocks(company_id, starts_at, ends_at);
create index if not exists waba_clinic_schedule_blocks_doctor_time_idx
  on public.waba_clinic_schedule_blocks(company_id, doctor_id, starts_at, ends_at);

alter table public.waba_clinic_schedule_blocks enable row level security;
revoke all on table public.waba_clinic_schedule_blocks from anon, authenticated;
grant select, insert, update, delete on table public.waba_clinic_schedule_blocks to service_role;
