alter table public.crm_tasks
  add column if not exists automation_key text,
  add column if not exists automation_event_key text;

create unique index if not exists crm_tasks_automation_dedupe_idx
  on public.crm_tasks(company_id, automation_key, automation_event_key)
  where automation_key is not null and automation_event_key is not null;
