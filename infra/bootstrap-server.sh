#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="${1:-/opt/imds-marketing/repository}"
INFRA_DIR="/opt/imds-infra"
DATA_DIR="/var/lib/imds-marketing/postgres"
ENV_FILE="$INFRA_DIR/stack.env"
APP_ENV="/etc/imds-marketing.env"

if [ "$(id -u)" -ne 0 ]; then
  echo "Run as root" >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y ca-certificates curl gnupg nginx ufw openssl python3 tar gzip

if ! command -v docker >/dev/null 2>&1; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg
  . /etc/os-release
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $VERSION_CODENAME stable" > /etc/apt/sources.list.d/docker.list
  apt-get update
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi

if ! command -v node >/dev/null 2>&1 || [ "$(node -p 'Number(process.versions.node.split(`.`)[0])' 2>/dev/null || echo 0)" -lt 22 ]; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg
  echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main" > /etc/apt/sources.list.d/nodesource.list
  apt-get update
  apt-get install -y nodejs
fi

systemctl enable --now docker nginx
ufw allow OpenSSH || true
ufw allow 'Nginx Full' || true
ufw --force enable || true

mkdir -p "$INFRA_DIR" "$DATA_DIR" /opt/imds-marketing/releases /opt/imds-marketing/control /var/backups/imds-marketing
chmod 0700 "$INFRA_DIR" /var/backups/imds-marketing

if ! id imds >/dev/null 2>&1; then
  useradd --system --home /opt/imds-marketing --shell /usr/sbin/nologin imds
fi

if [ ! -f "$ENV_FILE" ]; then
  POSTGRES_PASSWORD="$(openssl rand -hex 32)"
  PGRST_JWT_SECRET="$(openssl rand -hex 48)"
  cat > "$ENV_FILE" <<EOF
POSTGRES_USER=imds_owner
POSTGRES_PASSWORD=$POSTGRES_PASSWORD
POSTGRES_DB=imds_marketing
PGRST_JWT_SECRET=$PGRST_JWT_SECRET
POSTGREST_IMAGE=postgrest/postgrest:v12.2.3
EOF
  chmod 0600 "$ENV_FILE"
fi

if [ ! -f "$REPO_DIR/infra/docker-compose.yml" ]; then
  echo "Repository is missing at $REPO_DIR or infra/docker-compose.yml is absent" >&2
  exit 1
fi

cp "$REPO_DIR/infra/docker-compose.yml" "$INFRA_DIR/docker-compose.yml"
docker compose --env-file "$ENV_FILE" -f "$INFRA_DIR/docker-compose.yml" up -d

for attempt in $(seq 1 40); do
  if docker exec imds-postgres pg_isready -U imds_owner -d imds_marketing >/dev/null 2>&1; then
    break
  fi
  if [ "$attempt" -eq 40 ]; then
    echo "PostgreSQL did not become healthy" >&2
    exit 1
  fi
  sleep 2
done

# Create PostgREST roles before migrations reference them.
docker exec -i imds-postgres psql -v ON_ERROR_STOP=1 -U imds_owner -d imds_marketing <<'SQL'
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;
grant anon, authenticated, service_role to imds_owner;
grant usage on schema public to anon, authenticated, service_role;
SQL

set -a
. "$ENV_FILE"
set +a
SERVICE_ROLE_JWT="$(PGRST_JWT_SECRET="$PGRST_JWT_SECRET" python3 - <<'PY'
import base64, hashlib, hmac, json, os, time

def b64(v: bytes) -> str:
    return base64.urlsafe_b64encode(v).decode().rstrip('=')
header = b64(json.dumps({'alg':'HS256','typ':'JWT'}, separators=(',',':')).encode())
payload = b64(json.dumps({'role':'service_role','iat':int(time.time())}, separators=(',',':')).encode())
msg = f'{header}.{payload}'.encode()
sig = b64(hmac.new(os.environ['PGRST_JWT_SECRET'].encode(), msg, hashlib.sha256).digest())
print(f'{header}.{payload}.{sig}')
PY
)"

APP_ORIGIN_VALUE="${APP_ORIGIN:-http://$(hostname -I | awk '{print $1}')}"
if [ ! -f "$APP_ENV" ]; then
  install -m 0600 /dev/null "$APP_ENV"
fi
python3 - "$APP_ENV" "$APP_ORIGIN_VALUE" "$SERVICE_ROLE_JWT" <<'PY'
from pathlib import Path
import sys
path = Path(sys.argv[1])
updates = {
    'APP_ORIGIN': sys.argv[2],
    'IMDS_LOCAL_DB_URL': 'http://127.0.0.1:3000',
    'IMDS_LOCAL_SERVICE_ROLE_KEY': sys.argv[3],
}
lines = path.read_text().splitlines() if path.exists() else []
seen = set()
out = []
for line in lines:
    key = line.split('=', 1)[0].strip() if '=' in line and not line.lstrip().startswith('#') else ''
    if key in updates:
        out.append(f'{key}={updates[key]}')
        seen.add(key)
    else:
        out.append(line)
for key, value in updates.items():
    if key not in seen:
        out.append(f'{key}={value}')
path.write_text('\n'.join(out).rstrip() + '\n')
PY
chmod 0600 "$APP_ENV"

# Make PostgREST reload after future DDL changes.
docker exec -i imds-postgres psql -v ON_ERROR_STOP=1 -U imds_owner -d imds_marketing -c "alter role authenticator nologin" >/dev/null 2>&1 || true

curl -fsS http://127.0.0.1:3000/ >/dev/null || true

echo "IMDS VPS base infrastructure is ready."
echo "PostgreSQL: imds-postgres"
echo "PostgREST: 127.0.0.1:3000"
echo "Application env: $APP_ENV"
