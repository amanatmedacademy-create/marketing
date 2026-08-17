-- Capture a verified registration phone and durable organization.registered event.
-- The event is created in the same transaction as the organization and 3-day trial.

alter table public.imds_auth_users
  add column if not exists phone text;

create table if not exists public.imds_platform_event_outbox (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,
  aggregate_id uuid not null,
  payload jsonb not null,
  status text not null default 'pending' check (status in ('pending','delivered')),
  attempts integer not null default 0 check (attempts >= 0),
  last_error text,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (jsonb_typeof(payload) = 'object')
);

create index if not exists imds_platform_event_outbox_pending_idx
  on public.imds_platform_event_outbox(created_at)
  where status = 'pending';

revoke all on public.imds_platform_event_outbox from anon, authenticated;
grant all on public.imds_platform_event_outbox to service_role;

create or replace function public.imds_native_register_account(
  p_email text,
  p_display_name text,
  p_password_hash text,
  p_mode text,
  p_company_name text,
  p_company_slug text,
  p_company_code_hash text,
  p_phone text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_name text := btrim(coalesce(p_display_name, ''));
  v_phone text := btrim(coalesce(p_phone, ''));
  v_phone_digits text := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
  v_auth_user_id uuid := gen_random_uuid();
  v_marketing_user_id uuid := gen_random_uuid();
  v_company_id uuid;
  v_join_code public.crm_company_join_codes%rowtype;
  v_trial public.imds_product_trial_access%rowtype;
  v_event_id uuid;
begin
  if v_email = '' or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'Введите корректный email' using errcode = '22023';
  end if;
  if char_length(v_name) < 2 or char_length(v_name) > 160 then
    raise exception 'Укажите имя пользователя' using errcode = '22023';
  end if;
  if char_length(v_phone_digits) < 10 or char_length(v_phone_digits) > 15 then
    raise exception 'Введите корректный номер телефона' using errcode = '22023';
  end if;
  v_phone := '+' || v_phone_digits;
  if nullif(p_password_hash, '') is null then
    raise exception 'Пароль не обработан' using errcode = '22023';
  end if;
  if exists (select 1 from public.imds_auth_users where lower(btrim(email)) = v_email) then
    raise exception 'Пользователь с таким email уже зарегистрирован' using errcode = '23505';
  end if;

  if p_mode not in ('new_company', 'join_company') then
    raise exception 'Неизвестный режим регистрации' using errcode = '22023';
  end if;

  if p_mode = 'join_company' then
    if nullif(btrim(coalesce(p_company_code_hash, '')), '') is null then
      raise exception 'Введите код организации' using errcode = '22023';
    end if;
    select * into v_join_code
    from public.crm_company_join_codes
    where code_hash = p_company_code_hash and active = true
    for update;
    if not found then
      raise exception 'Код организации не найден или отключён' using errcode = '22023';
    end if;
    if v_join_code.expires_at is not null and v_join_code.expires_at <= now() then
      raise exception 'Срок действия кода организации истёк' using errcode = '22023';
    end if;
    if v_join_code.max_uses is not null and v_join_code.use_count >= v_join_code.max_uses then
      raise exception 'Лимит использования кода организации исчерпан' using errcode = '22023';
    end if;
    v_company_id := v_join_code.company_id;
  end if;

  insert into public.imds_auth_users(id, email, display_name, phone, status, email_verified)
  values (v_auth_user_id, v_email, v_name, v_phone, 'active', false);

  insert into public.imds_auth_passwords(user_id, password_hash)
  values (v_auth_user_id, p_password_hash);

  insert into public.imds_auth_identities(user_id, provider, provider_subject, email, metadata)
  values (v_auth_user_id, 'password', v_email, v_email, jsonb_build_object('phone', v_phone));

  insert into public.marketing_users(
    id, auth_user_id, name, full_name, email, role, status, provider, provider_metadata, last_seen_at
  ) values (
    v_marketing_user_id,
    v_auth_user_id,
    v_name,
    v_name,
    v_email,
    case when p_mode = 'new_company' then 'administrator' else 'viewer' end,
    'active',
    'password',
    jsonb_build_object('native_auth', true, 'phone', v_phone),
    now()
  );

  if p_mode = 'new_company' then
    if char_length(btrim(coalesce(p_company_name, ''))) < 2 then
      raise exception 'Укажите название организации' using errcode = '22023';
    end if;
    if nullif(btrim(coalesce(p_company_slug, '')), '') is null then
      raise exception 'Не удалось сформировать адрес организации' using errcode = '22023';
    end if;
    v_company_id := gen_random_uuid();
    insert into public.crm_companies(id, name, slug, timezone, currency, created_by)
    values (v_company_id, btrim(p_company_name), p_company_slug, 'Asia/Almaty', 'KZT', v_marketing_user_id);
    insert into public.crm_company_members(company_id, user_id, role, status)
    values (v_company_id, v_marketing_user_id, 'owner', 'active');

    select * into strict v_trial
    from public.imds_product_trial_access
    where company_id = v_company_id and product_code = 'imds-marketing';

    v_event_id := gen_random_uuid();
    insert into public.imds_platform_event_outbox(id, event_type, aggregate_id, payload)
    values (
      v_event_id,
      'organization.registered',
      v_company_id,
      jsonb_build_object(
        'eventId', v_event_id,
        'eventType', 'organization.registered',
        'source', 'imds-marketing',
        'occurredAt', now(),
        'company', jsonb_build_object(
          'externalTenantId', v_company_id,
          'name', btrim(p_company_name)
        ),
        'owner', jsonb_build_object(
          'name', v_name,
          'email', v_email,
          'phone', v_phone
        ),
        'trial', jsonb_build_object(
          'productCode', 'imds-marketing',
          'status', 'trial',
          'startsAt', v_trial.trial_started_at,
          'endsAt', v_trial.trial_ends_at,
          'days', 3
        )
      )
    );
  else
    insert into public.crm_company_members(company_id, user_id, role, status)
    values (v_company_id, v_marketing_user_id, 'viewer', 'invited')
    on conflict (company_id, user_id) do update set status = 'invited';

    insert into public.crm_company_onboarding(company_id, user_id, status, requested_role, full_name, phone)
    values (v_company_id, v_marketing_user_id, 'needs_profile', 'viewer', v_name, v_phone)
    on conflict (company_id, user_id) do update
      set status = 'needs_profile', full_name = excluded.full_name, phone = excluded.phone, rejection_reason = null, updated_at = now();

    update public.crm_company_join_codes
    set use_count = use_count + 1, updated_at = now()
    where id = v_join_code.id;
  end if;

  return jsonb_build_object(
    'auth_user_id', v_auth_user_id,
    'marketing_user_id', v_marketing_user_id,
    'company_id', v_company_id,
    'registration_event_id', v_event_id,
    'phone', v_phone,
    'onboarding_status', case when p_mode = 'new_company' then 'approved' else 'needs_profile' end
  );
end
$$;

revoke all on function public.imds_native_register_account(text,text,text,text,text,text,text,text) from public, anon, authenticated;
grant execute on function public.imds_native_register_account(text,text,text,text,text,text,text,text) to service_role;

notify pgrst, 'reload schema';
