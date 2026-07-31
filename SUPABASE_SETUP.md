# Supabase setup

Применяйте SQL-файлы строго в указанном порядке через Supabase Dashboard → SQL Editor.

## 1. Базовая CRM-схема

Запустите:

```text
supabase/schema/001_core.sql
```

Создаются компании, сотрудники, воронки, стадии, сделки и задачи.

## 2. Дополнительные модули

Запустите:

```text
supabase/schema/002_modules.sql
```

Создаются профили, проекты, проектные карточки, финансовые счета и операции.

## 3. Ограничения целостности

Запустите:

```text
supabase/schema/003_integrity.sql
```

Добавляются уникальные индексы, необходимые для безопасного повторного запуска seed.

## 4. Демо-данные

Запустите:

```text
supabase/seed.sql
```

Seed можно запускать повторно. Он создаёт компанию `demo-company`, воронку, сделки, задачи, проект и финансовые операции только при их отсутствии.

## 5. Получите идентификатор компании

В SQL Editor выполните:

```sql
select id, name, slug
from public.companies
where slug = 'demo-company';
```

Скопируйте значение `id`.

## 6. Cloudflare Worker variables

В Cloudflare Dashboard → Workers & Pages → imds-crm → Settings → Variables добавьте:

```text
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
DEFAULT_COMPANY_ID=<UUID из шага 5>
APP_ENV=production
```

Как secret добавьте:

```text
SUPABASE_SERVICE_ROLE_KEY=<service_role key из Supabase>
```

`SUPABASE_SERVICE_ROLE_KEY` нельзя добавлять в frontend, Vite env или репозиторий.

## 7. Проверка

После нового deploy проверьте:

```text
/health
/api/config
/api/dashboard
/api/pipelines
/api/deals
/api/tasks
/api/team
/api/projects
/api/accounting
```

`/health` должен вернуть `status: ok`. API-маршруты должны возвращать JSON без ошибки `Supabase environment is not configured`.
