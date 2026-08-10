create table public.patient_journey_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.crm_companies(id) on delete cascade,
  lead_id uuid references public.marketing_leads(id) on delete cascade,
  event_type text not null check (event_type in ('lead_created','first_contact','qualified','call','conversation','message','appointment_booked','arrived','deal_created','rejected','sale')),
  occurred_at timestamptz not null,
  channel text,
  source text,
  campaign_id text,
  adset_id text,
  ad_id text,
  value numeric not null default 0 check (value >= 0),
  currency text not null default 'KZT',
  external_id text,
  dedupe_key text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, dedupe_key)
);

create index patient_journey_events_company_time_idx on public.patient_journey_events(company_id, occurred_at desc);
create index patient_journey_events_lead_time_idx on public.patient_journey_events(company_id, lead_id, occurred_at desc) where lead_id is not null;

create table public.conversion_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.crm_companies(id) on delete cascade,
  lead_id uuid references public.marketing_leads(id) on delete cascade,
  event_name text not null check (event_name in ('lead','qualified_lead','appointment_booked','arrived','purchase')),
  occurred_at timestamptz not null,
  destination text not null default 'unknown' check (destination in ('meta','google','tiktok','unknown')),
  value numeric not null default 0 check (value >= 0),
  currency text not null default 'KZT',
  campaign_id text,
  adset_id text,
  ad_id text,
  fbclid text,
  gclid text,
  ttclid text,
  sync_status text not null default 'pending' check (sync_status in ('pending','processing','sent','failed','skipped')),
  attempts integer not null default 0 check (attempts >= 0),
  last_error text,
  sent_at timestamptz,
  dedupe_key text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, dedupe_key)
);

create index conversion_events_company_status_idx on public.conversion_events(company_id, sync_status, occurred_at);
create index conversion_events_lead_idx on public.conversion_events(company_id, lead_id, occurred_at desc) where lead_id is not null;

create table public.lost_opportunities (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.crm_companies(id) on delete cascade,
  lead_id uuid references public.marketing_leads(id) on delete set null,
  call_id uuid references public.marketing_calls(id) on delete set null,
  status text not null default 'open' check (status in ('open','recovering','recovered','lost')),
  reason text not null,
  estimated_value numeric not null default 0 check (estimated_value >= 0),
  currency text not null default 'KZT',
  owner_user_id uuid,
  owner_name text,
  next_action text,
  next_action_at timestamptz,
  detected_at timestamptz not null default now(),
  recovered_at timestamptz,
  dedupe_key text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, dedupe_key)
);

create index lost_opportunities_company_status_idx on public.lost_opportunities(company_id, status, detected_at desc);
create index lost_opportunities_lead_idx on public.lost_opportunities(company_id, lead_id) where lead_id is not null;

alter table public.patient_journey_events enable row level security;
alter table public.conversion_events enable row level security;
alter table public.lost_opportunities enable row level security;
revoke all on public.patient_journey_events, public.conversion_events, public.lost_opportunities from anon, authenticated;
grant select, insert, update, delete on public.patient_journey_events, public.conversion_events, public.lost_opportunities to service_role;

create or replace function private.sync_growth_from_lead()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  dest text;
  estimated numeric := 0;
  sale_time timestamptz;
begin
  dest := case
    when nullif(new.gclid, '') is not null then 'google'
    when nullif(new.ttclid, '') is not null then 'tiktok'
    when nullif(new.fbclid, '') is not null then 'meta'
    when lower(coalesce(new.platform, new.source, '')) similar to '%(meta|facebook|instagram)%' then 'meta'
    when lower(coalesce(new.platform, new.source, '')) like '%google%' then 'google'
    when lower(coalesce(new.platform, new.source, '')) like '%tiktok%' then 'tiktok'
    else 'unknown'
  end;

  insert into public.patient_journey_events(company_id, lead_id, event_type, occurred_at, channel, source, campaign_id, adset_id, ad_id, dedupe_key, metadata)
  values(new.company_id, new.id, 'lead_created', coalesce(new.lead_created_at, new.created_at), new.platform, new.source, new.campaign_id, new.adset_id, new.ad_id, 'lead:' || new.id || ':created', jsonb_build_object('stage', new.stage))
  on conflict(company_id, dedupe_key) do update set occurred_at=excluded.occurred_at, channel=excluded.channel, source=excluded.source, campaign_id=excluded.campaign_id, adset_id=excluded.adset_id, ad_id=excluded.ad_id, metadata=excluded.metadata, updated_at=now();

  insert into public.conversion_events(company_id, lead_id, event_name, occurred_at, destination, campaign_id, adset_id, ad_id, fbclid, gclid, ttclid, sync_status, dedupe_key, payload)
  values(new.company_id, new.id, 'lead', coalesce(new.lead_created_at, new.created_at), dest, new.campaign_id, new.adset_id, new.ad_id, new.fbclid, new.gclid, new.ttclid, 'skipped', 'lead:' || new.id || ':lead', jsonb_build_object('source', new.source, 'platform', new.platform))
  on conflict(company_id, dedupe_key) do update set destination=excluded.destination, campaign_id=excluded.campaign_id, adset_id=excluded.adset_id, ad_id=excluded.ad_id, fbclid=excluded.fbclid, gclid=excluded.gclid, ttclid=excluded.ttclid, payload=excluded.payload, updated_at=now();

  if new.first_contact_at is not null then
    insert into public.patient_journey_events(company_id, lead_id, event_type, occurred_at, channel, source, dedupe_key)
    values(new.company_id, new.id, 'first_contact', new.first_contact_at, new.platform, new.source, 'lead:' || new.id || ':first_contact')
    on conflict(company_id, dedupe_key) do update set occurred_at=excluded.occurred_at, updated_at=now();
  end if;

  if new.qualified_at is not null then
    insert into public.patient_journey_events(company_id, lead_id, event_type, occurred_at, channel, source, dedupe_key)
    values(new.company_id, new.id, 'qualified', new.qualified_at, new.platform, new.source, 'lead:' || new.id || ':qualified')
    on conflict(company_id, dedupe_key) do update set occurred_at=excluded.occurred_at, updated_at=now();
    insert into public.conversion_events(company_id, lead_id, event_name, occurred_at, destination, campaign_id, adset_id, ad_id, fbclid, gclid, ttclid, sync_status, dedupe_key)
    values(new.company_id, new.id, 'qualified_lead', new.qualified_at, dest, new.campaign_id, new.adset_id, new.ad_id, new.fbclid, new.gclid, new.ttclid, case when dest='unknown' then 'skipped' else 'pending' end, 'lead:' || new.id || ':qualified')
    on conflict(company_id, dedupe_key) do update set occurred_at=excluded.occurred_at, destination=excluded.destination, sync_status=case when public.conversion_events.sync_status='sent' then 'sent' else excluded.sync_status end, updated_at=now();
  end if;

  if new.appointment_at is not null then
    insert into public.patient_journey_events(company_id, lead_id, event_type, occurred_at, channel, source, dedupe_key)
    values(new.company_id, new.id, 'appointment_booked', new.appointment_at, new.platform, new.source, 'lead:' || new.id || ':appointment')
    on conflict(company_id, dedupe_key) do update set occurred_at=excluded.occurred_at, updated_at=now();
    insert into public.conversion_events(company_id, lead_id, event_name, occurred_at, destination, campaign_id, adset_id, ad_id, fbclid, gclid, ttclid, sync_status, dedupe_key)
    values(new.company_id, new.id, 'appointment_booked', new.appointment_at, dest, new.campaign_id, new.adset_id, new.ad_id, new.fbclid, new.gclid, new.ttclid, case when dest='unknown' then 'skipped' else 'pending' end, 'lead:' || new.id || ':appointment')
    on conflict(company_id, dedupe_key) do update set occurred_at=excluded.occurred_at, destination=excluded.destination, sync_status=case when public.conversion_events.sync_status='sent' then 'sent' else excluded.sync_status end, updated_at=now();
  end if;

  if new.arrived_at is not null then
    insert into public.patient_journey_events(company_id, lead_id, event_type, occurred_at, channel, source, dedupe_key)
    values(new.company_id, new.id, 'arrived', new.arrived_at, new.platform, new.source, 'lead:' || new.id || ':arrived')
    on conflict(company_id, dedupe_key) do update set occurred_at=excluded.occurred_at, updated_at=now();
    insert into public.conversion_events(company_id, lead_id, event_name, occurred_at, destination, value, campaign_id, adset_id, ad_id, fbclid, gclid, ttclid, sync_status, dedupe_key)
    values(new.company_id, new.id, 'arrived', new.arrived_at, dest, 0, new.campaign_id, new.adset_id, new.ad_id, new.fbclid, new.gclid, new.ttclid, case when dest='unknown' then 'skipped' else 'pending' end, 'lead:' || new.id || ':arrived')
    on conflict(company_id, dedupe_key) do update set occurred_at=excluded.occurred_at, destination=excluded.destination, sync_status=case when public.conversion_events.sync_status='sent' then 'sent' else excluded.sync_status end, updated_at=now();
  end if;

  if new.deal_created_at is not null then
    insert into public.patient_journey_events(company_id, lead_id, event_type, occurred_at, channel, source, dedupe_key)
    values(new.company_id, new.id, 'deal_created', new.deal_created_at, new.platform, new.source, 'lead:' || new.id || ':deal')
    on conflict(company_id, dedupe_key) do update set occurred_at=excluded.occurred_at, updated_at=now();
  end if;

  if coalesce(new.rejected_at, new.deal_rejected_at) is not null and coalesce(new.sale_amount,0)=0 and new.sold_at is null then
    insert into public.patient_journey_events(company_id, lead_id, event_type, occurred_at, channel, source, dedupe_key, metadata)
    values(new.company_id, new.id, 'rejected', coalesce(new.deal_rejected_at, new.rejected_at), new.platform, new.source, 'lead:' || new.id || ':rejected', jsonb_build_object('stage',new.stage,'next_action',new.next_action))
    on conflict(company_id, dedupe_key) do update set occurred_at=excluded.occurred_at, metadata=excluded.metadata, updated_at=now();

    select coalesce(avg(l.sale_amount),0) into estimated from public.marketing_leads l where l.company_id=new.company_id and l.sale_amount>0 and (new.direction is null or l.direction=new.direction);
    insert into public.lost_opportunities(company_id, lead_id, status, reason, estimated_value, owner_name, next_action, detected_at, dedupe_key, metadata)
    values(new.company_id, new.id, 'open', coalesce(nullif(new.stage,''),'rejected'), estimated, new.manager, new.next_action, coalesce(new.deal_rejected_at,new.rejected_at), 'lead:' || new.id || ':rejected', jsonb_build_object('source',new.source,'direction',new.direction))
    on conflict(company_id, dedupe_key) do update set reason=excluded.reason, estimated_value=excluded.estimated_value, owner_name=excluded.owner_name, next_action=excluded.next_action, updated_at=now();
  end if;

  sale_time := coalesce(new.sold_at, case when coalesce(new.sale_amount,0)>0 then new.updated_at end);
  if sale_time is not null then
    insert into public.patient_journey_events(company_id, lead_id, event_type, occurred_at, channel, source, value, dedupe_key)
    values(new.company_id, new.id, 'sale', sale_time, new.platform, new.source, greatest(coalesce(new.sale_amount,0),0), 'lead:' || new.id || ':sale')
    on conflict(company_id, dedupe_key) do update set occurred_at=excluded.occurred_at, value=excluded.value, updated_at=now();
    insert into public.conversion_events(company_id, lead_id, event_name, occurred_at, destination, value, campaign_id, adset_id, ad_id, fbclid, gclid, ttclid, sync_status, dedupe_key)
    values(new.company_id, new.id, 'purchase', sale_time, dest, greatest(coalesce(new.sale_amount,0),0), new.campaign_id, new.adset_id, new.ad_id, new.fbclid, new.gclid, new.ttclid, case when dest='unknown' then 'skipped' else 'pending' end, 'lead:' || new.id || ':purchase')
    on conflict(company_id, dedupe_key) do update set occurred_at=excluded.occurred_at, destination=excluded.destination, value=excluded.value, sync_status=case when public.conversion_events.sync_status='sent' then 'sent' else excluded.sync_status end, updated_at=now();
    update public.lost_opportunities set status='recovered', recovered_at=coalesce(recovered_at,sale_time), updated_at=now() where company_id=new.company_id and lead_id=new.id and status in ('open','recovering','lost');
  end if;
  return new;
end;
$$;

create or replace function private.sync_growth_from_call()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  estimated numeric := 0;
  lead_row public.marketing_leads%rowtype;
  dest text := 'unknown';
begin
  insert into public.patient_journey_events(company_id, lead_id, event_type, occurred_at, channel, source, campaign_id, ad_id, external_id, dedupe_key, metadata)
  values(new.company_id, new.lead_id, 'call', new.started_at, coalesce(new.channel,'call'), new.source, new.campaign_id, new.ad_id, new.external_id, 'call:' || new.id, jsonb_build_object('operator',new.operator_name,'result',new.call_result,'quality_score',new.quality_score,'appointment_created',new.appointment_created))
  on conflict(company_id, dedupe_key) do update set occurred_at=excluded.occurred_at, metadata=excluded.metadata, updated_at=now();

  if new.lead_id is not null then
    select * into lead_row from public.marketing_leads where id=new.lead_id and company_id=new.company_id;
  end if;

  if new.appointment_created and coalesce(new.appointment_at,new.started_at) is not null then
    if new.lead_id is not null then
      insert into public.patient_journey_events(company_id, lead_id, event_type, occurred_at, channel, source, dedupe_key, metadata)
      values(new.company_id,new.lead_id,'appointment_booked',coalesce(new.appointment_at,new.started_at),coalesce(new.channel,'call'),new.source,'lead:' || new.lead_id || ':appointment',jsonb_build_object('call_id',new.id))
      on conflict(company_id,dedupe_key) do update set occurred_at=excluded.occurred_at, metadata=public.patient_journey_events.metadata || excluded.metadata, updated_at=now();
      if found and lead_row.id is not null then
        dest := case when nullif(lead_row.gclid,'') is not null then 'google' when nullif(lead_row.ttclid,'') is not null then 'tiktok' when nullif(lead_row.fbclid,'') is not null then 'meta' when lower(coalesce(lead_row.platform,lead_row.source,'')) similar to '%(meta|facebook|instagram)%' then 'meta' when lower(coalesce(lead_row.platform,lead_row.source,'')) like '%google%' then 'google' when lower(coalesce(lead_row.platform,lead_row.source,'')) like '%tiktok%' then 'tiktok' else 'unknown' end;
        insert into public.conversion_events(company_id,lead_id,event_name,occurred_at,destination,campaign_id,adset_id,ad_id,fbclid,gclid,ttclid,sync_status,dedupe_key,payload)
        values(new.company_id,new.lead_id,'appointment_booked',coalesce(new.appointment_at,new.started_at),dest,lead_row.campaign_id,lead_row.adset_id,lead_row.ad_id,lead_row.fbclid,lead_row.gclid,lead_row.ttclid,case when dest='unknown' then 'skipped' else 'pending' end,'lead:' || new.lead_id || ':appointment',jsonb_build_object('call_id',new.id))
        on conflict(company_id,dedupe_key) do update set occurred_at=excluded.occurred_at,payload=public.conversion_events.payload || excluded.payload,sync_status=case when public.conversion_events.sync_status='sent' then 'sent' else excluded.sync_status end,updated_at=now();
      end if;
    end if;
    update public.lost_opportunities set status='recovered', recovered_at=coalesce(recovered_at,coalesce(new.appointment_at,new.started_at)), updated_at=now() where company_id=new.company_id and call_id=new.id and status in ('open','recovering','lost');
  elsif nullif(trim(coalesce(new.loss_reason,'')),'') is not null then
    if lead_row.id is not null then
      select coalesce(avg(l.sale_amount),0) into estimated from public.marketing_leads l where l.company_id=new.company_id and l.sale_amount>0 and (lead_row.direction is null or l.direction=lead_row.direction);
    end if;
    insert into public.lost_opportunities(company_id,lead_id,call_id,status,reason,estimated_value,owner_user_id,owner_name,next_action,next_action_at,detected_at,dedupe_key,metadata)
    values(new.company_id,new.lead_id,new.id,'open',new.loss_reason,estimated,new.operator_user_id,new.operator_name,new.next_action,new.scheduled_at,new.started_at,'call:' || new.id || ':not_booked',jsonb_build_object('call_result',new.call_result,'quality_score',new.quality_score))
    on conflict(company_id,dedupe_key) do update set reason=excluded.reason,estimated_value=excluded.estimated_value,owner_user_id=excluded.owner_user_id,owner_name=excluded.owner_name,next_action=excluded.next_action,next_action_at=excluded.next_action_at,metadata=excluded.metadata,updated_at=now();
  end if;
  return new;
end;
$$;

revoke all on function private.sync_growth_from_lead() from public, anon, authenticated;
revoke all on function private.sync_growth_from_call() from public, anon, authenticated;

drop trigger if exists marketing_leads_growth_engine on public.marketing_leads;
create trigger marketing_leads_growth_engine after insert or update on public.marketing_leads for each row execute function private.sync_growth_from_lead();
drop trigger if exists marketing_calls_growth_engine on public.marketing_calls;
create trigger marketing_calls_growth_engine after insert or update on public.marketing_calls for each row execute function private.sync_growth_from_call();

insert into public.patient_journey_events(company_id,lead_id,event_type,occurred_at,channel,source,campaign_id,adset_id,ad_id,dedupe_key,metadata)
select company_id,id,'lead_created',coalesce(lead_created_at,created_at),platform,source,campaign_id,adset_id,ad_id,'lead:'||id||':created',jsonb_build_object('stage',stage) from public.marketing_leads
on conflict(company_id,dedupe_key) do nothing;
insert into public.patient_journey_events(company_id,lead_id,event_type,occurred_at,channel,source,dedupe_key)
select company_id,id,'first_contact',first_contact_at,platform,source,'lead:'||id||':first_contact' from public.marketing_leads where first_contact_at is not null
on conflict(company_id,dedupe_key) do nothing;
insert into public.patient_journey_events(company_id,lead_id,event_type,occurred_at,channel,source,dedupe_key)
select company_id,id,'qualified',qualified_at,platform,source,'lead:'||id||':qualified' from public.marketing_leads where qualified_at is not null
on conflict(company_id,dedupe_key) do nothing;
insert into public.patient_journey_events(company_id,lead_id,event_type,occurred_at,channel,source,dedupe_key)
select company_id,id,'appointment_booked',appointment_at,platform,source,'lead:'||id||':appointment' from public.marketing_leads where appointment_at is not null
on conflict(company_id,dedupe_key) do nothing;
insert into public.patient_journey_events(company_id,lead_id,event_type,occurred_at,channel,source,dedupe_key)
select company_id,id,'arrived',arrived_at,platform,source,'lead:'||id||':arrived' from public.marketing_leads where arrived_at is not null
on conflict(company_id,dedupe_key) do nothing;
insert into public.patient_journey_events(company_id,lead_id,event_type,occurred_at,channel,source,value,dedupe_key)
select company_id,id,'sale',coalesce(sold_at,updated_at),platform,source,greatest(coalesce(sale_amount,0),0),'lead:'||id||':sale' from public.marketing_leads where sold_at is not null or sale_amount>0
on conflict(company_id,dedupe_key) do nothing;
insert into public.patient_journey_events(company_id,lead_id,event_type,occurred_at,channel,source,campaign_id,ad_id,external_id,dedupe_key,metadata)
select company_id,lead_id,'call',started_at,coalesce(channel,'call'),source,campaign_id,ad_id,external_id,'call:'||id,jsonb_build_object('operator',operator_name,'result',call_result,'quality_score',quality_score,'appointment_created',appointment_created) from public.marketing_calls
on conflict(company_id,dedupe_key) do nothing;

update public.marketing_leads set updated_at=updated_at;
update public.marketing_calls set updated_at=updated_at;
