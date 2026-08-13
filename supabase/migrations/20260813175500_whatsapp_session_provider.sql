create table if not exists public.whatsapp_session_connections (
  company_id uuid primary key references public.crm_companies(id) on delete cascade,
  provider text not null default 'baileys',
  status text not null default 'DISCONNECTED',
  phone_e164 text,
  linked_jid text,
  display_name text,
  last_connected_at timestamptz,
  last_avatar_sync_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint whatsapp_session_connections_provider_check check (provider = 'baileys'),
  constraint whatsapp_session_connections_status_check check (
    status in ('DISCONNECTED','CONNECTING','PAIRING','CONNECTED','ERROR','LOGGED_OUT')
  )
);

alter table public.whatsapp_session_connections enable row level security;
revoke all on table public.whatsapp_session_connections from anon, authenticated;
grant all on table public.whatsapp_session_connections to service_role;

comment on table public.whatsapp_session_connections is
  'Tenant-scoped status metadata for optional WhatsApp linked-device sessions. Signal/auth keys live only in the isolated session provider runtime.';

notify pgrst, 'reload schema';
