alter table public.crm_contacts
  add constraint crm_contacts_company_id_id_key unique (company_id, id);

create table if not exists public.crm_contact_avatars (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  contact_id uuid not null,
  source text not null,
  storage_path text,
  external_url text,
  priority smallint not null default 0,
  is_active boolean not null default true,
  fetched_at timestamptz,
  expires_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (company_id, contact_id) references public.crm_contacts(company_id, id) on delete cascade,
  check (source in ('whatsapp_session','crm_manual','mis','instagram','telegram','import')),
  check (num_nonnulls(storage_path, external_url) = 1),
  check (priority between 0 and 1000),
  unique (company_id, contact_id, source)
);

create index if not exists crm_contact_avatars_resolver_idx
  on public.crm_contact_avatars(company_id, contact_id, priority desc, updated_at desc)
  where is_active = true;

alter table public.crm_contact_avatars enable row level security;
revoke all on table public.crm_contact_avatars from anon, authenticated;
grant all on table public.crm_contact_avatars to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('contact-avatars', 'contact-avatars', false, 5242880, array['image/jpeg','image/png','image/webp']::text[])
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

comment on table public.crm_contact_avatars is
  'Tenant-scoped contact avatar sources resolved by priority. Provider integrations cache remote avatars into private Storage.';

notify pgrst, 'reload schema';
