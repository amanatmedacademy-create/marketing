create or replace function public.imds_native_create_company(
  p_auth_user_id uuid,
  p_company_name text,
  p_company_slug text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_marketing_user_id uuid;
  v_company_id uuid := gen_random_uuid();
begin
  select id into v_marketing_user_id from public.marketing_users where auth_user_id = p_auth_user_id limit 1;
  if v_marketing_user_id is null then raise exception 'Профиль пользователя не найден' using errcode='22023'; end if;
  if char_length(btrim(coalesce(p_company_name,''))) < 2 then raise exception 'Укажите название организации' using errcode='22023'; end if;
  if nullif(btrim(coalesce(p_company_slug,'')),'') is null then raise exception 'Не удалось сформировать адрес организации' using errcode='22023'; end if;

  insert into public.crm_companies(id,name,slug,timezone,currency,created_by)
  values(v_company_id,btrim(p_company_name),p_company_slug,'Asia/Almaty','KZT',v_marketing_user_id);
  insert into public.crm_company_members(company_id,user_id,role,status)
  values(v_company_id,v_marketing_user_id,'owner','active');
  update public.marketing_users set role='administrator', status='active', updated_at=now() where id=v_marketing_user_id;

  return jsonb_build_object('company_id',v_company_id,'status','approved');
end
$$;

create or replace function public.imds_native_join_company(
  p_auth_user_id uuid,
  p_company_code_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_marketing_user_id uuid;
  v_code public.crm_company_join_codes%rowtype;
  v_onboarding_id uuid;
begin
  select id into v_marketing_user_id from public.marketing_users where auth_user_id=p_auth_user_id limit 1;
  if v_marketing_user_id is null then raise exception 'Профиль пользователя не найден' using errcode='22023'; end if;

  select * into v_code from public.crm_company_join_codes
  where code_hash=p_company_code_hash and active=true for update;
  if not found then raise exception 'Код организации не найден или отключён' using errcode='22023'; end if;
  if v_code.expires_at is not null and v_code.expires_at<=now() then raise exception 'Срок действия кода организации истёк' using errcode='22023'; end if;
  if v_code.max_uses is not null and v_code.use_count>=v_code.max_uses then raise exception 'Лимит использования кода организации исчерпан' using errcode='22023'; end if;

  insert into public.crm_company_members(company_id,user_id,role,status)
  values(v_code.company_id,v_marketing_user_id,'viewer','invited')
  on conflict(company_id,user_id) do update set status='invited';

  insert into public.crm_company_onboarding(company_id,user_id,status,requested_role,full_name)
  select v_code.company_id,v_marketing_user_id,'needs_profile','viewer',coalesce(nullif(full_name,''),name)
  from public.marketing_users where id=v_marketing_user_id
  on conflict(company_id,user_id) do update
    set status='needs_profile',rejection_reason=null,updated_at=now()
  returning id into v_onboarding_id;

  update public.crm_company_join_codes set use_count=use_count+1,updated_at=now() where id=v_code.id;
  return jsonb_build_object('company_id',v_code.company_id,'onboarding_id',v_onboarding_id,'status','needs_profile');
end
$$;

create or replace function public.imds_native_submit_onboarding_profile(
  p_auth_user_id uuid,
  p_full_name text,
  p_phone text default null,
  p_position text default null,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_marketing_user_id uuid;
  v_row public.crm_company_onboarding%rowtype;
begin
  select id into v_marketing_user_id from public.marketing_users where auth_user_id=p_auth_user_id limit 1;
  if v_marketing_user_id is null then raise exception 'Профиль пользователя не найден' using errcode='22023'; end if;
  if char_length(btrim(coalesce(p_full_name,'')))<2 then raise exception 'Укажите имя сотрудника' using errcode='22023'; end if;

  select * into v_row from public.crm_company_onboarding
  where user_id=v_marketing_user_id and status in ('needs_profile','rejected')
  order by updated_at desc limit 1 for update;
  if not found then raise exception 'Активная заявка на регистрацию не найдена' using errcode='22023'; end if;

  update public.crm_company_onboarding
  set full_name=btrim(p_full_name),phone=nullif(btrim(coalesce(p_phone,'')),''),position=nullif(btrim(coalesce(p_position,'')),''),
      notes=nullif(btrim(coalesce(p_notes,'')),''),status='pending_approval',submitted_at=now(),rejection_reason=null,updated_at=now()
  where id=v_row.id;
  update public.marketing_users set full_name=btrim(p_full_name),name=btrim(p_full_name),phone=nullif(btrim(coalesce(p_phone,'')),''),updated_at=now()
  where id=v_marketing_user_id;

  return jsonb_build_object('company_id',v_row.company_id,'onboarding_id',v_row.id,'status','pending_approval');
end
$$;

revoke all on function public.imds_native_create_company(uuid,text,text) from public,anon,authenticated;
revoke all on function public.imds_native_join_company(uuid,text) from public,anon,authenticated;
revoke all on function public.imds_native_submit_onboarding_profile(uuid,text,text,text,text) from public,anon,authenticated;
grant execute on function public.imds_native_create_company(uuid,text,text) to service_role;
grant execute on function public.imds_native_join_company(uuid,text) to service_role;
grant execute on function public.imds_native_submit_onboarding_profile(uuid,text,text,text,text) to service_role;

notify pgrst,'reload schema';
