#!/usr/bin/env bash
set -euo pipefail

RELEASE_ARCHIVE="${1:-/tmp/imds-marketing-release.tgz}"
APP_ROOT="/opt/imds-marketing"
RELEASE_ID="${2:-$(date -u +%Y%m%d%H%M%S)}"
RELEASE_DIR="$APP_ROOT/releases/$RELEASE_ID"
CONTROL_ENV=/etc/imds-platform-control.env
CONTROL_GROUP=imds-platform

if [ ! -f "$RELEASE_ARCHIVE" ]; then
  echo "Release archive not found: $RELEASE_ARCHIVE" >&2
  exit 1
fi

if ! id imds >/dev/null 2>&1; then
  useradd --system --home "$APP_ROOT" --shell /usr/sbin/nologin imds
fi
getent group "$CONTROL_GROUP" >/dev/null 2>&1 || groupadd --system "$CONTROL_GROUP"
usermod -a -G "$CONTROL_GROUP" imds
if id imdssa >/dev/null 2>&1; then
  usermod -a -G "$CONTROL_GROUP" imdssa
fi

if [ ! -f "$CONTROL_ENV" ]; then
  umask 027
  printf 'IMDS_PLATFORM_CONTROL_TOKEN=%s\n' "$(openssl rand -hex 48)" > "$CONTROL_ENV"
fi
chown root:"$CONTROL_GROUP" "$CONTROL_ENV"
chmod 0640 "$CONTROL_ENV"

mkdir -p "$APP_ROOT/releases" "$RELEASE_DIR" "$APP_ROOT/control"
chown imds:imds "$APP_ROOT/control"
chmod 0750 "$APP_ROOT/control"
tar -xzf "$RELEASE_ARCHIVE" -C "$RELEASE_DIR"
chown -R imds:imds "$APP_ROOT/releases" "$RELEASE_DIR"

ln -sfn "$RELEASE_DIR" "$APP_ROOT/current"

install -m 0644 "$RELEASE_DIR/deploy/vps/imds-marketing.service" /etc/systemd/system/imds-marketing.service
install -m 0644 "$RELEASE_DIR/deploy/vps/imds-marketing-scheduler.service" /etc/systemd/system/imds-marketing-scheduler.service
install -m 0644 "$RELEASE_DIR/deploy/vps/nginx-imds-marketing.conf" /etc/nginx/sites-available/imds-marketing
ln -sfn /etc/nginx/sites-available/imds-marketing /etc/nginx/sites-enabled/imds-marketing
rm -f /etc/nginx/sites-enabled/default

if [ ! -f /etc/imds-marketing.env ]; then
  install -m 0600 /dev/null /etc/imds-marketing.env
  cat >/etc/imds-marketing.env <<'ENVFILE'
# Fill server-side secrets before starting production.
APP_ORIGIN=http://89.207.250.55
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_ANON_KEY=
OPENAI_API_KEY=
CURRENT_COMPANY_ID=
ENVFILE
  echo "Created /etc/imds-marketing.env. Populate secrets before enabling services." >&2
fi

cd "$RELEASE_DIR"
npm install --omit=dev --no-audit --no-fund || npm install --no-audit --no-fund

FAIL_CLOSED_MIGRATION="$RELEASE_DIR/supabase/migrations/20260818093000_fail_closed_control_plane.sql"
if [ -f "$FAIL_CLOSED_MIGRATION" ]; then
  cat "$FAIL_CLOSED_MIGRATION" | docker exec -i imds-postgres psql -v ON_ERROR_STOP=1 -U imds_owner -d imds_marketing
fi

nginx -t
systemctl daemon-reload
systemctl enable nginx imds-marketing imds-marketing-scheduler
systemctl restart nginx
systemctl restart imds-marketing
systemctl restart imds-marketing-scheduler

sleep 2
systemctl --no-pager --full status imds-marketing | sed -n '1,18p'
curl -fsS http://127.0.0.1:8787/api/health || true

echo "Installed IMDS Marketing release $RELEASE_ID"
