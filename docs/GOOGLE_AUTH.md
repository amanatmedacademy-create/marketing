# Google OAuth для AMANAT MED Marketing

## 1. Выполнить миграцию

```text
supabase/migrations/202607290008_google_auth.sql
```

## 2. Google Cloud Console

Создать OAuth 2.0 Client ID типа **Web application**.

Authorized JavaScript origins:

```text
https://marketing.amanat-med-academy.workers.dev
```

Authorized redirect URI берётся из Supabase Dashboard → Authentication → Providers → Google. Обычно имеет вид:

```text
https://kysdtmgijkffwtzugonv.supabase.co/auth/v1/callback
```

## 3. Supabase

Включить Google provider и указать Client ID / Client Secret.

Site URL:

```text
https://marketing.amanat-med-academy.workers.dev
```

Redirect URLs:

```text
https://marketing.amanat-med-academy.workers.dev/**
http://localhost:5173/**
```

## 4. Cloudflare Worker

Добавить публичный Supabase anon key:

```bash
wrangler secret put SUPABASE_ANON_KEY
```

Обязательные production-переменные:

```text
AUTH_ALLOWED_EMAIL_DOMAINS=amanatmed.kz,amanat-med-academy.kz
AUTH_ADMIN_EMAILS=admin@amanatmed.kz
AUTH_AUTO_APPROVE=false
```

Правила:

- пустой `AUTH_ALLOWED_EMAIL_DOMAINS` блокирует Google-вход;
- администратор назначается только при точном совпадении email с `AUTH_ADMIN_EMAILS`;
- новый пользователь без admin allowlist получает роль `viewer`;
- при `AUTH_AUTO_APPROVE=false` новый пользователь получает статус `invited` и ожидает подтверждения;
- `AUTH_AUTO_APPROVE=true` следует использовать только при контролируемом корпоративном домене;
- `service_role` key запрещено передавать во frontend.

## 5. Матрица доступа

| Роль | Просмотр аналитики | Изменение лидов | Удаление лидов | Настройки интеграций |
|---|---:|---:|---:|---:|
| viewer | да | нет | нет | нет |
| analyst | да | нет | нет | нет |
| marketer | да | да | да | нет |
| administrator | да | да | да | да |

## 6. Проверка после деплоя

1. Открыть `/api/auth/config` и проверить:
   - `googleEnabled: true`;
   - `publicKeyConfigured: true`;
   - `allowedDomainsConfigured: true`;
   - `adminEmailsConfigured: true`.
2. Проверить, что внешний Google-аккаунт получает отказ.
3. Проверить, что новый корпоративный пользователь создаётся как `viewer` и `invited`.
4. Проверить, что `viewer` получает HTTP 403 на `POST`, `PATCH`, `DELETE /api/leads`.
5. Проверить, что только administrator открывает настройки интеграций.
