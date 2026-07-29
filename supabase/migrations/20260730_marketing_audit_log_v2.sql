alter table if exists marketing_activity_log
  add column if not exists actor_id text,
  add column if not exists actor_email text,
  add column if not exists actor_name text,
  add column if not exists module text,
  add column if not exists action text,
  add column if not exists status text not null default 'success',
  add column if not exists request_id text,
  add column if not exists ip_address text,
  add column if not exists user_agent text,
  add column if not exists old_values jsonb,
  add column if not exists new_values jsonb;

alter table if exists marketing_activity_log
  drop constraint if exists marketing_activity_log_status_check;

alter table if exists marketing_activity_log
  add constraint marketing_activity_log_status_check
  check (status in ('success','error','warning'));

create index if not exists marketing_activity_event_idx
  on marketing_activity_log(event_type, created_at desc);
create index if not exists marketing_activity_module_idx
  on marketing_activity_log(module, created_at desc);
create index if not exists marketing_activity_actor_idx
  on marketing_activity_log(actor_email, created_at desc);
create index if not exists marketing_activity_status_idx
  on marketing_activity_log(status, created_at desc);
create index if not exists marketing_activity_entity_idx
  on marketing_activity_log(entity_type, entity_id, created_at desc);
