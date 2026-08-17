-- Runtime account/organization/clinic flows for authenticated IMDS users.
-- Preserves crm_companies as the canonical Marketing tenant table.

create or replace function public.imds_assign_company_organization()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if new.organization_id is null then
    insert into public.imds_organizations(id, name, slug, created_by, created_at, updated_at)
    values (
      new.id,
      coalesce(nullif(btrim(new.name), ''), new.id::text),
      nullif(btrim(new.slug), ''),
      new.created_by,
      now(),
      now()
    )
    on conflict (id) do update
      set name = excluded.name,
          slug = coalesce(public.imds_organizations.slug, excluded.slug),
          updated_at = now();
    new.organization_id := new.id;
  end if;
  return new;
end
$$;

revoke all on function public.imds_assign_company_organization() from public;

drop trigger if exists crm_companies_assign_organization on public.crm_companies;
create trigger crm_companies_assign_organization
before insert on public.crm_companies
for each row execute function public.imds_assign_company_organization();

create or replace function public.imds_create_clinic(
  p_user_id uuid,
  p_name text,
  p_slug text default null,
  p_source_company_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
  v_slug text := lower(btrim(coalesce(p_slug, '')));
  v_company_id uuid := gen_random_uuid();
  v_organization_id uuid;
  v_auth_user_id uuid;
  v_suffix text := substr(replace(v_company_id::text, '-', ''), 1, 8);
begin
  if char_length(v_name) < 2 or char_length(v_name) > 180 then
    raise exception 'Укажите корректное название клиники' using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.marketing_users u
    where u.id = p_user_id and u.status = 'active'
  ) then
    raise exception 'Пользователь не активен' using errcode = '42501';
  end if;

  if p_source_company_id is not null then
    select c.organization_id
      into v_organization_id
    from public.crm_companies c
    join public.crm_company_members m
      on m.company_id = c.id
     and m.user_id = p_user_id
     and m.status = 'active'
     and m.role in ('owner', 'administrator')
    where c.id = p_source_company_id
    limit 1;

    if v_organization_id is null then
      raise exception 'Добавлять клиники в эту организацию может только владелец или администратор' using errcode = '42501';
    end if;
  else
    v_organization_id := v_company_id;
    insert into public.imds_organizations(id, name, slug, created_by)
    values (v_organization_id, v_name, nullif(v_slug, ''), p_user_id)
    on conflict (id) do nothing;
  end if;

  if v_slug = '' then
    v_slug := regexp_replace(lower(v_name), '[^a-z0-9]+', '-', 'g');
    v_slug := trim(both '-' from v_slug);
  end if;
  if v_slug = '' then
    v_slug := 'clinic-' || v_suffix;
  end if;
  if exists (select 1 from public.crm_companies where lower(slug) = lower(v_slug)) then
    v_slug := left(v_slug, 70) || '-' || v_suffix;
  end if;

  insert into public.crm_companies(
    id, name, slug, timezone, currency, created_by, organization_id
  ) values (
    v_company_id, v_name, v_slug, 'Asia/Almaty', 'KZT', p_user_id, v_organization_id
  );

  insert into public.crm_company_members(company_id, user_id, role, status)
  values (v_company_id, p_user_id, 'owner', 'active')
  on conflict (company_id, user_id) do update
    set role = 'owner', status = 'active';

  select u.auth_user_id into v_auth_user_id
  from public.marketing_users u
  where u.id = p_user_id
  limit 1;

  if v_auth_user_id is not null then
    update public.imds_auth_users
    set default_company_id = coalesce(default_company_id, v_company_id),
        updated_at = now()
    where id = v_auth_user_id;
  end if;

  return jsonb_build_object(
    'id', v_company_id,
    'name', v_name,
    'slug', v_slug,
    'organizationId', v_organization_id,
    'role', 'owner',
    'status', 'active'
  );
end
$$;

create or replace function public.imds_join_clinic(
  p_user_id uuid,
  p_company_code_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_code_hash text := btrim(coalesce(p_company_code_hash, ''));
  v_join_code public.crm_company_join_codes%rowtype;
  v_company public.crm_companies%rowtype;
  v_existing public.crm_company_members%rowtype;
begin
  if v_code_hash = '' then
    raise exception 'Введите код клиники' using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.marketing_users u
    where u.id = p_user_id and u.status = 'active'
  ) then
    raise exception 'Пользователь не активен' using errcode = '42501';
  end if;

  select * into v_join_code
  from public.crm_company_join_codes
  where code_hash = v_code_hash and active = true
  for update;

  if not found then
    raise exception 'Код клиники не найден или отключён' using errcode = '22023';
  end if;
  if v_join_code.expires_at is not null and v_join_code.expires_at <= now() then
    raise exception 'Срок действия кода клиники истёк' using errcode = '22023';
  end if;
  if v_join_code.max_uses is not null and v_join_code.use_count >= v_join_code.max_uses then
    raise exception 'Лимит использования кода клиники исчерпан' using errcode = '22023';
  end if;

  select * into v_existing
  from public.crm_company_members
  where company_id = v_join_code.company_id and user_id = p_user_id
  limit 1;

  if found and v_existing.status = 'active' then
    select * into strict v_company from public.crm_companies where id = v_join_code.company_id;
    return jsonb_build_object(
      'id', v_company.id,
      'name', v_company.name,
      'slug', v_company.slug,
      'organizationId', v_company.organization_id,
      'role', v_existing.role,
      'status', 'active',
      'alreadyMember', true
    );
  end if;

  insert into public.crm_company_members(company_id, user_id, role, status)
  values (v_join_code.company_id, p_user_id, 'viewer', 'invited')
  on conflict (company_id, user_id) do update
    set role = coalesce(nullif(public.crm_company_members.role, ''), 'viewer'),
        status = 'invited';

  insert into public.crm_company_onboarding(company_id, user_id, status, requested_role, full_name, phone)
  select
    v_join_code.company_id,
    p_user_id,
    'needs_profile',
    'viewer',
    coalesce(nullif(btrim(u.full_name), ''), nullif(btrim(u.name), ''), split_part(u.email, '@', 1)),
    nullif(btrim(coalesce(a.phone, '')), '')
  from public.marketing_users u
  left join public.imds_auth_users a on a.id = u.auth_user_id
  where u.id = p_user_id
  on conflict (company_id, user_id) do update
    set status = 'needs_profile',
        full_name = excluded.full_name,
        phone = excluded.phone,
        rejection_reason = null,
        updated_at = now();

  update public.crm_company_join_codes
  set use_count = use_count + 1, updated_at = now()
  where id = v_join_code.id;

  select * into strict v_company from public.crm_companies where id = v_join_code.company_id;
  return jsonb_build_object(
    'id', v_company.id,
    'name', v_company.name,
    'slug', v_company.slug,
    'organizationId', v_company.organization_id,
    'role', 'viewer',
    'status', 'invited',
    'onboardingStatus', 'needs_profile'
  );
end
$$;

revoke all on function public.imds_create_clinic(uuid,text,text,uuid) from public, anon, authenticated;
revoke all on function public.imds_join_clinic(uuid,text) from public, anon, authenticated;
grant execute on function public.imds_create_clinic(uuid,text,text,uuid) to service_role;
grant execute on function public.imds_join_clinic(uuid,text) to service_role;

notify pgrst, 'reload schema';
