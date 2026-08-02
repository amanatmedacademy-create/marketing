# IMDS Platform Blueprint

## 1. Цель платформы

IMDS объединяет рекламные кабинеты, коммуникации, CRM, оплаты, документы и сквозную аналитику в одной системе.

Полная бизнес-цепочка:

`реклама -> обращение -> AI/менеджер -> квалификация -> запись -> визит -> продажа -> оплата -> возврат -> LTV`

Главный принцип: любой значимый объект и результат должен быть связан с компанией, клиентом, источником и временной шкалой.

## 2. Продукты

| Продукт | Назначение | Текущий приоритет |
|---|---|---|
| IMDS CRM | Клиенты, сделки, воронки и активности | P0 |
| IMDS Conversations | WhatsApp, Instagram, Telegram, email и AI | P0 |
| IMDS Marketing | Рекламные кабинеты, кампании и креативы | P0 |
| IMDS Dashboard | Сквозная аналитика и атрибуция | P0 |
| IMDS Workspace | Задачи, проекты и команда | P1 |
| IMDS Automation | Триггеры, условия и действия | P1 |
| IMDS Payments | Счета, оплаты и возвраты | P1 |
| IMDS Contracts | Шаблоны, договоры и подписание | P2 |

## 3. Архитектурные принципы

1. Модульный монолит до появления доказанной потребности в микросервисах.
2. `company_id` во всех бизнес-таблицах.
3. RLS и серверная проверка tenant context.
4. Интеграционные токены хранятся только на сервере в зашифрованном виде.
5. Все критические операции идемпотентны.
6. Все значимые изменения порождают доменное событие.
7. Аналитика строится из событий и нормализованных фактов, а не из UI-состояния.
8. Frontend не должен считать локальный fallback полноценным источником истины.
9. Для каждого модуля обязательны loading, empty, error и permission states.
10. Planned-функции не должны имитировать успешную работу.

## 4. Доменные модули backend

### Identity & Tenant

- регистрация;
- компании;
- участники;
- роли;
- разрешения;
- сессии;
- audit log.

### CRM

- контакты;
- идентификаторы контактов;
- сделки;
- воронки;
- этапы;
- история этапов;
- активности;
- задачи;
- записи и встречи.

### Conversations

- подключения каналов;
- диалоги;
- участники;
- сообщения;
- вложения;
- статусы доставки;
- SLA;
- human takeover;
- AI sessions.

### Marketing

- рекламные платформы;
- рекламные аккаунты;
- кампании;
- группы объявлений;
- объявления;
- креативы;
- дневные метрики;
- sync jobs;
- токены и scopes.

### Analytics

- touchpoints;
- funnel events;
- attribution results;
- daily facts;
- metric definitions;
- anomaly events;
- materialized aggregates.

### Automation

- workflows;
- triggers;
- conditions;
- actions;
- scheduled actions;
- executions;
- retries;
- dead-letter queue.

### Payments

- invoices;
- payment links;
- transactions;
- refunds;
- reconciliations;
- webhooks.

### Contracts

- templates;
- documents;
- versions;
- approval steps;
- signatures;
- audit trail.

## 5. Обязательные сущности данных

### Customer 360

- `contacts`
- `contact_identities`
- `contact_consents`
- `contact_tags`
- `contact_merge_history`

### CRM

- `crm_pipelines`
- `crm_pipeline_stages`
- `crm_deals`
- `crm_deal_stage_history`
- `crm_deal_products`
- `crm_activities`
- `crm_tasks`
- `crm_appointments`

### Conversations

- `conversation_channels`
- `conversation_connections`
- `conversations`
- `conversation_participants`
- `messages`
- `message_attachments`
- `message_delivery_events`
- `ai_sessions`
- `ai_handovers`

### Marketing

- `marketing_ad_accounts`
- `marketing_campaigns`
- `marketing_ad_sets`
- `marketing_ads`
- `marketing_creatives`
- `marketing_daily_metrics`
- `marketing_sync_jobs`
- `marketing_touchpoints`

### Analytics

- `analytics_funnel_events`
- `analytics_attribution_results`
- `analytics_daily_facts`
- `analytics_anomalies`
- `analytics_metric_definitions`

### Commercial

- `payments_invoices`
- `payments_transactions`
- `payments_refunds`
- `contracts_templates`
- `contracts_documents`
- `contracts_signatures`

### Platform

- `platform_events`
- `integration_connections`
- `integration_credentials`
- `integration_sync_jobs`
- `automation_workflows`
- `automation_runs`
- `audit_logs`

## 6. P0 пользовательские сценарии

### CRM

1. Пользователь создаёт лид.
2. Лид немедленно появляется в выбранной воронке.
3. Пользователь открывает карточку.
4. Изменения сохраняются и видны после перезагрузки.
5. Перемещение между этапами записывается в историю.
6. При ошибке интерфейс показывает точную причину и не имитирует успех.

### Conversations

1. Новое сообщение создаёт или находит контакт.
2. Создаётся диалог.
3. При необходимости создаётся сделка.
4. Менеджер отвечает из единого inbox.
5. Сообщение получает статусы queued/sent/delivered/read/failed.
6. AI автоматически останавливается при ручном ответе менеджера.

### Marketing

1. Пользователь подключает рекламный аккаунт через OAuth.
2. Backend сохраняет зашифрованный токен.
3. Синхронизация загружает структуру и дневные метрики.
4. UI показывает время последней успешной синхронизации.
5. Ошибки токена и scopes отображаются отдельно.

### Dashboard

1. Расходы берутся из нормализованных рекламных метрик.
2. Лиды, записи, продажи, оплаты и возвраты берутся из событий CRM.
3. Отчёт строится за одинаковые периоды сравнения.
4. Пользователь может провалиться от канала до конкретной сделки.
5. Метрики имеют единые формулы и версионирование.

## 7. API-контракты P0

### CRM

- `GET /api/pipelines`
- `POST /api/pipelines`
- `GET /api/deals`
- `POST /api/deals`
- `GET /api/deals/:id`
- `PATCH /api/deals/:id`
- `PATCH /api/deals/:id/move`
- `GET /api/deals/:id/history`

### Conversations

- `GET /api/conversations`
- `GET /api/conversations/:id`
- `POST /api/conversations/:id/messages`
- `POST /api/conversations/:id/takeover`
- `POST /api/conversations/:id/release-ai`
- `GET /api/channels/connections`

### Marketing

- `GET /api/integrations/marketing`
- `POST /api/integrations/meta/start`
- `GET /api/integrations/meta/callback`
- `POST /api/integrations/:id/sync`
- `GET /api/marketing/accounts`
- `GET /api/marketing/campaigns`
- `GET /api/marketing/metrics`

### Analytics

- `GET /api/analytics/overview`
- `GET /api/analytics/funnel`
- `GET /api/analytics/campaigns`
- `GET /api/analytics/creatives`
- `GET /api/analytics/managers`
- `GET /api/analytics/customer-journey/:contactId`

## 8. Метрики и формулы

- `CPL = spend / leads`
- `CPQL = spend / qualified_leads`
- `CPA = spend / appointments`
- `CPV = spend / visits`
- `CAC = spend / sales`
- `ROAS = attributed_revenue / spend`
- `ROMI = (attributed_gross_profit - spend) / spend`
- `Show Rate = visits / appointments`
- `Lead to Sale = sales / leads`
- `Average Check = paid_revenue / sales`
- `Net Revenue = paid_revenue - refunds`

Все деления должны возвращать `null`, а не бесконечность, если знаменатель равен нулю.

## 9. Атрибуция

Первая версия:

- First Touch;
- Last Touch;
- Last Non-Direct.

Следующая версия:

- Linear;
- Position Based;
- Time Decay;
- Custom Business Attribution.

Каждый attribution result хранит:

- модель;
- версию модели;
- touchpoint;
- сделку;
- платёж;
- долю выручки;
- дату расчёта.

## 10. AI guardrails

AI может без подтверждения:

- читать разрешённые данные клиента;
- отвечать по опубликованной базе знаний;
- квалифицировать;
- создавать задачу;
- предлагать свободное время;
- формировать черновик сообщения.

AI требует подтверждения для:

- отправки массовой рассылки;
- изменения рекламного бюджета;
- создания возврата;
- удаления данных;
- изменения юридического документа;
- отправки нестандартной скидки;
- закрытия сделки как оплаченной без webhook оплаты.

## 11. Definition of Done

Модуль считается готовым, только если:

1. Есть backend contract.
2. Есть tenant isolation.
3. Есть роли и permissions.
4. Есть loading, empty, error и retry states.
5. Есть audit event.
6. Есть обработка повторных запросов.
7. Есть smoke-test основного сценария.
8. Сборка frontend и typecheck Worker проходят.
9. Нет фиктивного статуса «подключено».
10. Данные сохраняются после перезагрузки.

## 12. Порядок реализации

### Phase 1 — стабилизация ядра

- закончить CRM create/read/update/move;
- убрать расхождение Worker и прямого Supabase-доступа;
- внедрить единый API error format;
- добавить event outbox;
- добавить stage history;
- добавить smoke-tests.

### Phase 2 — Conversations

- channel connections;
- conversation schema;
- inbox;
- message delivery statuses;
- human takeover;
- AI session state.

### Phase 3 — Marketing ingestion

- Meta OAuth;
- account discovery;
- campaign structure sync;
- daily metrics;
- token lifecycle;
- sync monitoring.

### Phase 4 — End-to-end analytics

- funnel events;
- attribution;
- overview dashboard;
- drill-down;
- anomalies;
- period comparison.

### Phase 5 — Commercial operations

- payments;
- Kaspi webhooks;
- contracts;
- automation builder;
- customer LTV.
