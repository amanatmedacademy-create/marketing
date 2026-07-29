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

Скопировать Google Client ID и Client Secret.

## 3. Supabase

Открыть:

```text
Authentication → Providers → Google
```

Включить Google provider и вставить Client ID / Client Secret.

Открыть:

```text
Authentication → URL Configuration
```

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

Добавить публичный Supabase anon key как secret:

```bash
wrangler secret put SUPABASE_ANON_KEY
```

Значение находится в Supabase Dashboard → Project Settings → API → anon/public key.

Не использовать `service_role` key на frontend.

Опциональные переменные:

```text
AUTH_AUTO_APPROVE=true
AUTH_ALLOWED_EMAIL_DOMAINS=amanatmed.kz,amanat-med-academy.kz
```

- `AUTH_AUTO_APPROVE=true` — новые Google-пользователи получают активный доступ автоматически.
- `AUTH_AUTO_APPROVE=false` — первый пользователь становится администратором, остальные ожидают подтверждения.
- `AUTH_ALLOWED_EMAIL_DOMAINS` — разрешает вход только указанным доменам. Пустое значение разрешает любые Google-аккаунты.

## 5. Поведение системы

- одна кнопка используется и для регистрации, и для входа;
- при первом Google-входе создаётся запись в `marketing_users`;
- первый зарегистрированный пользователь получает роль `administrator`;
- последующие пользователи получают роль `viewer`;
- заблокированные и неподтверждённые пользователи не получают доступ к API;
- Cloudflare проверяет Supabase access token на каждом закрытом API-запросе;
- аналитические данные не выдаются без действительной сессии.
