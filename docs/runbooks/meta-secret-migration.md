# Meta integration secret migration

The repository contains the complete Meta Login for Business and Meta Ads integration flow. Secret values are not stored in Git history. The legacy deployment reads them from Cloudflare Worker secrets; the Kubernetes deployment reads the same names from the `analytics-secrets` Secret.

Required keys:

- `META_APP_ID`
- `META_APP_SECRET`
- `META_WABA_CONFIG_ID`
- `META_ADS_CONFIG_ID`
- `META_TOKEN_ENCRYPTION_KEY` (32 random bytes, base64 or 64 hex characters)
- `SUPABASE_JWKS_URL`
- `SUPABASE_JWT_ISSUER`
- `DATABASE_URL`
- `CLICKHOUSE_URL`
- `CLICKHOUSE_USER`
- `CLICKHOUSE_PASSWORD`

Do not commit the values. Copy the existing Meta values from the Cloudflare Worker secret store into the Kubernetes secret manager. Existing access tokens in the legacy `meta_connections` table must be migrated once by a controlled migration job that encrypts them with `META_TOKEN_ENCRYPTION_KEY` before inserting into `analytics.meta_connections`.
