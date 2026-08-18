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
IMDS_LOCAL_DB_URL=
IMDS_LOCAL_SERVICE_ROLE_KEY=
OPENAI_API_KEY=
CURRENT_COMPANY_ID=
ENVFILE
  echo "Created /etc/imds-marketing.env. Populate secrets before enabling services." >&2
fi

cd "$RELEASE_DIR"
npm install --omit=dev --no-audit --no-fund || npm install --no-audit --no-fund

apply_local_migration() {
  local relative_path="$1"
  local migration_path="$RELEASE_DIR/$relative_path"
  if [ ! -f "$migration_path" ]; then
    echo "Required local PostgreSQL migration is missing: $relative_path" >&2
    exit 1
  fi
  echo "Applying local PostgreSQL migration: $relative_path"
  docker exec -i imds-postgres psql -v ON_ERROR_STOP=1 -U imds_owner -d imds_marketing < "$migration_path"
}

# Keep the self-hosted PostgreSQL schema aligned with the CRM runtime. These
# historical files live under supabase/migrations only as migration history;
# production data is applied to the local VPS PostgreSQL container.
apply_local_migration "supabase/migrations/20260806163000_rebuild_sales_funnel_on_crm_core.sql"
apply_local_migration "supabase/migrations/20260806172000_add_crm_deal_activities.sql"
apply_local_migration "supabase/migrations/20260813051500_crm_custom_deal_fields.sql"
apply_local_migration "supabase/migrations/20260813150000_crm_field_builder_pro.sql"
apply_local_migration "supabase/migrations/20260818093000_fail_closed_control_plane.sql"
apply_local_migration "supabase/migrations/20260818123000_binotel_sipuni_telephony.sql"

# PostgREST caches schema metadata. Reload it after DDL and fail the release if
# the CRM objects required by /api/funnel are incomplete.
docker exec -i imds-postgres psql -v ON_ERROR_STOP=1 -U imds_owner -d imds_marketing <<'SQL'
notify pgrst, 'reload schema';

do $$
declare
  missing text[] := array[]::text[];
begin
  if to_regclass('public.crm_pipelines') is null then missing := array_append(missing, 'crm_pipelines'); end if;
  if to_regclass('public.crm_pipeline_stages') is null then missing := array_append(missing, 'crm_pipeline_stages'); end if;
  if to_regclass('public.crm_deals') is null then missing := array_append(missing, 'crm_deals'); end if;
  if to_regclass('public.crm_deal_stage_events') is null then missing := array_append(missing, 'crm_deal_stage_events'); end if;
  if to_regclass('public.crm_deal_activities') is null then missing := array_append(missing, 'crm_deal_activities'); end if;
  if to_regclass('public.crm_custom_field_definitions') is null then missing := array_append(missing, 'crm_custom_field_definitions'); end if;
  if to_regclass('public.crm_custom_field_values') is null then missing := array_append(missing, 'crm_custom_field_values'); end if;
  if to_regclass('public.crm_custom_field_sections') is null then missing := array_append(missing, 'crm_custom_field_sections'); end if;

  if to_regclass('public.crm_deals') is not null then
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'crm_deals' and column_name = 'marketing_lead_id') then missing := array_append(missing, 'crm_deals.marketing_lead_id'); end if;
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'crm_deals' and column_name = 'diagnost_user_id') then missing := array_append(missing, 'crm_deals.diagnost_user_id'); end if;
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'crm_deals' and column_name = 'priority') then missing := array_append(missing, 'crm_deals.priority'); end if;
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'crm_deals' and column_name = 'stage_entered_at') then missing := array_append(missing, 'crm_deals.stage_entered_at'); end if;
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'crm_deals' and column_name = 'paid') then missing := array_append(missing, 'crm_deals.paid'); end if;
  end if;

  if cardinality(missing) > 0 then
    raise exception 'IMDS Marketing CRM schema is incomplete: %', array_to_string(missing, ', ');
  end if;
end $$;
SQL

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
