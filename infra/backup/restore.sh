#!/usr/bin/env bash
set -euo pipefail

BACKUP_FILE="${1:-}"
if [ -z "$BACKUP_FILE" ] || [ ! -f "$BACKUP_FILE" ]; then
  echo "Usage: $0 /path/to/imds-marketing-*.dump" >&2
  exit 1
fi

if [ -f "$BACKUP_FILE.sha256" ]; then
  (cd "$(dirname "$BACKUP_FILE")" && sha256sum -c "$(basename "$BACKUP_FILE").sha256")
fi

systemctl stop imds-marketing imds-marketing-scheduler 2>/dev/null || true

cat "$BACKUP_FILE" | docker exec -i imds-postgres pg_restore \
  -U imds_owner \
  -d imds_marketing \
  --clean \
  --if-exists \
  --no-owner \
  --no-privileges

docker exec -i imds-postgres psql -v ON_ERROR_STOP=1 -U imds_owner -d imds_marketing -c "notify pgrst, 'reload schema';"

systemctl restart imds-marketing imds-marketing-scheduler 2>/dev/null || true

echo "Restore completed from $BACKUP_FILE"
