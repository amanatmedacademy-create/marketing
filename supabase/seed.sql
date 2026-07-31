do $$
declare
  v_company_id uuid;
  v_pipeline_id uuid;
  v_stage_new uuid;
  v_stage_work uuid;
  v_stage_consult uuid;
  v_stage_paid uuid;
  v_stage_lost uuid;
  v_project_id uuid;
  v_cash_id uuid;
  v_kaspi_id uuid;
begin
  insert into public.companies (name, slug, timezone, locale, currency)
  values ('Satu CRM Demo', 'demo-company', 'Asia/Almaty', 'ru', 'KZT')
  on conflict (slug) do update set name = excluded.name
  returning id into v_company_id;

  select id into v_company_id from public.companies where slug = 'demo-company';

  select id into v_pipeline_id
  from public.pipelines
  where company_id = v_company_id and is_default = true
  limit 1;

  if v_pipeline_id is null then
    insert into public.pipelines (company_id, name, is_default)
    values (v_company_id, 'Лечение позвоночника', true)
    returning id into v_pipeline_id;
  end if;

  insert into public.pipeline_stages (company_id, pipeline_id, name, position, color)
  values
    (v_company_id, v_pipeline_id, 'Новый лид', 0, '#4F6EF7'),
    (v_company_id, v_pipeline_id, 'В работе', 1, '#F0A63B'),
    (v_company_id, v_pipeline_id, 'Консультация назначена', 2, '#8B5CF6'),
    (v_company_id, v_pipeline_id, 'Оплата', 3, '#16A34A'),
    (v_company_id, v_pipeline_id, 'Отказ', 4, '#94A3B8')
  on conflict do nothing;

  select id into v_stage_new from public.pipeline_stages where pipeline_id = v_pipeline_id and name = 'Новый лид' limit 1;
  select id into v_stage_work from public.pipeline_stages where pipeline_id = v_pipeline_id and name = 'В работе' limit 1;
  select id into v_stage_consult from public.pipeline_stages where pipeline_id = v_pipeline_id and name = 'Консультация назначена' limit 1;
  select id into v_stage_paid from public.pipeline_stages where pipeline_id = v_pipeline_id and name = 'Оплата' limit 1;
  select id into v_stage_lost from public.pipeline_stages where pipeline_id = v_pipeline_id and name = 'Отказ' limit 1;

  if not exists (select 1 from public.deals where company_id = v_company_id) then
    insert into public.deals (company_id, pipeline_id, stage_id, title, contact_name, amount, source, status)
    values
      (v_company_id, v_pipeline_id, v_stage_new, 'Айгерим К. — боль в пояснице', 'Айгерим К.', 0, 'WhatsApp', 'open'),
      (v_company_id, v_pipeline_id, v_stage_new, 'Марат С. — подозрение на грыжу', 'Марат С.', 0, 'Instagram', 'open'),
      (v_company_id, v_pipeline_id, v_stage_work, 'Светлана Р. — консультация вертебролога', 'Светлана Р.', 25000, 'Звонок', 'open'),
      (v_company_id, v_pipeline_id, v_stage_work, 'Данияр Т. — интерпретация МРТ', 'Данияр Т.', 15000, 'Сайт', 'open'),
      (v_company_id, v_pipeline_id, v_stage_consult, 'Ольга В. — приём 3 августа, 15:00', 'Ольга В.', 18000, 'Телефон', 'open'),
      (v_company_id, v_pipeline_id, v_stage_paid, 'Бекзат Н. — курс лечения', 'Бекзат Н.', 420000, 'Kaspi', 'won'),
      (v_company_id, v_pipeline_id, v_stage_paid, 'Гульмира А. — абонемент 10 сеансов', 'Гульмира А.', 180000, 'Kaspi', 'won'),
      (v_company_id, v_pipeline_id, v_stage_work, 'Нурлан Ж. — боль в колене', 'Нурлан Ж.', 0, 'WhatsApp', 'open'),
      (v_company_id, v_pipeline_id, v_stage_lost, 'Тимур Б. — не подошла цена', 'Тимур Б.', 0, 'Звонок', 'lost');
  end if;

  if not exists (select 1 from public.tasks where company_id = v_company_id) then
    insert into public.tasks (company_id, title, status, priority, due_at)
    values
      (v_company_id, 'Перезвонить Марату С. — уточнить дату МРТ', 'todo', 'urgent', now() - interval '1 day'),
      (v_company_id, 'Отправить смету Бекзату Н.', 'todo', 'high', now() - interval '2 hours'),
      (v_company_id, 'Консультация — Ольга В., 15:00', 'todo', 'medium', date_trunc('day', now()) + interval '15 hours'),
      (v_company_id, 'Согласовать абонемент с Гульмирой А.', 'todo', 'medium', date_trunc('day', now()) + interval '17 hours'),
      (v_company_id, 'Загрузить результаты МРТ Данияра Т.', 'done', 'high', date_trunc('day', now()) + interval '12 hours'),
      (v_company_id, 'Повторный звонок — Айгерим К.', 'todo', 'medium', date_trunc('day', now()) + interval '1 day 10 hours');
  end if;

  select id into v_project_id from public.projects where company_id = v_company_id and name = 'Запуск нового направления' limit 1;
  if v_project_id is null then
    insert into public.projects (company_id, name, description)
    values (v_company_id, 'Запуск нового направления', 'Запуск направления реабилитации')
    returning id into v_project_id;
  end if;

  if not exists (select 1 from public.project_items where project_id = v_project_id) then
    insert into public.project_items (company_id, project_id, title, status, position)
    values
      (v_company_id, v_project_id, 'Согласовать прайс на курс реабилитации', 'todo', 0),
      (v_company_id, v_project_id, 'Снять видео-отзывы пациентов', 'todo', 1),
      (v_company_id, v_project_id, 'Настроить лендинг под направление', 'in_progress', 0),
      (v_company_id, v_project_id, 'Обучить менеджеров скрипту', 'in_progress', 1),
      (v_company_id, v_project_id, 'Утвердить бюджет на запуск', 'done', 0);
  end if;

  select id into v_cash_id from public.finance_accounts where company_id = v_company_id and name = 'Касса' limit 1;
  if v_cash_id is null then
    insert into public.finance_accounts (company_id, name, account_type) values (v_company_id, 'Касса', 'cash') returning id into v_cash_id;
  end if;

  select id into v_kaspi_id from public.finance_accounts where company_id = v_company_id and name = 'Kaspi' limit 1;
  if v_kaspi_id is null then
    insert into public.finance_accounts (company_id, name, account_type) values (v_company_id, 'Kaspi', 'bank') returning id into v_kaspi_id;
  end if;

  if not exists (select 1 from public.finance_transactions where company_id = v_company_id) then
    insert into public.finance_transactions (company_id, account_id, type, amount, description, occurred_at)
    values
      (v_company_id, v_cash_id, 'income', 420000, 'Оплата — курс лечения, Бекзат Н.', now()),
      (v_company_id, v_kaspi_id, 'income', 180000, 'Оплата — абонемент, Гульмира А.', now() - interval '1 day'),
      (v_company_id, v_kaspi_id, 'expense', 150000, 'Аренда кабинета вертебролога', now() - interval '1 day'),
      (v_company_id, v_cash_id, 'expense', 48000, 'Закупка расходников', now() - interval '2 days');
  end if;
end $$;
