-- Canonical Customer 360 identity graph.
-- crm_contacts becomes the stable customer/person entity. Existing module rows keep
-- their own snapshots, but point to one contact id for joins and navigation.

create unique index if not exists crm_contacts_id_company_uidx
  on public.crm_contacts (id, company_id);

create or replace function public.crm_normalize_email(raw_email text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select nullif(lower(btrim(raw_email)), '')
$$;

create or replace function public.normalize_crm_contacts_email()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.email := public.crm_normalize_email(new.email);
  return new;
end;
$$;

drop trigger if exists crm_contacts_normalize_email on public.crm_contacts;
create trigger crm_contacts_normalize_email
before insert or update of email on public.crm_contacts
for each row execute function public.normalize_crm_contacts_email();

-- Normalize historical contact data before enforcing exact active-contact uniqueness.
update public.crm_contacts
set phone = public.normalize_phone_e164(phone),
    email = public.crm_normalize_email(email),
    updated_at = now()
where deleted_at is null
  and (
    phone is distinct from public.normalize_phone_e164(phone)
    or email is distinct from public.crm_normalize_email(email)
  );

create unique index if not exists crm_contacts_company_active_phone_uidx
  on public.crm_contacts (company_id, phone)
  where deleted_at is null and phone is not null and phone <> '';

create unique index if not exists crm_contacts_company_active_email_uidx
  on public.crm_contacts (company_id, (lower(btrim(email))))
  where deleted_at is null and email is not null and btrim(email) <> '';

alter table public.marketing_calls
  add column if not exists contact_id uuid;
alter table public.waba_clinic_appointments
  add column if not exists contact_id uuid;
alter table public.patient_journey_events
  add column if not exists contact_id uuid;
alter table public.clinic_patients
  add column if not exists crm_contact_id uuid;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'marketing_calls_contact_company_fkey') then
    alter table public.marketing_calls
      add constraint marketing_calls_contact_company_fkey
      foreign key (contact_id, company_id)
      references public.crm_contacts(id, company_id)
      on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'waba_clinic_appointments_contact_company_fkey') then
    alter table public.waba_clinic_appointments
      add constraint waba_clinic_appointments_contact_company_fkey
      foreign key (contact_id, company_id)
      references public.crm_contacts(id, company_id)
      on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'patient_journey_events_contact_company_fkey') then
    alter table public.patient_journey_events
      add constraint patient_journey_events_contact_company_fkey
      foreign key (contact_id, company_id)
      references public.crm_contacts(id, company_id)
      on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'clinic_patients_crm_contact_company_fkey') then
    alter table public.clinic_patients
      add constraint clinic_patients_crm_contact_company_fkey
      foreign key (crm_contact_id, company_id)
      references public.crm_contacts(id, company_id)
      on delete set null;
  end if;
end $$;

create index if not exists marketing_calls_contact_idx
  on public.marketing_calls (company_id, contact_id, started_at desc)
  where contact_id is not null;
create index if not exists waba_clinic_appointments_contact_idx
  on public.waba_clinic_appointments (company_id, contact_id, starts_at desc)
  where contact_id is not null;
create index if not exists patient_journey_events_contact_idx
  on public.patient_journey_events (company_id, contact_id, occurred_at desc)
  where contact_id is not null;
create index if not exists clinic_patients_crm_contact_idx
  on public.clinic_patients (company_id, crm_contact_id)
  where crm_contact_id is not null;

create or replace function public.crm_resolve_contact(
  p_company_id uuid,
  p_name text default null,
  p_phone text default null,
  p_email text default null,
  p_source text default null,
  p_created_by uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_contact_id uuid;
  v_phone text := nullif(public.normalize_phone_e164(p_phone), '');
  v_email text := public.crm_normalize_email(p_email);
  v_name text := nullif(btrim(p_name), '');
  v_first_name text;
  v_last_name text;
begin
  if p_company_id is null then
    raise exception 'company_id is required';
  end if;

  if v_name is not null then
    v_first_name := nullif(split_part(v_name, ' ', 1), '');
    v_last_name := nullif(btrim(substr(v_name, length(coalesce(v_first_name, '')) + 1)), '');
  end if;

  -- Phone is the strongest deterministic identity key for clinic workflows.
  if v_phone is not null then
    select id into v_contact_id
    from public.crm_contacts
    where company_id = p_company_id
      and deleted_at is null
      and phone = v_phone
    order by created_at asc
    limit 1;
  end if;

  if v_contact_id is null and v_email is not null then
    select id into v_contact_id
    from public.crm_contacts
    where company_id = p_company_id
      and deleted_at is null
      and lower(btrim(email)) = v_email
    order by created_at asc
    limit 1;
  end if;

  if v_contact_id is not null then
    update public.crm_contacts c
    set first_name = coalesce(nullif(btrim(c.first_name), ''), v_first_name),
        last_name = coalesce(nullif(btrim(c.last_name), ''), v_last_name),
        phone = case
          when nullif(btrim(c.phone), '') is null and v_phone is not null
               and not exists (
                 select 1 from public.crm_contacts x
                 where x.company_id = p_company_id and x.deleted_at is null
                   and x.id <> c.id and x.phone = v_phone
               ) then v_phone
          else c.phone
        end,
        email = case
          when nullif(btrim(c.email), '') is null and v_email is not null
               and not exists (
                 select 1 from public.crm_contacts x
                 where x.company_id = p_company_id and x.deleted_at is null
                   and x.id <> c.id and lower(btrim(x.email)) = v_email
               ) then v_email
          else c.email
        end,
        source = coalesce(nullif(btrim(c.source), ''), nullif(btrim(p_source), '')),
        updated_at = now()
    where c.id = v_contact_id;
    return v_contact_id;
  end if;

  -- Rows without any stable identity are deliberately not collapsed together.
  if v_phone is null and v_email is null and v_name is null then
    return null;
  end if;

  begin
    insert into public.crm_contacts (
      company_id, first_name, last_name, phone, email, source, created_by
    ) values (
      p_company_id, v_first_name, v_last_name, v_phone, v_email,
      nullif(btrim(p_source), ''), p_created_by
    )
    returning id into v_contact_id;
  exception when unique_violation then
    -- Concurrent ingestion can race on the same phone/email. Re-read the winner.
    if v_phone is not null then
      select id into v_contact_id from public.crm_contacts
      where company_id = p_company_id and deleted_at is null and phone = v_phone
      order by created_at asc limit 1;
    end if;
    if v_contact_id is null and v_email is not null then
      select id into v_contact_id from public.crm_contacts
      where company_id = p_company_id and deleted_at is null and lower(btrim(email)) = v_email
      order by created_at asc limit 1;
    end if;
    if v_contact_id is null then raise; end if;
  end;

  return v_contact_id;
end;
$$;

revoke all on function public.crm_resolve_contact(uuid, text, text, text, text, uuid) from public, anon, authenticated;
grant execute on function public.crm_resolve_contact(uuid, text, text, text, text, uuid) to service_role;

-- Backfill the canonical identity graph in dependency order.
update public.marketing_leads ml
set crm_contact_id = public.crm_resolve_contact(
      ml.company_id,
      coalesce(nullif(btrim(concat_ws(' ', ml.first_name, ml.last_name)), ''), nullif(btrim(ml.name), '')),
      ml.phone, ml.email, coalesce(ml.source, ml.platform), null
    ),
    updated_at = now()
where ml.crm_contact_id is null;

update public.crm_deals d
set contact_id = coalesce(
      (select ml.crm_contact_id from public.marketing_leads ml
       where ml.id = d.marketing_lead_id and ml.company_id = d.company_id),
      public.crm_resolve_contact(d.company_id, d.title, d.phone, d.email, d.source, d.created_by)
    ),
    updated_at = now()
where d.deleted_at is null and d.contact_id is null;

update public.marketing_conversations c
set contact_id = coalesce(
      (select ml.crm_contact_id from public.marketing_leads ml
       where ml.id = c.lead_id and ml.company_id = c.company_id),
      public.crm_resolve_contact(c.company_id, c.title, c.phone, null, c.channel, null)
    ),
    updated_at = now()
where c.archived_at is null and c.contact_id is null;

update public.clinic_patients p
set crm_contact_id = public.crm_resolve_contact(
      p.company_id, p.name, p.phone, p.email, p.source_system, null
    ),
    updated_at = now()
where p.crm_contact_id is null;

update public.marketing_calls c
set contact_id = coalesce(
      (select ml.crm_contact_id from public.marketing_leads ml
       where ml.id = c.lead_id and ml.company_id = c.company_id),
      (select mc.contact_id from public.marketing_conversations mc
       where mc.id = c.conversation_id and mc.company_id = c.company_id),
      public.crm_resolve_contact(c.company_id, c.client_name, c.client_phone, null, coalesce(c.source, c.channel), null)
    ),
    updated_at = now()
where c.contact_id is null;

update public.waba_clinic_appointments a
set contact_id = coalesce(
      (select ml.crm_contact_id from public.marketing_leads ml
       where ml.id = a.lead_id and ml.company_id = a.company_id),
      (select mc.contact_id from public.marketing_conversations mc
       where mc.id = a.conversation_id and mc.company_id = a.company_id),
      (select p.crm_contact_id from public.clinic_patients p
       where p.id = a.patient_id and p.company_id = a.company_id),
      public.crm_resolve_contact(a.company_id, a.patient_name, a.phone, null, a.source, null)
    ),
    updated_at = now()
where a.contact_id is null;

update public.patient_journey_events e
set contact_id = (
  select ml.crm_contact_id from public.marketing_leads ml
  where ml.id = e.lead_id and ml.company_id = e.company_id
)
where e.contact_id is null and e.lead_id is not null;

-- Future writes: resolve missing contact links at the database boundary.
create or replace function public.crm_assign_lead_contact()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.crm_contact_id is null then
    new.crm_contact_id := public.crm_resolve_contact(
      new.company_id,
      coalesce(nullif(btrim(concat_ws(' ', new.first_name, new.last_name)), ''), nullif(btrim(new.name), '')),
      new.phone, new.email, coalesce(new.source, new.platform), null
    );
  end if;
  return new;
end; $$;

create or replace function public.crm_assign_deal_contact()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.contact_id is null then
    if new.marketing_lead_id is not null then
      select crm_contact_id into new.contact_id from public.marketing_leads
      where id = new.marketing_lead_id and company_id = new.company_id;
    end if;
    if new.contact_id is null then
      new.contact_id := public.crm_resolve_contact(new.company_id, new.title, new.phone, new.email, new.source, new.created_by);
    end if;
  end if;
  return new;
end; $$;

create or replace function public.crm_assign_conversation_contact()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.contact_id is null then
    if new.lead_id is not null then
      select crm_contact_id into new.contact_id from public.marketing_leads
      where id = new.lead_id and company_id = new.company_id;
    end if;
    if new.contact_id is null then
      new.contact_id := public.crm_resolve_contact(new.company_id, new.title, new.phone, null, new.channel, null);
    end if;
  end if;
  return new;
end; $$;

create or replace function public.crm_assign_call_contact()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.contact_id is null then
    if new.lead_id is not null then
      select crm_contact_id into new.contact_id from public.marketing_leads
      where id = new.lead_id and company_id = new.company_id;
    end if;
    if new.contact_id is null and new.conversation_id is not null then
      select contact_id into new.contact_id from public.marketing_conversations
      where id = new.conversation_id and company_id = new.company_id;
    end if;
    if new.contact_id is null then
      new.contact_id := public.crm_resolve_contact(new.company_id, new.client_name, new.client_phone, null, coalesce(new.source, new.channel), null);
    end if;
  end if;
  return new;
end; $$;

create or replace function public.crm_assign_patient_contact()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.crm_contact_id is null then
    new.crm_contact_id := public.crm_resolve_contact(new.company_id, new.name, new.phone, new.email, new.source_system, null);
  end if;
  return new;
end; $$;

create or replace function public.crm_assign_appointment_contact()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.contact_id is null then
    if new.lead_id is not null then
      select crm_contact_id into new.contact_id from public.marketing_leads
      where id = new.lead_id and company_id = new.company_id;
    end if;
    if new.contact_id is null and new.conversation_id is not null then
      select contact_id into new.contact_id from public.marketing_conversations
      where id = new.conversation_id and company_id = new.company_id;
    end if;
    if new.contact_id is null and new.patient_id is not null then
      select crm_contact_id into new.contact_id from public.clinic_patients
      where id = new.patient_id and company_id = new.company_id;
    end if;
    if new.contact_id is null then
      new.contact_id := public.crm_resolve_contact(new.company_id, new.patient_name, new.phone, null, new.source, null);
    end if;
  end if;
  return new;
end; $$;

create or replace function public.crm_assign_journey_contact()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.contact_id is null and new.lead_id is not null then
    select crm_contact_id into new.contact_id from public.marketing_leads
    where id = new.lead_id and company_id = new.company_id;
  end if;
  return new;
end; $$;

revoke all on function public.crm_assign_lead_contact() from public, anon, authenticated;
revoke all on function public.crm_assign_deal_contact() from public, anon, authenticated;
revoke all on function public.crm_assign_conversation_contact() from public, anon, authenticated;
revoke all on function public.crm_assign_call_contact() from public, anon, authenticated;
revoke all on function public.crm_assign_patient_contact() from public, anon, authenticated;
revoke all on function public.crm_assign_appointment_contact() from public, anon, authenticated;
revoke all on function public.crm_assign_journey_contact() from public, anon, authenticated;
grant execute on function public.crm_assign_lead_contact() to service_role;
grant execute on function public.crm_assign_deal_contact() to service_role;
grant execute on function public.crm_assign_conversation_contact() to service_role;
grant execute on function public.crm_assign_call_contact() to service_role;
grant execute on function public.crm_assign_patient_contact() to service_role;
grant execute on function public.crm_assign_appointment_contact() to service_role;
grant execute on function public.crm_assign_journey_contact() to service_role;

drop trigger if exists zz_customer360_lead_contact on public.marketing_leads;
create trigger zz_customer360_lead_contact
before insert or update of company_id, phone, email, name, first_name, last_name, source, platform, crm_contact_id
on public.marketing_leads for each row execute function public.crm_assign_lead_contact();

drop trigger if exists zz_customer360_deal_contact on public.crm_deals;
create trigger zz_customer360_deal_contact
before insert or update of company_id, contact_id, marketing_lead_id, title, phone, email, source
on public.crm_deals for each row execute function public.crm_assign_deal_contact();

drop trigger if exists zz_customer360_conversation_contact on public.marketing_conversations;
create trigger zz_customer360_conversation_contact
before insert or update of company_id, contact_id, lead_id, title, phone, channel
on public.marketing_conversations for each row execute function public.crm_assign_conversation_contact();

drop trigger if exists zz_customer360_call_contact on public.marketing_calls;
create trigger zz_customer360_call_contact
before insert or update of company_id, contact_id, lead_id, conversation_id, client_name, client_phone, source, channel
on public.marketing_calls for each row execute function public.crm_assign_call_contact();

drop trigger if exists zz_customer360_patient_contact on public.clinic_patients;
create trigger zz_customer360_patient_contact
before insert or update of company_id, crm_contact_id, name, phone, email, source_system
on public.clinic_patients for each row execute function public.crm_assign_patient_contact();

drop trigger if exists zz_customer360_appointment_contact on public.waba_clinic_appointments;
create trigger zz_customer360_appointment_contact
before insert or update of company_id, contact_id, lead_id, conversation_id, patient_id, patient_name, phone, source
on public.waba_clinic_appointments for each row execute function public.crm_assign_appointment_contact();

drop trigger if exists zz_customer360_journey_contact on public.patient_journey_events;
create trigger zz_customer360_journey_contact
before insert or update of company_id, contact_id, lead_id
on public.patient_journey_events for each row execute function public.crm_assign_journey_contact();

create or replace function public.crm_propagate_lead_contact()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.crm_contact_id is not null and new.crm_contact_id is distinct from old.crm_contact_id then
    update public.crm_deals
      set contact_id = new.crm_contact_id, updated_at = now()
      where company_id = new.company_id and marketing_lead_id = new.id
        and (contact_id is null or contact_id = old.crm_contact_id);
    update public.marketing_conversations
      set contact_id = new.crm_contact_id, updated_at = now()
      where company_id = new.company_id and lead_id = new.id and archived_at is null
        and (contact_id is null or contact_id = old.crm_contact_id);
    update public.marketing_calls
      set contact_id = new.crm_contact_id, updated_at = now()
      where company_id = new.company_id and lead_id = new.id
        and (contact_id is null or contact_id = old.crm_contact_id);
    update public.waba_clinic_appointments
      set contact_id = new.crm_contact_id, updated_at = now()
      where company_id = new.company_id and lead_id = new.id
        and (contact_id is null or contact_id = old.crm_contact_id);
    update public.patient_journey_events
      set contact_id = new.crm_contact_id, updated_at = now()
      where company_id = new.company_id and lead_id = new.id
        and (contact_id is null or contact_id = old.crm_contact_id);
  end if;
  return new;
end;
$$;

revoke all on function public.crm_propagate_lead_contact() from public, anon, authenticated;
grant execute on function public.crm_propagate_lead_contact() to service_role;

drop trigger if exists zz_customer360_propagate_lead_contact on public.marketing_leads;
create trigger zz_customer360_propagate_lead_contact
after update of crm_contact_id on public.marketing_leads
for each row execute function public.crm_propagate_lead_contact();

-- Explicit contact merge. No physical deletion: source contact remains as a historical tombstone.
create or replace function public.crm_merge_contacts(
  p_company_id uuid,
  p_target_contact_id uuid,
  p_source_contact_id uuid,
  p_actor_user_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_target public.crm_contacts%rowtype;
  v_source public.crm_contacts%rowtype;
begin
  if p_target_contact_id = p_source_contact_id then
    raise exception 'Target and source contact must be different';
  end if;

  select * into v_target from public.crm_contacts
  where id = p_target_contact_id and company_id = p_company_id and deleted_at is null
  for update;
  if not found then raise exception 'Target contact not found'; end if;

  select * into v_source from public.crm_contacts
  where id = p_source_contact_id and company_id = p_company_id and deleted_at is null
  for update;
  if not found then raise exception 'Source contact not found'; end if;

  -- Release active unique identity keys from source inside this same transaction.
  update public.crm_contacts
  set deleted_at = now(), updated_at = now()
  where id = p_source_contact_id and company_id = p_company_id;

  update public.crm_contacts
  set first_name = coalesce(nullif(btrim(first_name), ''), nullif(btrim(v_source.first_name), '')),
      last_name = coalesce(nullif(btrim(last_name), ''), nullif(btrim(v_source.last_name), '')),
      phone = coalesce(nullif(btrim(phone), ''), nullif(btrim(v_source.phone), '')),
      email = coalesce(nullif(btrim(email), ''), nullif(btrim(v_source.email), '')),
      source = coalesce(nullif(btrim(source), ''), nullif(btrim(v_source.source), '')),
      updated_at = now()
  where id = p_target_contact_id and company_id = p_company_id;

  update public.marketing_leads set crm_contact_id = p_target_contact_id, updated_at = now()
    where company_id = p_company_id and crm_contact_id = p_source_contact_id;
  update public.crm_deals set contact_id = p_target_contact_id, updated_at = now()
    where company_id = p_company_id and contact_id = p_source_contact_id;
  update public.marketing_conversations set contact_id = p_target_contact_id, updated_at = now()
    where company_id = p_company_id and contact_id = p_source_contact_id;
  update public.marketing_calls set contact_id = p_target_contact_id, updated_at = now()
    where company_id = p_company_id and contact_id = p_source_contact_id;
  update public.waba_clinic_appointments set contact_id = p_target_contact_id, updated_at = now()
    where company_id = p_company_id and contact_id = p_source_contact_id;
  update public.patient_journey_events set contact_id = p_target_contact_id, updated_at = now()
    where company_id = p_company_id and contact_id = p_source_contact_id;
  update public.clinic_patients set crm_contact_id = p_target_contact_id, updated_at = now()
    where company_id = p_company_id and crm_contact_id = p_source_contact_id;
  update public.crm_tasks
    set link_id = p_target_contact_id::text,
        link_label = coalesce(nullif(link_label, ''), nullif(btrim(concat_ws(' ', v_target.first_name, v_target.last_name)), '')),
        updated_at = now()
    where company_id = p_company_id
      and link_type in ('contact', 'customer')
      and link_id = p_source_contact_id::text;

  return p_target_contact_id;
end;
$$;

revoke all on function public.crm_merge_contacts(uuid, uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.crm_merge_contacts(uuid, uuid, uuid, uuid) to service_role;
