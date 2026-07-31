# AMANAT MED Marketing

Маркетинговая платформа и CRM на React, TypeScript, Vite, Cloudflare Worker и Supabase.

## Что уже есть

- маркетинговый дашборд с KPI, графиками и таблицей источников;
- CRM-воронки, сделки и контакты с реальными API-данными;
- канбан с drag-and-drop;
- каталог интеграций Meta, TikTok, Bitrix24, WABA и других сервисов;
- Supabase Auth и проверка принадлежности пользователя к компании;
- Cloudflare Worker для backend API и SPA-раздачи frontend;
- адаптивная навигация для desktop и mobile.

## Локальный запуск

Требуется Bun 1.2.15 или совместимая версия.

```bash
bun install
cp .env.example .env
bun run dev
```

В `.env` необходимо заполнить:

```env
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<supabase-anon-public-key>
```

`VITE_SUPABASE_ANON_KEY` является публичным browser-ключом Supabase и используется вместе с RLS. Ключ `SUPABASE_SERVICE_ROLE_KEY` нельзя помещать в переменные `VITE_*`.

## Где взять Supabase anon key

1. Откройте нужный проект в Supabase Dashboard.
2. Перейдите в `Project Settings` → `API`.
3. Скопируйте `Project URL` в `VITE_SUPABASE_URL`.
4. Скопируйте публичный `anon` / `publishable` key в `VITE_SUPABASE_ANON_KEY`.

## Cloudflare deployment

### Frontend build variables

В настройках Cloudflare deployment добавьте переменные, доступные во время Vite-сборки:

```env
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<supabase-anon-public-key>
```

После изменения переменных обязательно запустите новый deployment: Vite встраивает `VITE_*` в frontend во время сборки.

### Worker secrets

Серверные ключи задаются отдельно через Cloudflare secrets:

```bash
wrangler secret put SUPABASE_SERVICE_ROLE_KEY
```

Дополнительные интеграции могут требовать отдельные secrets, например:

```bash
wrangler secret put META_APP_SECRET
wrangler secret put BITRIX_CLIENT_SECRET
wrangler secret put INTEGRATION_ENCRYPTION_KEY
```

Никогда не добавляйте service-role, OAuth client secret или токены интеграций в `VITE_*`, `.env.example` или Git.

## Проверка production-сборки

```bash
bun run typecheck
bun run build
bun run preview
```

`typecheck` проверяет frontend и Cloudflare Worker. `build` создаёт production bundle в каталоге `dist`.

## Основные команды

```bash
bun run dev          # frontend Vite
bun run dev:worker   # Cloudflare Worker локально
bun run typecheck    # TypeScript frontend + Worker
bun run build        # production frontend build
bun run deploy       # build + wrangler deploy
```

## Архитектура

```text
src/                 React frontend
src/rebuild/         актуальная оболочка приложения
src/services/        Supabase Auth и API-клиенты
worker/              Cloudflare Worker API
supabase/            SQL-миграции и схемы
.github/workflows/   CI-проверки
```

## Безопасность

- все tenant-запросы должны фильтроваться по компании пользователя;
- browser использует только Supabase anon key;
- service-role key используется только внутри Worker;
- RLS должен оставаться включённым для клиентских таблиц;
- секреты интеграций должны храниться зашифрованными на backend;
- реальные ключи и токены нельзя коммитить в репозиторий.
