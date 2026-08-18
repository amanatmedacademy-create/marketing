# IMDS Marketing — единый пакет OAuth-секретов

Платформенные OAuth credentials IMDS хранятся как один GitHub Actions Repository Secret:

`IMDS_OAUTH_ENV`

При production deploy содержимое секрета устанавливается на VPS в:

`/etc/imds-oauth.env`

Файл читается `imds-marketing.service` и `imds-marketing-scheduler.service`. Секреты не должны коммититься в репозиторий или попадать во frontend bundle.

## Шаблон IMDS_OAUTH_ENV

```env
# Public production origin used to build OAuth callback URLs.
APP_ORIGIN=https://YOUR_PRODUCTION_DOMAIN

# Google OAuth application used by IMDS account login and shared Google OAuth flows.
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=

# Optional shared Google Ads developer credential. This is platform-level, not a clinic token.
GOOGLE_ADS_DEVELOPER_TOKEN=

# Meta application used by Meta Ads OAuth and WhatsApp Embedded Signup.
META_APP_ID=
META_APP_SECRET=
META_WABA_CONFIG_ID=
META_GRAPH_VERSION=v23.0

# Optional explicit callback. If empty in runtime code, Meta Ads OAuth uses APP_ORIGIN + /api/integrations/meta/callback.
META_OAUTH_REDIRECT_URI=
```

## Разделение ответственности

В `IMDS_OAUTH_ENV` находятся только credentials самой платформы IMDS: OAuth Client/App IDs, Client/App Secrets, Meta WABA Configuration ID и при необходимости Google Ads Developer Token.

Токены и выбранные ресурсы конкретной клиники не должны находиться в GitHub Secrets:

- Meta access token и выбранные ad account IDs;
- WABA access token, WABA ID и Phone Number ID;
- Google refresh token, Customer IDs и GA4 Property IDs;
- TikTok access token / advertiser IDs;
- Bitrix webhook credentials;
- Zadarma API credentials.

Tenant credentials сохраняются зашифрованно в `integration_credentials` и привязаны к `company_id`.

## Redirect URI

После появления production-домена зарегистрировать в provider consoles точные callback URL.

Google account login:

`https://YOUR_PRODUCTION_DOMAIN/api/auth/google/callback`

Meta Ads OAuth:

`https://YOUR_PRODUCTION_DOMAIN/api/integrations/meta/callback`

WhatsApp Embedded Signup использует Meta App + `META_WABA_CONFIG_ID`; отдельный app secret для каждой клиники не нужен.

## Deploy

`.github/workflows/deploy-vps.yml`:

1. получает `IMDS_OAUTH_ENV` из GitHub Actions Secrets;
2. проверяет whitelist допустимых ключей;
3. передаёт файл на VPS без печати содержимого;
4. устанавливает `/etc/imds-oauth.env` с ограниченными правами;
5. release installer перезапускает backend и scheduler, которые читают новый env.

Если `IMDS_OAUTH_ENV` ещё не задан, deploy не удаляет существующий `/etc/imds-oauth.env`.
