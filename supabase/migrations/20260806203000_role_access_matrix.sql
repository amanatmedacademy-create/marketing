-- Position-based and per-user access control for IMDS Marketing.

insert into public.platform_modules (id, name, description, category, route, navigation_label, navigation_order, status, metadata)
values
  ('dashboard', 'Dashboard Marketing', 'Главная аналитическая панель маркетинга.', 'analytics', '/', 'Dashboard Marketing', 10, 'active', '{"access_actions":["view","export"]}'::jsonb),
  ('communications.chat', 'Чат', 'Омниканальные диалоги и исходящие сообщения.', 'communications', '/chat', 'Чат', 20, 'active', '{"access_actions":["view","create","edit"]}'::jsonb),
  ('crm.leads', 'Лиды', 'Реестр лидов и данные клиентов.', 'crm', '/leads', 'Лиды', 30, 'active', '{"access_actions":["view","create","edit","delete","export"]}'::jsonb),
  ('communications.calls', 'Звонки', 'История звонков, записи и задачи на звонок.', 'communications', '/calls', 'Звонки', 40, 'active', '{"access_actions":["view","create","edit","export"]}'::jsonb),
  ('crm.pipeline', 'Воронка продаж', 'Воронки, стадии, сделки и карточка сделки.', 'crm', '/pipeline', 'Воронка продаж', 50, 'active', '{"access_actions":["view","create","edit","delete","export","manage"]}'::jsonb),
  ('advertising', 'Реклама', 'Рекламные кабинеты, кампании и показатели.', 'marketing', '/advertising', 'Реклама', 60, 'active', '{"access_actions":["view","create","edit","delete","export","manage"]}'::jsonb),
  ('analytics.attribution', 'UTM и атрибуция', 'Источники, UTM и сквозная атрибуция.', 'analytics', '/attribution', 'UTM и атрибуция', 70, 'active', '{"access_actions":["view","edit","export"]}'::jsonb),
  ('analytics.reports', 'Аналитика', 'Отчёты, показатели и аналитические срезы.', 'analytics', '/analytics', 'Аналитика', 80, 'active', '{"access_actions":["view","export"]}'::jsonb),
  ('integrations', 'Интеграции', 'Подключение и настройка внешних систем.', 'platform', '/integrations', 'Интеграции', 90, 'active', '{"access_actions":["view","create","edit","delete","manage"]}'::jsonb),
  ('audit', 'Аудит и ошибки', 'Журнал действий, синхронизаций и ошибок.', 'platform', '/audit', 'Аудит и ошибки', 100, 'active', '{"access_actions":["view","export","manage"]}'::jsonb),
  ('platform.architecture', 'Архитектура', 'Описание модулей и архитектуры платформы.', 'platform', '/architecture', 'Архитектура', 110, 'active', '{"access_actions":["view"]}'::jsonb),
  ('team', 'Пользователи и доступы', 'Пользователи, должности и матрица прав.', 'platform', null, 'Пользователи и доступы', 120, 'active', '{"access_actions":["view","create","edit","delete","manage"]}'::jsonb)
on conflict (id) do update set
  name = excluded.name,
  description = excluded.description,
  category = excluded.category,
  route = excluded.route,
  navigation_label = excluded.navigation_label,
  navigation_order = excluded.navigation_order,
  status = excluded.status,
  metadata = public.platform_modules.metadata || excluded.metadata,
  updated_at = now();

create table if not exists public.crm_access_positions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.crm_companies(id) on delete cascade,
  name text not null,
  description text,
  system_key text,
  is_system boolean not null default false,
  created_by uuid references public.marketing_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, company_id)
);

create unique index if not exists crm_access_positions_company_name_uidx
  on public.crm_access_positions (company_id, lower(name));
create unique index if not exists crm_access_positions_company_system_uidx
  on public.crm_access_positions (company_id, system_key)
  where system_key is not null;
create index if not exists crm_access_positions_company_idx
  on public.crm_access_positions (company_id, name);

create table if not exists public.crm_access_position_permissions (
  position_id uuid not null,
  company_id uuid not null,
  module_id text not null references public.platform_modules(id) on delete cascade,
  can_view boolean not null default false,
  can_create boolean not null default false,
  can_edit boolean not null default false,
  can_delete boolean not null default false,
  can_export boolean not null default false,
  can_manage boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (position_id, module_id),
  foreign key (position_id, company_id)
    references public.crm_access_positions(id, company_id) on delete cascade
);

create index if not exists crm_access_position_permissions_company_idx
  on public.crm_access_position_permissions (company_id, module_id);

create table if not exists public.crm_access_user_assignments (
  company_id uuid not null references public.crm_companies(id) on delete cascade,
  user_id uuid not null references public.marketing_users(id) on delete cascade,
  position_id uuid,
  job_title text,
  updated_by uuid references public.marketing_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (company_id, user_id),
  foreign key (position_id, company_id)
    references public.crm_access_positions(id, company_id) on delete set null
);

create index if not exists crm_access_user_assignments_position_idx
  on public.crm_access_user_assignments (company_id, position_id);

create table if not exists public.crm_access_user_overrides (
  company_id uuid not null references public.crm_companies(id) on delete cascade,
  user_id uuid not null references public.marketing_users(id) on delete cascade,
  module_id text not null references public.platform_modules(id) on delete cascade,
  can_view boolean,
  can_create boolean,
  can_edit boolean,
  can_delete boolean,
  can_export boolean,
  can_manage boolean,
  updated_by uuid references public.marketing_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (company_id, user_id, module_id),
  check (
    can_view is not null or can_create is not null or can_edit is not null
    or can_delete is not null or can_export is not null or can_manage is not null
  )
);

create index if not exists crm_access_user_overrides_user_idx
  on public.crm_access_user_overrides (company_id, user_id);

alter table public.crm_access_positions enable row level security;
alter table public.crm_access_position_permissions enable row level security;
alter table public.crm_access_user_assignments enable row level security;
alter table public.crm_access_user_overrides enable row level security;

revoke all on public.crm_access_positions from anon, authenticated;
revoke all on public.crm_access_position_permissions from anon, authenticated;
revoke all on public.crm_access_user_assignments from anon, authenticated;
revoke all on public.crm_access_user_overrides from anon, authenticated;

grant all on public.crm_access_positions to service_role;
grant all on public.crm_access_position_permissions to service_role;
grant all on public.crm_access_user_assignments to service_role;
grant all on public.crm_access_user_overrides to service_role;

create or replace function private.ensure_default_access_positions(
  p_company_id uuid,
  p_created_by uuid default null
)
returns void
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
begin
  insert into public.crm_access_positions (company_id, name, description, system_key, is_system, created_by)
  values
    (p_company_id, 'Администратор системы', 'Полный доступ ко всем модулям и настройкам.', 'system_admin', true, p_created_by),
    (p_company_id, 'Маркетолог', 'Маркетинг, реклама, лиды, коммуникации и аналитика.', 'marketing_manager', true, p_created_by),
    (p_company_id, 'Аналитик', 'Просмотр и экспорт аналитики без изменения рабочих данных.', 'analyst', true, p_created_by),
    (p_company_id, 'Наблюдатель', 'Ограниченный доступ только для просмотра.', 'observer', true, p_created_by)
  on conflict (company_id, system_key) where system_key is not null do update set
    name = excluded.name,
    description = excluded.description,
    is_system = true,
    updated_at = now();

  insert into public.crm_access_position_permissions (
    position_id, company_id, module_id,
    can_view, can_create, can_edit, can_delete, can_export, can_manage
  )
  select
    p.id,
    p.company_id,
    m.id,
    case
      when p.system_key = 'system_admin' then true
      when p.system_key = 'marketing_manager' then m.id in (
        'dashboard','communications.chat','crm.leads','communications.calls','crm.pipeline',
        'advertising','analytics.attribution','analytics.reports','integrations','platform.architecture'
      )
      when p.system_key = 'analyst' then m.id in (
        'dashboard','crm.leads','advertising','analytics.attribution','analytics.reports'
      )
      when p.system_key = 'observer' then m.id in (
        'dashboard','advertising','analytics.attribution','analytics.reports'
      )
      else false
    end,
    case
      when p.system_key = 'system_admin' then true
      when p.system_key = 'marketing_manager' then m.id in (
        'communications.chat','crm.leads','communications.calls','crm.pipeline','advertising'
      )
      else false
    end,
    case
      when p.system_key = 'system_admin' then true
      when p.system_key = 'marketing_manager' then m.id in (
        'communications.chat','crm.leads','communications.calls','crm.pipeline','advertising','analytics.attribution'
      )
      else false
    end,
    case when p.system_key = 'system_admin' then true else false end,
    case
      when p.system_key = 'system_admin' then true
      when p.system_key in ('marketing_manager','analyst') then m.id in (
        'dashboard','crm.leads','communications.calls','crm.pipeline','advertising','analytics.attribution','analytics.reports'
      )
      else false
    end,
    case when p.system_key = 'system_admin' then true else false end
  from public.crm_access_positions p
  join public.platform_modules m on m.status = 'active'
  where p.company_id = p_company_id
    and p.system_key in ('system_admin','marketing_manager','analyst','observer')
  on conflict (position_id, module_id) do update set
    can_view = excluded.can_view,
    can_create = excluded.can_create,
    can_edit = excluded.can_edit,
    can_delete = excluded.can_delete,
    can_export = excluded.can_export,
    can_manage = excluded.can_manage,
    updated_at = now();
end;
$$;

create or replace function private.assign_default_access_position()
returns trigger
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_system_key text;
  v_position_id uuid;
  v_title text;
  v_user_role text;
begin
  perform private.ensure_default_access_positions(new.company_id, new.user_id);

  select role into v_user_role
  from public.marketing_users
  where id = new.user_id;

  v_system_key := case
    when new.role in ('owner','administrator') or v_user_role = 'administrator' then 'system_admin'
    when v_user_role = 'marketer' then 'marketing_manager'
    when v_user_role = 'analyst' then 'analyst'
    else 'observer'
  end;

  select id, name into v_position_id, v_title
  from public.crm_access_positions
  where company_id = new.company_id and system_key = v_system_key
  limit 1;

  insert into public.crm_access_user_assignments (
    company_id, user_id, position_id, job_title, updated_by
  ) values (
    new.company_id, new.user_id, v_position_id, v_title, new.user_id
  )
  on conflict (company_id, user_id) do nothing;

  return new;
end;
$$;

drop trigger if exists crm_company_members_assign_access_position on public.crm_company_members;
create trigger crm_company_members_assign_access_position
after insert on public.crm_company_members
for each row execute function private.assign_default_access_position();

do $$
declare
  company_row record;
begin
  for company_row in
    select distinct company_id from public.crm_company_members
  loop
    perform private.ensure_default_access_positions(company_row.company_id, null);
  end loop;
end $$;

insert into public.crm_access_user_assignments (
  company_id, user_id, position_id, job_title, updated_by
)
select
  cm.company_id,
  cm.user_id,
  p.id,
  p.name,
  cm.user_id
from public.crm_company_members cm
join public.marketing_users mu on mu.id = cm.user_id
join public.crm_access_positions p
  on p.company_id = cm.company_id
 and p.system_key = case
   when cm.role in ('owner','administrator') or mu.role = 'administrator' then 'system_admin'
   when mu.role = 'marketer' then 'marketing_manager'
   when mu.role = 'analyst' then 'analyst'
   else 'observer'
 end
on conflict (company_id, user_id) do nothing;

notify pgrst, 'reload schema';
