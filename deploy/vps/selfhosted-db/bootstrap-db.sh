#!/usr/bin/env bash
set -euo pipefail
STACK_DIR=/opt/imds-db
ENV_FILE=/etc/imds-postgres.env
APP_ENV_FILE=/etc/imds-marketing.env
MIGRATIONS_DIR="${1:-/opt/imds-db/migrations}"
export DEBIAN_FRONTEND=noninteractive
apt-get -o Acquire::ForceIPv4=true update || true
apt-get -o Acquire::ForceIPv4=true install -y ca-certificates curl openssl docker.io
if ! docker compose version >/dev/null 2>&1; then apt-get -o Acquire::ForceIPv4=true install -y docker-compose-v2 || apt-get -o Acquire::ForceIPv4=true install -y docker-compose; fi
systemctl enable --now docker
mkdir -p "$STACK_DIR" /var/lib/imds-postgres /var/backups/imds-postgres
chmod 700 /var/lib/imds-postgres /var/backups/imds-postgres
base64url(){ openssl base64 -A | tr '+/' '-_' | tr -d '='; }
make_service_jwt(){ local secret="$1" header payload unsigned signature; header="$(printf '%s' '{"alg":"HS256","typ":"JWT"}' | base64url)"; payload="$(printf '%s' '{"role":"service_role","iss":"imds-selfhosted"}' | base64url)"; unsigned="$header.$payload"; signature="$(printf '%s' "$unsigned" | openssl dgst -sha256 -hmac "$secret" -binary | base64url)"; printf '%s.%s' "$unsigned" "$signature"; }
if [ ! -f "$ENV_FILE" ]; then
  POSTGRES_PASSWORD="$(openssl rand -hex 32)"; IMDS_API_PASSWORD="$(openssl rand -hex 32)"; PGRST_JWT_SECRET="$(openssl rand -hex 48)"; LOCAL_SERVICE_ROLE_KEY="$(make_service_jwt "$PGRST_JWT_SECRET")"; umask 077
  cat >"$ENV_FILE" <<EOF
POSTGRES_PASSWORD=$POSTGRES_PASSWORD
IMDS_API_PASSWORD=$IMDS_API_PASSWORD
PGRST_JWT_SECRET=$PGRST_JWT_SECRET
LOCAL_SERVICE_ROLE_KEY=$LOCAL_SERVICE_ROLE_KEY
EOF
fi
chmod 600 "$ENV_FILE"; set -a; . "$ENV_FILE"; set +a
if [ -z "${PGRST_JWT_SECRET:-}" ]; then PGRST_JWT_SECRET="$(openssl rand -hex 48)"; printf '\nPGRST_JWT_SECRET=%s\n' "$PGRST_JWT_SECRET" >>"$ENV_FILE"; fi
if [ -z "${LOCAL_SERVICE_ROLE_KEY:-}" ]; then LOCAL_SERVICE_ROLE_KEY="$(make_service_jwt "$PGRST_JWT_SECRET")"; printf 'LOCAL_SERVICE_ROLE_KEY=%s\n' "$LOCAL_SERVICE_ROLE_KEY" >>"$ENV_FILE"; fi
chmod 600 "$ENV_FILE"; export POSTGRES_PASSWORD IMDS_API_PASSWORD PGRST_JWT_SECRET LOCAL_SERVICE_ROLE_KEY
cd "$STACK_DIR"; if docker compose version >/dev/null 2>&1; then COMPOSE=(docker compose); else COMPOSE=(docker-compose); fi
"${COMPOSE[@]}" up -d postgres
for _ in $(seq 1 60); do if docker exec imds-postgres pg_isready -U imds_owner -d imds_marketing >/dev/null 2>&1; then break; fi; sleep 2; done
docker exec imds-postgres pg_isready -U imds_owner -d imds_marketing
SQL=$(cat <<EOF
DO \$\$ BEGIN
IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='imds_api') THEN CREATE ROLE imds_api LOGIN PASSWORD '$IMDS_API_PASSWORD'; ELSE ALTER ROLE imds_api PASSWORD '$IMDS_API_PASSWORD'; END IF;
END \$\$;
GRANT service_role TO imds_api;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS \$\$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid \$\$;
CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS \$\$ SELECT nullif(current_setting('request.jwt.claim.role', true), '') \$\$;
CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS \$\$ SELECT COALESCE(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb \$\$;
GRANT USAGE ON SCHEMA public TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO service_role;
EOF
)
docker exec -i imds-postgres psql -v ON_ERROR_STOP=1 -U imds_owner -d imds_marketing <<<"$SQL"
if [ -d "$MIGRATIONS_DIR" ]; then
  while IFS= read -r migration; do
    name="$(basename "$migration")"
    docker exec imds-postgres psql -U imds_owner -d imds_marketing -c 'create table if not exists public.imds_schema_migrations (filename text primary key, applied_at timestamptz not null default now())' >/dev/null
    if docker exec imds-postgres psql -U imds_owner -d imds_marketing -Atqc "select 1 from public.imds_schema_migrations where filename='${name//\'/\'\'}'" 2>/dev/null | grep -q 1; then continue; fi
    echo "Applying $name"; docker exec -i imds-postgres psql -v ON_ERROR_STOP=1 -U imds_owner -d imds_marketing <"$migration"; docker exec imds-postgres psql -v ON_ERROR_STOP=1 -U imds_owner -d imds_marketing -c "insert into public.imds_schema_migrations(filename) values ('${name//\'/\'\'}') on conflict do nothing" >/dev/null
  done < <(find "$MIGRATIONS_DIR" -maxdepth 1 -type f -name '*.sql' | sort)
fi
docker exec imds-postgres psql -v ON_ERROR_STOP=1 -U imds_owner -d imds_marketing <<'SQL'
GRANT USAGE ON SCHEMA public TO service_role;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO service_role;
SQL
"${COMPOSE[@]}" up -d postgrest
for _ in $(seq 1 30); do if curl -fsS -H "Authorization: Bearer $LOCAL_SERVICE_ROLE_KEY" http://127.0.0.1:3001/ >/dev/null 2>&1; then break; fi; sleep 2; done
curl -fsS -H "Authorization: Bearer $LOCAL_SERVICE_ROLE_KEY" http://127.0.0.1:3001/ >/dev/null
if [ -f "$APP_ENV_FILE" ]; then sed -i '/^IMDS_LOCAL_DB_URL=/d;/^IMDS_LOCAL_SERVICE_ROLE_KEY=/d' "$APP_ENV_FILE"; printf '\nIMDS_LOCAL_DB_URL=http://127.0.0.1:3002\nIMDS_LOCAL_SERVICE_ROLE_KEY=%s\n' "$LOCAL_SERVICE_ROLE_KEY" >>"$APP_ENV_FILE"; chmod 600 "$APP_ENV_FILE"; fi
echo 'Self-hosted PostgreSQL/PostgREST is ready on loopback with local service credentials.'
