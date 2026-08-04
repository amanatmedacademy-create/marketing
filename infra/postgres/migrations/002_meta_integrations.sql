create table if not exists analytics.meta_connections (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references analytics.agencies(id) on delete cascade,
  client_id uuid,
  product text not null check (product in ('waba','ads')),
  status text not null default 'connected',
  meta_user_id text,
  meta_user_name text,
  business_id text,
  waba_id text,
  phone_number_id text,
  ad_accounts jsonb not null default '[]'::jsonb,
  token_ciphertext bytea not null,
  token_iv bytea not null,
  token_tag bytea not null,
  token_type text not null default 'bearer',
  expires_at timestamptz,
  connected_by_subject text,
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (client_id, agency_id) references analytics.clients(id, agency_id) on delete cascade
);

create unique index if not exists meta_connections_agency_product_uq
  on analytics.meta_connections(agency_id, product) where client_id is null;
create unique index if not exists meta_connections_client_product_uq
  on analytics.meta_connections(agency_id, client_id, product) where client_id is not null;
create index if not exists meta_connections_status_idx
  on analytics.meta_connections(agency_id, status, product);

alter table analytics.meta_connections enable row level security;
drop policy if exists meta_connections_tenant_isolation on analytics.meta_connections;
create policy meta_connections_tenant_isolation on analytics.meta_connections
using (agency_id = nullif(current_setting('app.agency_id', true), '')::uuid)
with check (agency_id = nullif(current_setting('app.agency_id', true), '')::uuid);
