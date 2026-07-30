# Bitrix24 OAuth

## Cloudflare secrets

Set the following Worker secrets:

- `BITRIX_CLIENT_ID`
- `BITRIX_CLIENT_SECRET`
- `INTEGRATION_ENCRYPTION_KEY`
- `APP_ORIGIN=https://marketing.amanat-med-academy.workers.dev`

## Bitrix24 application

Create a local or mass-market Bitrix24 application with CRM permissions.

Callback URL:

`https://marketing.amanat-med-academy.workers.dev/api/integrations/bitrix/oauth/callback`

Start URL used by the frontend:

`/api/integrations/bitrix/oauth/start`

## Flow

1. Administrator opens the start URL.
2. Bitrix24 asks the administrator to grant CRM access.
3. The callback exchanges the authorization code for access and refresh tokens.
4. Tokens are encrypted with AES-GCM and saved to `integration_credentials`.
5. The existing Bitrix synchronization uses an internal OAuth proxy, so no manually created incoming webhook is required.
6. Expired access tokens are refreshed automatically.

## Frontend

The API client exposes `marketingApi.startBitrixOAuth()`. The Bitrix24 card should call this method from a `Подключить Bitrix24` button. Manual webhook fields may remain available as a fallback until the OAuth flow is verified in production.
