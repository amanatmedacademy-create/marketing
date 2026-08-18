-- IMDS / BELES billing control plane state.
create table if not exists public.imds_billing_plans (
  code text primary key,
  product text not null default 'marketing',
  name text not null,
  description text,
  amount numeric(14,2),
  currency text not null default 'KZT',
  interval text not null default 'month',
  limits jsonb not null default '{}'::jsonb,
  modules jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  recommended boolean not null default false,
  sort_order integer not null default 100,
  updated_at timestamptz not null default now()
);

create table if not exists public.imds_billing_addons (
  code text primary key,
  product text not null default 'marketing',
  name text not null,
  description text,
  amount numeric(14,2) not null,
  currency text not null default 'KZT',
  unit text not null default 'month',
  limit_key text not null check (limit_key in ('clinics','users','leads','openTasks','integrations')),
  increment_amount integer not null check (increment_amount > 0),
  active boolean not null default true,
  sort_order integer not null default 100,
  updated_at timestamptz not null default now()
);

create table if not exists public.imds_billing_subscriptions (
  tenant_id uuid primary key references public.crm_companies(id) on delete cascade,
  organization_id uuid references public.imds_organizations(id) on delete cascade,
  product text not null default 'marketing',
  plan_code text references public.imds_billing_plans(code),
  status text not null default 'trial' check (status in ('trial','active','past_due','grace_period','suspended','expired','cancelled')),
  currency text not null default 'KZT',
  renewal_mode text not null default 'manual' check (renewal_mode in ('manual','auto')),
  provider text,
  provider_subscription_id text,
  payment_method_label text,
  period_started_at timestamptz,
  period_ends_at timestamptz,
  grace_ends_at timestamptz,
  access_ends_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists imds_billing_subscription_provider_idx on public.imds_billing_subscriptions(provider,provider_subscription_id) where provider_subscription_id is not null;

create table if not exists public.imds_billing_orders (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.crm_companies(id) on delete cascade,
  organization_id uuid references public.imds_organizations(id) on delete cascade,
  product text not null default 'marketing',
  kind text not null check (kind in ('subscription','addon','renewal')),
  plan_code text references public.imds_billing_plans(code),
  addon_code text references public.imds_billing_addons(code),
  quantity integer not null default 1 check (quantity > 0 and quantity <= 100),
  amount numeric(14,2) not null check (amount >= 0),
  currency text not null default 'KZT',
  status text not null default 'open' check (status in ('open','paid','failed','overdue','void','refunded')),
  provider text,
  provider_order_id text,
  provider_transaction_id text,
  provider_subscription_id text,
  checkout_url text,
  payer_user_id uuid references public.marketing_users(id) on delete set null,
  payer_email text,
  card_last_four text,
  card_type text,
  metadata jsonb not null default '{}'::jsonb,
  issued_at timestamptz not null default now(),
  due_at timestamptz,
  paid_at timestamptz,
  failed_at timestamptz,
  refunded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists imds_billing_orders_tenant_idx on public.imds_billing_orders(tenant_id,issued_at desc);
create index if not exists imds_billing_orders_provider_tx_idx on public.imds_billing_orders(provider_transaction_id) where provider_transaction_id is not null;

create table if not exists public.imds_billing_addon_grants (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.crm_companies(id) on delete cascade,
  order_id uuid not null references public.imds_billing_orders(id) on delete cascade,
  addon_code text not null references public.imds_billing_addons(code),
  quantity integer not null default 1 check (quantity > 0),
  status text not null default 'active' check (status in ('active','expired','cancelled','refunded')),
  starts_at timestamptz not null default now(),
  ends_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(order_id, addon_code)
);
create index if not exists imds_billing_addon_grants_tenant_idx on public.imds_billing_addon_grants(tenant_id,status,ends_at);

alter table public.imds_billing_plans enable row level security;
alter table public.imds_billing_addons enable row level security;
alter table public.imds_billing_subscriptions enable row level security;
alter table public.imds_billing_orders enable row level security;
alter table public.imds_billing_addon_grants enable row level security;
revoke all on public.imds_billing_plans, public.imds_billing_addons, public.imds_billing_subscriptions, public.imds_billing_orders, public.imds_billing_addon_grants from anon,authenticated;
grant all on public.imds_billing_plans, public.imds_billing_addons, public.imds_billing_subscriptions, public.imds_billing_orders, public.imds_billing_addon_grants to service_role;

insert into public.imds_billing_plans(code,product,name,description,amount,currency,interval,limits,modules,active,recommended,sort_order)
values
('start','marketing','BELES Start','Для одной клиники и небольшой команды.',49900,'KZT','month','{"clinics":1,"users":5,"leads":5000,"openTasks":1000,"integrations":5}'::jsonb,'{"marketing.tasks":true,"marketing.call-center":true,"marketing.whatsapp-business":true,"marketing.meta-ads":true,"marketing.analytics":true,"marketing.automation":true,"marketing.voice-transcription":true,"marketing.crm":true}'::jsonb,true,false,10),
('pro','marketing','BELES Pro','Для растущей сети с расширенными лимитами.',99900,'KZT','month','{"clinics":3,"users":20,"leads":25000,"openTasks":5000,"integrations":15}'::jsonb,'{"marketing.tasks":true,"marketing.call-center":true,"marketing.whatsapp-business":true,"marketing.meta-ads":true,"marketing.analytics":true,"marketing.automation":true,"marketing.voice-transcription":true,"marketing.crm":true}'::jsonb,true,true,20),
('business','marketing','BELES Business','Для многоклиничной сети и больших команд.',249900,'KZT','month','{"clinics":10,"users":60,"leads":100000,"openTasks":20000,"integrations":40}'::jsonb,'{"marketing.tasks":true,"marketing.call-center":true,"marketing.whatsapp-business":true,"marketing.meta-ads":true,"marketing.analytics":true,"marketing.automation":true,"marketing.voice-transcription":true,"marketing.crm":true}'::jsonb,true,false,30)
on conflict(code) do update set product=excluded.product,name=excluded.name,description=excluded.description,amount=excluded.amount,currency=excluded.currency,interval=excluded.interval,limits=excluded.limits,modules=excluded.modules,active=excluded.active,recommended=excluded.recommended,sort_order=excluded.sort_order,updated_at=now();

insert into public.imds_billing_addons(code,product,name,description,amount,currency,unit,limit_key,increment_amount,active,sort_order)
values
('extra-user','marketing','Дополнительный пользователь','+1 активный пользователь на текущий расчётный период.',7900,'KZT','user / month','users',1,true,10),
('extra-clinic','marketing','Дополнительная клиника','+1 клиника на текущий расчётный период.',29900,'KZT','clinic / month','clinics',1,true,20),
('lead-pack-10000','marketing','Пакет 10 000 лидов','+10 000 лидов на текущий расчётный период.',14900,'KZT','10k leads / month','leads',10000,true,30),
('task-pack-5000','marketing','Пакет 5 000 задач','+5 000 открытых задач на текущий расчётный период.',9900,'KZT','5k tasks / month','openTasks',5000,true,40),
('extra-integration','marketing','Дополнительная интеграция','+1 активная интеграция на текущий расчётный период.',9900,'KZT','integration / month','integrations',1,true,50)
on conflict(code) do update set product=excluded.product,name=excluded.name,description=excluded.description,amount=excluded.amount,currency=excluded.currency,unit=excluded.unit,limit_key=excluded.limit_key,increment_amount=excluded.increment_amount,active=excluded.active,sort_order=excluded.sort_order,updated_at=now();

notify pgrst,'reload schema';
