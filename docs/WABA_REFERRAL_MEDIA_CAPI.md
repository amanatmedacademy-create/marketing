# WABA referral, media and Meta Conversions API

## Что реализовано

- Входящие WhatsApp Cloud API сообщения принимаются на `GET/POST /api/webhooks/waba`.
- Текст, изображения, видео, аудио, документы и стикеры сохраняются в существующий модуль чата.
- Медиа загружаются в приватный Supabase Storage bucket `marketing-chat-attachments`.
- Для Click-to-WhatsApp обращений сохраняется объект `message.referral`:
  - `source_url`
  - `source_id`
  - `source_type`
  - `headline`
  - `body`
  - тип и URL рекламного медиа
- В карточке лида автоматически заполняются:
  - источник `Meta Click-to-WhatsApp`
  - кампания/заголовок рекламы
  - ID объявления
  - первое сообщение клиента
- Исходящие сообщения и вложения из существующего интерфейса колл-центра отправляются через WhatsApp Cloud API.
- Конверсии отправляются в Meta через `POST /api/integrations/meta/conversions` и журналируются в `meta_conversion_events`.

## Настройка webhook в Meta

Callback URL:

```text
https://<your-domain>/api/webhooks/waba
```

Verify token должен совпадать с `META_WEBHOOK_VERIFY_TOKEN`.

Для WhatsApp Business Account необходимо подписать приложение на поле `messages`.
Для проверки подписи webhook должен быть настроен `META_APP_SECRET`.

## Миграция базы данных

Применить:

```text
supabase/migrations/20260806173000_waba_referral_media_capi.sql
```

Миграция добавляет referral-поля в `marketing_leads`, разрешает provider `waba` в `integration_credentials` и создаёт таблицу журнала `meta_conversion_events`.

## Отправка конверсии

Endpoint доступен администратору:

```http
POST /api/integrations/meta/conversions
Content-Type: application/json
```

Пример:

```json
{
  "leadId": "UUID карточки лида",
  "datasetId": "META_DATASET_OR_PIXEL_ID",
  "eventName": "Lead",
  "eventId": "lead:UUID:qualified",
  "value": 250000,
  "currency": "KZT",
  "testEventCode": "TEST12345"
}
```

`testEventCode` используется только для проверки в Meta Events Manager и не обязателен в production.
Телефон и email перед отправкой нормализуются и хешируются SHA-256.

Рекомендуемые события:

- `Lead` — первый подтверждённый лид;
- `Schedule` — запись/назначение встречи;
- `Purchase` — оплаченная продажа с `value` и `currency`.

Для дедупликации передавайте стабильный `eventId` для одного бизнес-события.

## Ограничения

- Свободные исходящие сообщения разрешены только в рамках правил WhatsApp Business Platform; вне разрешённого окна требуется approved template.
- Доступность referral-полей зависит от того, пришёл ли первый контакт через Click-to-WhatsApp рекламу.
- Для CAPI токен Meta должен иметь права на выбранный dataset/pixel.
