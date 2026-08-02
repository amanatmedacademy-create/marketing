# IMDS Marketing — functional hardening plan

## Цель

Каждая видимая кнопка должна выполнять завершённый сценарий: открывать экран или модальное окно, валидировать ввод, отправлять запрос, показывать progress/success/error и обновлять данные без перезагрузки.

## Общие требования ко всем модулям

- loading, empty, success и error states;
- блокировка повторной отправки;
- понятный текст ошибки от API;
- optimistic update только с rollback;
- tenant isolation по `company_id`;
- журналирование критичных операций;
- единый toast/notification layer;
- подтверждение удаления и необратимых действий;
- экспорт CSV/XLSX только из текущего фильтрованного набора;
- сохранение фильтров и наборов колонок;
- responsive desktop/tablet/mobile;
- никакой фиктивной статистики.

## CRM / сделки

### Данные

- pipeline, stage, deal;
- contact: first_name, last_name, phone, email;
- source, utm_source, utm_medium, utm_campaign, utm_content, utm_term;
- amount, currency;
- assignee_id;
- tags;
- created_at, updated_at, won_at, lost_at;
- appointment_at, visit_at;
- loss_reason;
- notes and activity timeline.

### Сценарии

- создать, изменить, переместить и удалить сделку;
- быстрый лид и полная форма;
- поиск и фильтр;
- управление воронками и этапами;
- открытие карточки сделки;
- назначение менеджера;
- история изменений;
- телефон/email/WhatsApp actions.

## Рекламные кабинеты

### Данные интеграции

- provider, account_id, account_name, currency, timezone;
- campaign_id/name/status/objective;
- adset_id/name/status/budget/bid_strategy;
- ad_id/name/status/creative_id;
- date_start/date_stop;
- spend, reach, impressions, frequency, CPM;
- clicks, link_clicks, CTR, CPC;
- landing_page_views;
- results, result_type, cost_per_result;
- conversations, replies, cost_per_conversation;
- profile_visits, followers, comments, shares, saves;
- video_3s, average_watch_time, video_25/50/75/95;
- attribution window and sync timestamp.

### Сценарии

- переключение account/campaign/adset/ad/creative;
- период и сравнение периодов;
- фильтры и наборы колонок;
- сортировка, pagination и drill-down;
- export;
- ручная синхронизация и status sync;
- создание кампании только после подключения provider API;
- понятное disabled state с причиной.

## Сквозная аналитика

### Связка

`provider_account -> campaign -> adset -> ad -> lead -> deal -> appointment -> visit -> sale -> payment/refund`

### Ключи атрибуции

- external lead id;
- click ids: fbclid, gclid, ttclid;
- UTM;
- phone/email normalization;
- first touch, last touch, linear and position-based models;
- attribution timestamp and confidence.

### Метрики

- spend, impressions, clicks;
- CRM leads, qualified leads;
- appointments, visits;
- sales, refunds;
- revenue and net revenue;
- CPL, CPQL, CPA appointment, CPA visit, CAC;
- ROAS, ROMI;
- conversion rates for every funnel step.

## WhatsApp / Instagram / Email

### Данные

- channel connection;
- conversation/thread;
- participant/contact/deal link;
- inbound/outbound message;
- status sent/delivered/read/failed;
- attachments;
- templates;
- assigned operator;
- unread count and last activity.

### Сценарии

- list and search conversations;
- open thread;
- send text and attachment;
- retry failed messages;
- assign operator;
- create/link deal;
- templates and quick replies;
- read status and realtime updates.

## Интеграции

### Данные

- provider;
- connection status;
- account/workspace identifiers;
- scopes;
- token expiry;
- last sync;
- last error;
- webhook status.

### Сценарии

- OAuth connect;
- reconnect;
- disconnect with confirmation;
- test connection;
- manual sync;
- settings;
- sync log and errors.

## Задачи

- create/edit/complete/delete;
- due date, priority, assignee, linked deal/project;
- filters overdue/today/upcoming/completed;
- reminders and notifications.

## Проекты

- create/edit/archive project;
- kanban items;
- drag and drop;
- assignee, due date, priority;
- link deal/client;
- budget and progress.

## Команда

- invite member;
- roles owner/admin/manager;
- activate/deactivate;
- workload and performance;
- audit log.

## Бухгалтерия

- accounts and transactions;
- income/expense/transfer/refund;
- categories and counterparties;
- date/account/category filters;
- cashflow, P&L, AR/AP;
- import/export;
- internal transfers excluded from income/expense.

## Облако

- upload/download/delete;
- folders;
- link to deal/contact/project;
- storage provider abstraction;
- quota and sync status;
- file preview and access control.

## Видеовстречи

- create/update/cancel meeting;
- participants;
- provider link;
- calendar sync;
- reminders;
- link to deal/contact;
- outcome and recording metadata.

## Порядок реализации

1. Global action feedback and error handling.
2. CRM deals and pipelines.
3. Tasks, projects, team and accounting.
4. Ads tables and end-to-end analytics contracts.
5. Integrations connection lifecycle.
6. Messaging channels.
7. Cloud and meetings.
8. Full regression build and smoke checklist.
