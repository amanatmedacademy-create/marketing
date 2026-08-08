create table if not exists public.waba_clinic_branches (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.crm_companies(id) on delete cascade,
  name text not null,
  address text,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists waba_clinic_branches_company_idx
  on public.waba_clinic_branches(company_id, active, sort_order, name);

create table if not exists public.waba_clinic_doctors (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.crm_companies(id) on delete cascade,
  branch_id uuid not null references public.waba_clinic_branches(id) on delete cascade,
  name text not null,
  specialty text,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists waba_clinic_doctors_branch_idx
  on public.waba_clinic_doctors(company_id, branch_id, active, sort_order, name);

create table if not exists public.waba_clinic_schedules (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.crm_companies(id) on delete cascade,
  doctor_id uuid not null references public.waba_clinic_doctors(id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6),
  start_time time not null,
  end_time time not null,
  slot_minutes integer not null default 30 check (slot_minutes between 5 and 240),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (start_time < end_time)
);

create unique index if not exists waba_clinic_schedules_unique_window
  on public.waba_clinic_schedules(doctor_id, weekday, start_time, end_time)
  where active = true;

create index if not exists waba_clinic_schedules_doctor_idx
  on public.waba_clinic_schedules(company_id, doctor_id, weekday, active);

create table if not exists public.waba_clinic_appointments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.crm_companies(id) on delete cascade,
  lead_id uuid references public.marketing_leads(id) on delete set null,
  conversation_id uuid references public.marketing_conversations(id) on delete set null,
  branch_id uuid not null references public.waba_clinic_branches(id) on delete restrict,
  doctor_id uuid not null references public.waba_clinic_doctors(id) on delete restrict,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  patient_name text not null,
  phone text not null,
  status text not null default 'BOOKED' check (status in ('BOOKED','CONFIRMED','COMPLETED','CANCELLED','NO_SHOW')),
  source text not null default 'WhatsApp Flow',
  flow_token text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (starts_at < ends_at)
);

create unique index if not exists waba_clinic_appointments_doctor_slot_uidx
  on public.waba_clinic_appointments(doctor_id, starts_at)
  where status in ('BOOKED','CONFIRMED');

create unique index if not exists waba_clinic_appointments_flow_token_uidx
  on public.waba_clinic_appointments(company_id, flow_token)
  where flow_token is not null;

create index if not exists waba_clinic_appointments_company_time_idx
  on public.waba_clinic_appointments(company_id, starts_at desc);

alter table public.waba_clinic_branches enable row level security;
alter table public.waba_clinic_doctors enable row level security;
alter table public.waba_clinic_schedules enable row level security;
alter table public.waba_clinic_appointments enable row level security;
