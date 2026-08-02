-- Maps the product-owned CRM company UUID to the central IMDS Platform organization UUID.
-- The two identifiers are intentionally distinct and must never be assumed equal.

alter table public.crm_module_installations
  add column if not exists platform_organization_id uuid;

create index if not exists crm_module_installations_platform_org_idx
  on public.crm_module_installations(platform_organization_id,module_code,status);

create or replace function public.resolve_platform_organization_id(company_id_value uuid)
returns uuid
language sql
stable
security definer
set search_path=public
as $$
  select installation.platform_organization_id
  from public.crm_module_installations installation
  where installation.company_id=company_id_value
    and installation.platform_organization_id is not null
    and installation.status not in ('archived','failed')
  order by installation.updated_at desc
  limit 1;
$$;

create or replace function public.provision_crm_kanban(
  installation_id_value uuid,
  platform_organization_id_value uuid,
  company_id_value uuid,
  host_product_code_value text,
  module_version_value text,
  config_value jsonb,
  limits_value jsonb,
  permissions_value text[],
  idempotency_key_value text,
  trace_id_value text default null
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  result_value jsonb;
begin
  if platform_organization_id_value is null then
    raise exception 'Platform organization ID is required';
  end if;

  result_value:=public.provision_crm_kanban(
    installation_id_value,
    company_id_value,
    host_product_code_value,
    module_version_value,
    config_value,
    limits_value,
    permissions_value,
    idempotency_key_value,
    trace_id_value
  );

  update public.crm_module_installations
  set platform_organization_id=platform_organization_id_value,
      updated_at=now()
  where installation_id=installation_id_value;

  return result_value || jsonb_build_object('platformOrganizationId',platform_organization_id_value);
end;
$$;

revoke all on function public.resolve_platform_organization_id(uuid) from public;
revoke all on function public.provision_crm_kanban(uuid,uuid,uuid,text,text,jsonb,jsonb,text[],text,text) from public;
grant execute on function public.resolve_platform_organization_id(uuid) to service_role;
grant execute on function public.provision_crm_kanban(uuid,uuid,uuid,text,text,jsonb,jsonb,text[],text,text) to service_role;

comment on column public.crm_module_installations.platform_organization_id is
  'Central control-plane organization UUID mapped to this product-owned CRM company.';
