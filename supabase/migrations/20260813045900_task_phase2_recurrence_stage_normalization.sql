create or replace function public.normalize_recurring_task_stage()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.recurrence_rule_id is not null then
    new.status := 'todo';
    new.stage_key := case new.workflow_key
      when 'call_center' then 'new'
      when 'marketing' then 'planned'
      when 'content' then 'idea'
      else 'todo'
    end;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_normalize_recurring_task_stage on public.crm_tasks;
create trigger trg_normalize_recurring_task_stage
before insert on public.crm_tasks
for each row
when (new.recurrence_rule_id is not null)
execute function public.normalize_recurring_task_stage();