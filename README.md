# AMANAT MED Marketing

Полноценный frontend-проект маркетинговой платформы на React, TypeScript и Vite.

## Что уже есть

- маркетинговый дашборд с KPI, графиками и таблицей источников;
- собственный раздел лидов: канбан и таблица;
- таблица рекламных объявлений с CRM-конверсиями;
- модуль конверсий и тепловая карта;
- модуль анализа креативов;
- каталог интеграций Bitrix24, Wazzup, Binotel, Sipuni, Meta, TikTok и n8n;
- адаптивная навигация для desktop и mobile;
- отдельный маршрут с оригинальным `dashboard_v36.html` для сверки;
- заготовка клиента Supabase через переменные окружения.

## Запуск

```bash
npm install
cp .env.example .env
npm run dev
```

## Проверка production-сборки

```bash
npm run typecheck
npm run build
npm run preview
```

## Структура

```text
src/
├── components/
│   ├── layout/
│   └── ui/
├── data/
├── lib/
├── pages/
├── services/
├── types/
├── App.tsx
├── main.tsx
└── styles.css
```

## Следующие этапы

1. Подключить рабочую БД и авторизацию Supabase.
2. Перенести реальные формулы и данные из v36 в типизированные сервисы.
3. Реализовать API лидов и журнал событий.
4. Подключить Wazzup, Binotel и Sipuni через backend integration layer.
5. Подключить Meta API, затем TikTok API.
6. Добавить очередь webhook, повторную обработку и журнал ошибок.

## Безопасность

Секретные токены нельзя хранить в Vite-переменных `VITE_*`, поскольку они попадают в браузерную сборку. В frontend допустим только Supabase anon key. Токены Meta, Wazzup, телефонии и CRM должны храниться на сервере или в Supabase Edge Functions.
