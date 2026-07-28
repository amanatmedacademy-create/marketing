# Интеграции AMANAT MED Marketing

Интеграции Bitrix24, Meta Ads, TikTok Ads и n8n подключаются из раздела `/integrations`.

Реквизиты отправляются только в Cloudflare Worker, шифруются AES-GCM и сохраняются в закрытой таблице Supabase. API никогда не возвращает токены обратно в браузер — только признак, что секрет сохранён.

## 1. Supabase

Выполнить миграции по порядку:

```text
supabase/migrations/202607280004_integrations.sql
supabase/migrations/202607280005_integration_upsert_constraints.sql
supabase/migrations/202607280006_integration_credentials.sql
```

Последняя миграция создаёт таблицу `integration_credentials` с RLS и доступом только для `service_role`.

## 2. Два bootstrap-секрета Cloudflare

Токены рекламных кабинетов через Cloudflare Dashboard больше добавлять не нужно. В Cloudflare остаются только два системных секрета:

```bash
wrangler secret put FRONTEND_ADMIN_KEY
wrangler secret put INTEGRATION_ENCRYPTION_KEY
```

- `FRONTEND_ADMIN_KEY` — пароль для открытия панели подключения.
- `INTEGRATION_ENCRYPTION_KEY` — длинная случайная строка, используемая для шифрования реквизитов.

Также должен оставаться ранее настроенный:

```bash
wrangler secret put SUPABASE_SERVICE_ROLE_KEY
```

Не менять `INTEGRATION_ENCRYPTION_KEY` после сохранения интеграций. При его замене старые реквизиты невозможно расшифровать — их потребуется подключить заново.

## 3. Подключение через frontend

Открыть:

```text
https://marketing.amanat-med-academy.workers.dev/integrations
```

Далее:

1. Ввести `FRONTEND_ADMIN_KEY`.
2. Заполнить карточку Bitrix24, Meta, TikTok или n8n.
3. Нажать **«Сохранить и проверить»**.
4. После успешной проверки нажать **«Загрузить 90 дней»**.

Секретные поля после сохранения очищаются. Для замены токена его нужно вставить повторно.

## 4. Webhook endpoints

```text
Bitrix24: /api/webhooks/bitrix
Meta:     /api/webhooks/meta
TikTok:   /api/webhooks/tiktok
n8n:      /api/webhooks/n8n
```

Полный URL строится от рабочего домена:

```text
https://marketing.amanat-med-academy.workers.dev/api/webhooks/bitrix
https://marketing.amanat-med-academy.workers.dev/api/webhooks/meta
https://marketing.amanat-med-academy.workers.dev/api/webhooks/tiktok
https://marketing.amanat-med-academy.workers.dev/api/webhooks/n8n
```

## 5. Автоматическая синхронизация

Cloudflare Cron запускает:

- каждый час — сверку последних 3 дней;
- ежедневно — повторную загрузку последних 30 дней.

Первая историческая загрузка запускается кнопкой в frontend.

## 6. API управления

```text
GET    /api/integrations/config
PUT    /api/integrations/config/:provider
DELETE /api/integrations/config/:provider
POST   /api/integrations/test/:provider
POST   /api/integrations/sync
GET    /api/integrations/status
```

Административные маршруты требуют:

```text
Authorization: Bearer FRONTEND_ADMIN_KEY
```

## 7. n8n payload

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

n8n передаёт сохранённый в интерфейсе `webhookSecret`:

```text
Authorization: Bearer <webhookSecret>
```
