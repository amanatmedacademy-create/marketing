# Интеграции AMANAT MED Marketing

Cloudflare Worker принимает webhook-события, выполняет периодическую сверку API и пишет нормализованные данные в Supabase.

## Endpoint-ы

- `POST /api/webhooks/bitrix` — события лидов и сделок Bitrix24.
- `GET|POST /api/webhooks/meta` — проверка webhook и Lead Ads Meta.
- `POST /api/webhooks/tiktok` — лиды TikTok.
- `POST /api/webhooks/n8n` — универсальный нормализованный импорт из n8n.
- `POST /api/integrations/sync` — защищённый ручной запуск API-синхронизации.
- `GET /api/integrations/status` — фактическая конфигурация и последние запуски.

## Cron

- `15 * * * *` — каждый час сверяет последние 3 дня.
- `30 2 * * *` — ежедневно в 02:30 UTC сверяет последние 30 дней.

## 1. Supabase

Выполнить миграции по порядку, включая:

```text
supabase/migrations/202607280004_integrations.sql
supabase/migrations/202607280005_integration_upsert_constraints.sql
```

Они добавляют CRM-поля, журнал webhook, журнал синхронизаций и уникальные ключи против дублей.

## 2. Cloudflare secrets

Базовые секреты:

```bash
wrangler secret put SUPABASE_SERVICE_ROLE_KEY
wrangler secret put SYNC_API_KEY
wrangler secret put N8N_WEBHOOK_SECRET
```

### Bitrix24

```bash
wrangler secret put BITRIX_WEBHOOK_BASE_URL
wrangler secret put BITRIX_OUTBOUND_TOKEN
```

`BITRIX_WEBHOOK_BASE_URL`:

```text
https://portal.bitrix24.kz/rest/USER_ID/WEBHOOK_TOKEN
```

В Bitrix24 создать исходящий webhook на:

```text
https://marketing.amanat-med-academy.workers.dev/api/webhooks/bitrix
```

События минимум:

- `ONCRMLEADADD`
- `ONCRMLEADUPDATE`
- `ONCRMDEALADD`
- `ONCRMDEALUPDATE`

Stage ID задаются обычными переменными Cloudflare:

```text
BITRIX_TARGET_STAGE_IDS=...
BITRIX_ARRIVED_STAGE_IDS=...
BITRIX_SALE_STAGE_IDS=...
```

Пользовательские поля сопоставляются переменными:

```text
BITRIX_APPOINTMENT_FIELD
BITRIX_TARGET_FIELD
BITRIX_ARRIVED_FIELD
BITRIX_SALE_DATE_FIELD
BITRIX_SALE_AMOUNT_FIELD
BITRIX_NEXT_ACTION_FIELD
BITRIX_SOURCE_FIELD
BITRIX_CAMPAIGN_FIELD
```

### Meta

```bash
wrangler secret put META_ACCESS_TOKEN
wrangler secret put META_AD_ACCOUNT_IDS
wrangler secret put META_WEBHOOK_VERIFY_TOKEN
wrangler secret put META_APP_SECRET
```

Добавить обычную переменную `META_GRAPH_VERSION` с версией Graph API, доступной приложению Meta.

Webhook URL:

```text
https://marketing.amanat-med-academy.workers.dev/api/webhooks/meta
```

Подписка: Lead Ads / `leadgen`.

### TikTok

```bash
wrangler secret put TIKTOK_ACCESS_TOKEN
wrangler secret put TIKTOK_ADVERTISER_IDS
wrangler secret put TIKTOK_WEBHOOK_SECRET
```

Webhook URL:

```text
https://marketing.amanat-med-academy.workers.dev/api/webhooks/tiktok
```

Секрет передаётся как `Authorization: Bearer ...`, `x-webhook-secret` или query-параметр `secret`.

## 3. n8n

n8n отправляет нормализованный JSON на:

```text
POST https://marketing.amanat-med-academy.workers.dev/api/webhooks/n8n
Authorization: Bearer N8N_WEBHOOK_SECRET
Content-Type: application/json
```

Лиды:

```json
{
  "kind": "lead",
  "records": [
    {
      "external_id": "wazzup:123",
      "name": "Клиент",
      "phone": "+77000000000",
      "source": "Meta WhatsApp",
      "platform": "Meta",
      "stage": "Новый",
      "lead_created_at": "2026-07-28T10:00:00+05:00"
    }
  ]
}
```

Реклама:

```json
{
  "kind": "ad",
  "records": [
    {
      "external_id": "meta:account:ad",
      "report_date": "2026-07-28",
      "platform": "Meta",
      "source": "Meta",
      "campaign_name": "Грыжа",
      "ad_id": "123",
      "spend": 25000,
      "impressions": 10000,
      "clicks": 300,
      "leads": 12
    }
  ]
}
```

Готовые дневные агрегаты:

```json
{
  "kind": "daily_metric",
  "records": [
    {
      "date": "2026-07-28",
      "source": "Meta WhatsApp",
      "platform": "Meta",
      "leads": 20,
      "target_leads": 8,
      "arrived": 4,
      "sales": 2,
      "spend": 50000,
      "revenue": 474000
    }
  ]
}
```

## 4. Первая синхронизация

```bash
curl -X POST \
  -H "Authorization: Bearer SYNC_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"source":"all","days":90}' \
  https://marketing.amanat-med-academy.workers.dev/api/integrations/sync
```

Проверка:

```text
https://marketing.amanat-med-academy.workers.dev/api/integrations/status
https://marketing.amanat-med-academy.workers.dev/api/dashboard
https://marketing.amanat-med-academy.workers.dev/api/sources
https://marketing.amanat-med-academy.workers.dev/api/ads
```
