# Binotel OAuth activation

IMDS Marketing is prepared for Binotel OAuth without hard-coded provider endpoints.

## What is already implemented

- Binotel card uses `Подключить через OAuth` instead of asking a clinic user for API Key / API Secret.
- OAuth is bound to the currently selected company and branch.
- OAuth state is signed and expires after 10 minutes.
- The authorization code is exchanged server-side.
- Access/refresh tokens are encrypted with `INTEGRATION_ENCRYPTION_KEY` before they are stored in `integration_credentials`.
- The existing branch-scoped Binotel webhook secret is created/preserved automatically.
- When Binotel is activated, Sipuni is deactivated for the same branch.

## Parameters to add later

Add the official values supplied by Binotel to the GitHub secret `IMDS_OAUTH_ENV`:

```env
BINOTEL_OAUTH_CLIENT_ID=
BINOTEL_OAUTH_CLIENT_SECRET=
BINOTEL_OAUTH_AUTHORIZE_URL=
BINOTEL_OAUTH_TOKEN_URL=
BINOTEL_OAUTH_SCOPES=
```

Optional parameters:

```env
# Defaults to ${APP_ORIGIN}/integrations when omitted.
BINOTEL_OAUTH_REDIRECT_URI=

# Supported: client_secret_post (default) or client_secret_basic.
BINOTEL_OAUTH_TOKEN_AUTH_METHOD=client_secret_post

# JSON object with provider-specific authorize parameters, if Binotel requires them.
BINOTEL_OAUTH_AUTHORIZE_PARAMS={}

# JSON object with provider-specific token parameters, if Binotel requires them.
BINOTEL_OAUTH_TOKEN_PARAMS={}
```

Do not guess OAuth URLs, scopes, or provider-specific parameters. Use the exact values from Binotel partner/application documentation.

## Redirect URI

Register the exact Redirect URI shown inside the Binotel integration card. By default it is:

```text
${APP_ORIGIN}/integrations
```

For the current IP-only VPS deployment this resolves from `APP_ORIGIN`. When a production HTTPS domain is introduced, update `APP_ORIGIN` (or explicitly set `BINOTEL_OAUTH_REDIRECT_URI`) and update the redirect URI in the Binotel application settings.

## Activation flow

1. Add official Binotel OAuth parameters to `IMDS_OAUTH_ENV`.
2. Deploy `main` so `/etc/imds-oauth.env` is refreshed on the VPS.
3. Open IMDS Marketing and select a concrete clinic and branch.
4. Open `Интеграции` → `Binotel`.
5. Click `Подключить через OAuth`.
6. Approve access in Binotel.
7. Binotel returns to `/integrations`; IMDS completes the code/token exchange through the authenticated API and stores the encrypted tokens for the selected branch.

Until the required OAuth parameters are present, the Binotel panel stays in a safe not-configured state and lists the missing environment keys.
