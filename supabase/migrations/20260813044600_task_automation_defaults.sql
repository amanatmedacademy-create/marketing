insert into public.crm_task_automation_rules (company_id, key, name, description, enabled, config)
select c.id, v.key, v.name, v.description, false, v.config
from public.crm_companies c
cross join (values
  ('new_lead_followup','Новый лид без ответа','Через 15 минут создаёт срочную задачу колл-центру, если по новому лиду ещё нет первого ответа.','{"afterMinutes":15}'::jsonb),
  ('missed_call','Пропущенный звонок','Создаёт задачу перезвонить по входящему звонку без ответа.','{"afterMinutes":2}'::jsonb),
  ('whatsapp_unanswered','WhatsApp без ответа','Если в WhatsApp остаются непрочитанные сообщения дольше 10 минут, создаёт задачу на ответ.','{"afterMinutes":10}'::jsonb),
  ('appointment_confirmation','Подтверждение записи','За сутки до записи создаёт задачу подтвердить визит пациента.','{"beforeHours":24}'::jsonb)
) as v(key,name,description,config)
on conflict (company_id,key) do nothing;
