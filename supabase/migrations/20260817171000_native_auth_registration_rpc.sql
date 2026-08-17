create or replace function public.imds_native_register_account(
  p_email text,
  p_display_name text,
  p_password_hash text,
  p_mode text,
  p_company_name text default null,
  p_company_slug text default null,
  p_company_code_hash text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_name text := btrim(coalesce(p_display_name, ''));
  v_auth_user_id uuid := gen_random_uuid();
  v_marketing_user_id uuid := gen_random_uuid();
  v_company_id uuid;
  v_join_code public.crm_company_join_codes%rowtype;
begin
  if v_email = '' or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'Введите корректный email' using errcode = '22023';
  end if;
  if char_length(v_name) < 2 or char_length(v_name) > 160 then
    raise exception 'Укажите имя пользователя' using errcode = '22023';
  end if;
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

  insert into public.imds_auth_users(id, email, display_name, status, email_verified)
  values (v_auth_user_id, v_email, v_name, 'active', false);

  insert into public.imds_auth_passwords(user_id, password_hash)
  values (v_auth_user_id, p_password_hash);

  insert into public.imds_auth_identities(user_id, provider, provider_subject, email, metadata)
  values (v_auth_user_id, 'password', v_email, v_email, '{}'::jsonb);

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
    jsonb_build_object('native_auth', true),
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
  else
    insert into public.crm_company_members(company_id, user_id, role, status)
    values (v_company_id, v_marketing_user_id, 'viewer', 'invited')
    on conflict (company_id, user_id) do update set status = 'invited';

    insert into public.crm_company_onboarding(company_id, user_id, status, requested_role, full_name)
    values (v_company_id, v_marketing_user_id, 'needs_profile', 'viewer', v_name)
    on conflict (company_id, user_id) do update
      set status = 'needs_profile', full_name = excluded.full_name, rejection_reason = null, updated_at = now();

    update public.crm_company_join_codes
    set use_count = use_count + 1, updated_at = now()
    where id = v_join_code.id;
  end if;

  return jsonb_build_object(
    'auth_user_id', v_auth_user_id,
    'marketing_user_id', v_marketing_user_id,
    'company_id', v_company_id,
    'onboarding_status', case when p_mode = 'new_company' then 'approved' else 'needs_profile' end
  );
end
$$;

revoke all on function public.imds_native_register_account(text,text,text,text,text,text,text) from public, anon, authenticated;
grant execute on function public.imds_native_register_account(text,text,text,text,text,text,text) to service_role;

notify pgrst, 'reload schema';
