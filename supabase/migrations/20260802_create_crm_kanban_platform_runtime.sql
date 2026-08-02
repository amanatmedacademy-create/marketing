-- CRM Kanban runtime controlled by the IMDS Platform control plane.
-- The control plane owns installation state. This product owns CRM workspace,
-- pipeline, stages and tenant-scoped operational records.

create table if not exists public.crm_workspaces (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null unique references public.crm_companies(id) on delete cascade,
  code text not null,
  name text not null,
  status text not null default 'active' check (status in ('active','suspended','archived')),
  platform_installation_id uuid unique,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (code ~ '^[a-z0-9]+([._-][a-z0-9]+)*$'),
  check (jsonb_typeof(metadata) = 'object')
);

create table if not exists public.crm_module_installations (
  installation_id uuid primary key,
  company_id uuid not null references public.crm_companies(id) on delete cascade,
  workspace_id uuid not null references public.crm_workspaces(id) on delete cascade,
  pipeline_id uuid references public.crm_pipelines(id) on delete set null,
  module_code text not null default 'crm.kanban',
  host_product_code text not null,
  module_version text not null,
  status text not null default 'provisioning' check (status in ('provisioning','active','suspended','failed','archived')),
  config jsonb not null default '{}'::jsonb,
  limits jsonb not null default '{}'::jsonb,
  permissions text[] not null default '{}',
  last_idempotency_key text not null,
  last_trace_id text,
  last_health_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id,module_code,host_product_code),
  unique (last_idempotency_key),
  check (module_code = 'crm.kanban'),
  check (jsonb_typeof(config) = 'object'),
  check (jsonb_typeof(limits) = 'object')
);

create table if not exists public.crm_module_command_log (
  id uuid primary key default gen_random_uuid(),
  installation_id uuid not null references public.crm_module_installations(installation_id) on delete cascade,
  operation text not null check (operation in ('install','repair','upgrade','health_check','suspend','resume','uninstall')),
  idempotency_key text not null unique,
  trace_id text,
  request_payload jsonb not null default '{}'::jsonb,
  result_payload jsonb,
  status text not null default 'processing' check (status in ('processing','succeeded','failed')),
  error text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  check (jsonb_typeof(request_payload) = 'object'),
  check (result_payload is null or jsonb_typeof(result_payload) = 'object')
);

create index if not exists crm_module_installations_company_status_idx
  on public.crm_module_installations(company_id,status);
create index if not exists crm_module_command_log_installation_idx
  on public.crm_module_command_log(installation_id,started_at desc);

alter table public.crm_workspaces enable row level security;
alter table public.crm_module_installations enable row level security;
alter table public.crm_module_command_log enable row level security;

revoke all on public.crm_workspaces from anon,authenticated;
revoke all on public.crm_module_installations from anon,authenticated;
revoke all on public.crm_module_command_log from anon,authenticated;
grant all on public.crm_workspaces to service_role;
grant all on public.crm_module_installations to service_role;
grant all on public.crm_module_command_log to service_role;

create or replace function public.crm_kanban_health(
  installation_id_value uuid
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  installation_record public.crm_module_installations%rowtype;
  stage_count integer := 0;
  owner_count integer := 0;
  checks jsonb;
  healthy boolean;
begin
  select * into installation_record
  from public.crm_module_installations
  where installation_id=installation_id_value;

  if not found then
    return jsonb_build_object(
      'healthy',false,
      'status','missing',
      'checks',jsonb_build_object('installation',false),
      'error','CRM Kanban installation was not found'
    );
  end if;

  select count(*) into stage_count
  from public.crm_pipeline_stages
  where company_id=installation_record.company_id
    and pipeline_id=installation_record.pipeline_id
    and name in ('Новый лид','В работе','Назначена консультация','Продажа','Отказ');

  select count(*) into owner_count
  from public.crm_company_members
  where company_id=installation_record.company_id
    and role='owner'
    and status='active';

  checks:=jsonb_build_object(
    'installation',true,
    'workspace',exists(select 1 from public.crm_workspaces w where w.id=installation_record.workspace_id and w.company_id=installation_record.company_id),
    'pipeline',exists(select 1 from public.crm_pipelines p where p.id=installation_record.pipeline_id and p.company_id=installation_record.company_id),
    'defaultStages',stage_count=5,
    'ownerMembership',owner_count>0,
    'localState',installation_record.status
  );

  healthy := installation_record.status in ('active','suspended')
    and coalesce((checks->>'workspace')::boolean,false)
    and coalesce((checks->>'pipeline')::boolean,false)
    and stage_count=5
    and owner_count>0;

  return jsonb_build_object(
    'healthy',healthy,
    'status',case when healthy then 'healthy' else 'failed' end,
    'installationId',installation_record.installation_id,
    'workspaceId',installation_record.workspace_id,
    'pipelineId',installation_record.pipeline_id,
    'checks',checks,
    'lastError',installation_record.last_error
  );
end;
$$;

create or replace function public.provision_crm_kanban(
  installation_id_value uuid,
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
  workspace_id_value uuid;
  pipeline_id_value uuid;
  company_record public.crm_companies%rowtype;
  existing_command public.crm_module_command_log%rowtype;
  health_result jsonb;
begin
  if nullif(btrim(idempotency_key_value),'') is null then raise exception 'Idempotency key is required'; end if;
  if host_product_code_value not in ('marketing','imds-marketing','imds_marketing') then raise exception 'Unsupported host product'; end if;

  select * into existing_command
  from public.crm_module_command_log
  where idempotency_key=idempotency_key_value;
  if found and existing_command.status='succeeded' then
    return existing_command.result_payload;
  end if;

  select * into company_record
  from public.crm_companies
  where id=company_id_value;
  if not found then raise exception 'CRM company not found'; end if;

  insert into public.crm_workspaces(company_id,code,name,status,platform_installation_id,metadata)
  values(
    company_id_value,
    'primary',
    coalesce(nullif(company_record.name,''),'CRM Workspace'),
    'active',
    installation_id_value,
    jsonb_build_object('source','imds-platform','moduleCode','crm.kanban')
  )
  on conflict(company_id) do update
  set platform_installation_id=excluded.platform_installation_id,
      status='active',
      updated_at=now(),
      metadata=public.crm_workspaces.metadata || excluded.metadata
  returning id into workspace_id_value;

  select id into pipeline_id_value
  from public.crm_pipelines
  where company_id=company_id_value and is_default=true
  order by position,created_at
  limit 1;

  if pipeline_id_value is null then
    insert into public.crm_pipelines(company_id,name,is_default,position)
    values(company_id_value,'Основная воронка',true,0)
    returning id into pipeline_id_value;
  end if;

  insert into public.crm_pipeline_stages(company_id,pipeline_id,name,color,position,probability,stage_type)
  select company_id_value,pipeline_id_value,stage.name,stage.color,stage.position,stage.probability,stage.stage_type
  from (values
    ('Новый лид','#3B82F6',0,10,'open'),
    ('В работе','#F59E0B',1,30,'open'),
    ('Назначена консультация','#8B5CF6',2,60,'open'),
    ('Продажа','#22C55E',3,100,'won'),
    ('Отказ','#EF4444',4,0,'lost')
  ) as stage(name,color,position,probability,stage_type)
  where not exists(
    select 1 from public.crm_pipeline_stages existing
    where existing.company_id=company_id_value
      and existing.pipeline_id=pipeline_id_value
      and existing.name=stage.name
  );

  if company_record.created_by is not null then
    insert into public.crm_company_members(company_id,user_id,role,status)
    values(company_id_value,company_record.created_by,'owner','active')
    on conflict(company_id,user_id) do update
    set role='owner',status='active',updated_at=now();
  end if;

  insert into public.crm_module_installations(
    installation_id,company_id,workspace_id,pipeline_id,module_code,host_product_code,
    module_version,status,config,limits,permissions,last_idempotency_key,last_trace_id,
    last_health_at,last_error
  ) values(
    installation_id_value,company_id_value,workspace_id_value,pipeline_id_value,'crm.kanban',
    host_product_code_value,module_version_value,'active',coalesce(config_value,'{}'::jsonb),
    coalesce(limits_value,'{}'::jsonb),coalesce(permissions_value,'{}'::text[]),
    idempotency_key_value,trace_id_value,now(),null
  )
  on conflict(installation_id) do update
  set workspace_id=excluded.workspace_id,
      pipeline_id=excluded.pipeline_id,
      host_product_code=excluded.host_product_code,
      module_version=excluded.module_version,
      status='active',
      config=excluded.config,
      limits=excluded.limits,
      permissions=excluded.permissions,
      last_idempotency_key=excluded.last_idempotency_key,
      last_trace_id=excluded.last_trace_id,
      last_health_at=now(),
      last_error=null,
      updated_at=now();

  insert into public.crm_module_command_log(
    installation_id,operation,idempotency_key,trace_id,request_payload,status
  ) values(
    installation_id_value,'install',idempotency_key_value,trace_id_value,
    jsonb_build_object('companyId',company_id_value,'moduleVersion',module_version_value),
    'processing'
  )
  on conflict(idempotency_key) do update
  set status='processing',error=null,started_at=now(),completed_at=null;

  health_result:=public.crm_kanban_health(installation_id_value);
  if not coalesce((health_result->>'healthy')::boolean,false) then
    update public.crm_module_installations
    set status='failed',last_error='Provisioning health check failed',updated_at=now()
    where installation_id=installation_id_value;
    update public.crm_module_command_log
    set status='failed',result_payload=health_result,error='Provisioning health check failed',completed_at=now()
    where idempotency_key=idempotency_key_value;
    raise exception 'CRM Kanban health check failed';
  end if;

  update public.crm_module_command_log
  set status='succeeded',result_payload=health_result,completed_at=now()
  where idempotency_key=idempotency_key_value;

  return health_result;
end;
$$;

create or replace function public.set_crm_kanban_state(
  installation_id_value uuid,
  target_status_value text,
  idempotency_key_value text,
  trace_id_value text default null
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  installation_record public.crm_module_installations%rowtype;
  operation_value text;
  health_result jsonb;
begin
  if target_status_value not in ('active','suspended','archived') then raise exception 'Invalid target state'; end if;
  if nullif(btrim(idempotency_key_value),'') is null then raise exception 'Idempotency key is required'; end if;

  select * into installation_record
  from public.crm_module_installations
  where installation_id=installation_id_value
  for update;
  if not found then raise exception 'CRM Kanban installation not found'; end if;

  operation_value:=case target_status_value when 'active' then 'resume' when 'suspended' then 'suspend' else 'uninstall' end;

  if exists(select 1 from public.crm_module_command_log where idempotency_key=idempotency_key_value and status='succeeded') then
    return public.crm_kanban_health(installation_id_value);
  end if;

  insert into public.crm_module_command_log(installation_id,operation,idempotency_key,trace_id,request_payload,status)
  values(installation_id_value,operation_value,idempotency_key_value,trace_id_value,jsonb_build_object('targetStatus',target_status_value),'processing')
  on conflict(idempotency_key) do update set status='processing',error=null,started_at=now(),completed_at=null;

  update public.crm_module_installations
  set status=target_status_value,last_idempotency_key=idempotency_key_value,last_trace_id=trace_id_value,
      updated_at=now(),last_error=null
  where installation_id=installation_id_value;

  update public.crm_workspaces
  set status=case when target_status_value='archived' then 'archived' when target_status_value='suspended' then 'suspended' else 'active' end,
      updated_at=now()
  where id=installation_record.workspace_id;

  health_result:=public.crm_kanban_health(installation_id_value);
  update public.crm_module_command_log
  set status='succeeded',result_payload=health_result,completed_at=now()
  where idempotency_key=idempotency_key_value;
  return health_result;
end;
$$;

revoke all on function public.crm_kanban_health(uuid) from public;
revoke all on function public.provision_crm_kanban(uuid,uuid,text,text,jsonb,jsonb,text[],text,text) from public;
revoke all on function public.set_crm_kanban_state(uuid,text,text,text) from public;
grant execute on function public.crm_kanban_health(uuid) to service_role;
grant execute on function public.provision_crm_kanban(uuid,uuid,text,text,jsonb,jsonb,text[],text,text) to service_role;
grant execute on function public.set_crm_kanban_state(uuid,text,text,text) to service_role;

comment on table public.crm_module_installations is 'Local projection of IMDS Platform module installations. CRM operational records remain product-owned.';
comment on function public.provision_crm_kanban(uuid,uuid,text,text,jsonb,jsonb,text[],text,text) is 'Idempotently creates the CRM workspace, default pipeline, stages and owner membership for crm.kanban.';
