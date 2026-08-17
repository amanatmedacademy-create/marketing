-- Atomic ownership transfer for one clinic tenant.
create or replace function public.imds_transfer_company_ownership(
  p_company_id uuid,
  p_actor_user_id uuid,
  p_new_owner_user_id uuid,
  p_platform_override boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor_role text;
  v_target_status text;
begin
  if p_actor_user_id = p_new_owner_user_id then
    raise exception 'Новый владелец уже совпадает с текущим пользователем' using errcode='22023';
  end if;

  select role into v_actor_role
  from public.crm_company_members
  where company_id=p_company_id and user_id=p_actor_user_id and status='active'
  for update;

  if not coalesce(p_platform_override,false) and coalesce(v_actor_role,'') <> 'owner' then
    raise exception 'Передавать владение может только владелец' using errcode='42501';
  end if;

  select status into v_target_status
  from public.crm_company_members
  where company_id=p_company_id and user_id=p_new_owner_user_id
  for update;

  if coalesce(v_target_status,'') <> 'active' then
    raise exception 'Новый владелец должен быть активным участником клиники' using errcode='22023';
  end if;

  update public.crm_company_members
  set role='administrator'
  where company_id=p_company_id and role='owner';

  update public.crm_company_members
  set role='owner', status='active'
  where company_id=p_company_id and user_id=p_new_owner_user_id;

  return jsonb_build_object('ok',true,'companyId',p_company_id,'ownerId',p_new_owner_user_id);
end
$$;

revoke all on function public.imds_transfer_company_ownership(uuid,uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function public.imds_transfer_company_ownership(uuid,uuid,uuid,boolean) to service_role;

notify pgrst,'reload schema';
