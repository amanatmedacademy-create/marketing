alter table public.marketing_leads
  add column if not exists first_response_at timestamptz,
  add column if not exists first_response_seconds integer,
  add column if not exists first_response_channel text,
  add column if not exists first_response_event_id text;

alter table public.marketing_leads drop constraint if exists marketing_leads_first_response_seconds_check;
alter table public.marketing_leads add constraint marketing_leads_first_response_seconds_check
  check (first_response_seconds is null or first_response_seconds >= 0);

alter table public.marketing_calls
  add column if not exists ai_analysis_status text not null default 'idle',
  add column if not exists ai_analysis_model text,
  add column if not exists ai_analyzed_at timestamptz,
  add column if not exists ai_analysis_error text,
  add column if not exists ai_confidence numeric(5,2);

alter table public.marketing_calls drop constraint if exists marketing_calls_ai_analysis_status_check;
alter table public.marketing_calls add constraint marketing_calls_ai_analysis_status_check
  check (ai_analysis_status in ('idle','processing','completed','failed'));
alter table public.marketing_calls drop constraint if exists marketing_calls_ai_confidence_check;
alter table public.marketing_calls add constraint marketing_calls_ai_confidence_check
  check (ai_confidence is null or (ai_confidence >= 0 and ai_confidence <= 100));

create table if not exists public.growth_response_settings (
  company_id uuid primary key references public.crm_companies(id) on delete cascade,
  sla_seconds integer not null default 300 check (sla_seconds between 30 and 86400),
  stale_after_hours integer not null default 24 check (stale_after_hours between 1 and 720),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.growth_response_settings enable row level security;
revoke all on public.growth_response_settings from anon, authenticated;
grant select, insert, update, delete on public.growth_response_settings to service_role;
insert into public.growth_response_settings(company_id)
select id from public.crm_companies
on conflict(company_id) do nothing;

create index if not exists marketing_leads_company_first_response_idx
  on public.marketing_leads(company_id, first_response_at, lead_created_at);
create index if not exists marketing_calls_company_ai_status_idx
  on public.marketing_calls(company_id, ai_analysis_status, started_at desc);

alter table public.patient_journey_events drop constraint if exists patient_journey_events_event_type_check;
alter table public.patient_journey_events add constraint patient_journey_events_event_type_check
  check (event_type in ('lead_created','first_contact','first_response','qualified','call','conversation','message','appointment_booked','arrived','deal_created','rejected','sale'));

create or replace function private.capture_message_first_response()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_lead_id uuid;
  v_lead_created_at timestamptz;
  v_response_at timestamptz;
  v_seconds integer;
  v_channel text;
begin
  if upper(coalesce(new.direction, '')) <> 'OUTBOUND' then return new; end if;
  select c.lead_id, coalesce(c.channel, 'message') into v_lead_id, v_channel
  from public.marketing_conversations c
  where c.id = new.conversation_id and c.company_id = new.company_id;
  if v_lead_id is null then return new; end if;
  select l.lead_created_at into v_lead_created_at
  from public.marketing_leads l
  where l.id = v_lead_id and l.company_id = new.company_id;
  if v_lead_created_at is null then return new; end if;
  v_response_at := coalesce(new.sent_at, new.created_at, now());
  v_seconds := greatest(0, floor(extract(epoch from (v_response_at - v_lead_created_at)))::integer);
  update public.marketing_leads
  set first_response_at = v_response_at,
      first_response_seconds = v_seconds,
      first_response_channel = v_channel,
      first_response_event_id = 'message:' || new.id,
      updated_at = now()
  where id = v_lead_id and company_id = new.company_id
    and (first_response_at is null or v_response_at < first_response_at);
  if found then
    insert into public.patient_journey_events(company_id, lead_id, event_type, occurred_at, channel, source, dedupe_key, metadata)
    select l.company_id, l.id, 'first_response', l.first_response_at, l.first_response_channel, l.source,
           'lead:' || l.id || ':first_response', jsonb_build_object('response_seconds', l.first_response_seconds, 'event_id', l.first_response_event_id)
    from public.marketing_leads l where l.id = v_lead_id and l.company_id = new.company_id
    on conflict(company_id, dedupe_key) do update
      set occurred_at=excluded.occurred_at, channel=excluded.channel, source=excluded.source, metadata=excluded.metadata, updated_at=now();
  end if;
  return new;
end;
$$;

create or replace function private.capture_call_first_response()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_lead_created_at timestamptz;
  v_seconds integer;
  v_response_at timestamptz;
  v_channel text;
begin
  if new.lead_id is null or upper(coalesce(new.call_status, '')) <> 'COMPLETED' then return new; end if;
  select l.lead_created_at into v_lead_created_at
  from public.marketing_leads l where l.id = new.lead_id and l.company_id = new.company_id;
  if v_lead_created_at is null then return new; end if;
  v_response_at := new.started_at;
  v_channel := coalesce(nullif(new.channel,''), 'call');
  v_seconds := greatest(0, floor(extract(epoch from (v_response_at - v_lead_created_at)))::integer);
  update public.marketing_leads
  set first_response_at = v_response_at,
      first_response_seconds = v_seconds,
      first_response_channel = v_channel,
      first_response_event_id = 'call:' || new.id,
      updated_at = now()
  where id = new.lead_id and company_id = new.company_id
    and (first_response_at is null or v_response_at < first_response_at);
  if found then
    insert into public.patient_journey_events(company_id, lead_id, event_type, occurred_at, channel, source, dedupe_key, metadata)
    select l.company_id, l.id, 'first_response', l.first_response_at, l.first_response_channel, l.source,
           'lead:' || l.id || ':first_response', jsonb_build_object('response_seconds', l.first_response_seconds, 'event_id', l.first_response_event_id)
    from public.marketing_leads l where l.id = new.lead_id and l.company_id = new.company_id
    on conflict(company_id, dedupe_key) do update
      set occurred_at=excluded.occurred_at, channel=excluded.channel, source=excluded.source, metadata=excluded.metadata, updated_at=now();
  end if;
  return new;
end;
$$;

revoke all on function private.capture_message_first_response() from public, anon, authenticated;
revoke all on function private.capture_call_first_response() from public, anon, authenticated;

drop trigger if exists marketing_messages_first_response on public.marketing_messages;
create trigger marketing_messages_first_response
after insert or update of direction, sent_at, conversation_id on public.marketing_messages
for each row execute function private.capture_message_first_response();

drop trigger if exists marketing_calls_first_response on public.marketing_calls;
create trigger marketing_calls_first_response
after insert or update of call_status, started_at, lead_id on public.marketing_calls
for each row execute function private.capture_call_first_response();

with candidates as (
  select m.company_id, c.lead_id, m.sent_at as response_at, coalesce(c.channel,'message') as channel, 'message:' || m.id as event_id
  from public.marketing_messages m
  join public.marketing_conversations c on c.id=m.conversation_id and c.company_id=m.company_id
  where upper(m.direction)='OUTBOUND' and c.lead_id is not null
  union all
  select company_id, lead_id, started_at, coalesce(nullif(channel,''),'call'), 'call:' || id
  from public.marketing_calls
  where lead_id is not null and upper(call_status)='COMPLETED'
), firsts as (
  select distinct on (company_id, lead_id) company_id, lead_id, response_at, channel, event_id
  from candidates
  order by company_id, lead_id, response_at asc
)
update public.marketing_leads l
set first_response_at=f.response_at,
    first_response_seconds=greatest(0, floor(extract(epoch from (f.response_at-l.lead_created_at)))::integer),
    first_response_channel=f.channel,
    first_response_event_id=f.event_id,
    updated_at=now()
from firsts f
where l.company_id=f.company_id and l.id=f.lead_id
  and (l.first_response_at is null or f.response_at < l.first_response_at);

insert into public.patient_journey_events(company_id, lead_id, event_type, occurred_at, channel, source, dedupe_key, metadata)
select company_id, id, 'first_response', first_response_at, first_response_channel, source,
       'lead:' || id || ':first_response', jsonb_build_object('response_seconds', first_response_seconds, 'event_id', first_response_event_id)
from public.marketing_leads where first_response_at is not null
on conflict(company_id, dedupe_key) do update
  set occurred_at=excluded.occurred_at, channel=excluded.channel, source=excluded.source, metadata=excluded.metadata, updated_at=now();
