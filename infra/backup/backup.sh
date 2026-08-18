#!/usr/bin/env bash
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/var/backups/imds-marketing}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUTPUT="$BACKUP_DIR/imds-marketing-$TIMESTAMP.dump"

mkdir -p "$BACKUP_DIR"
chmod 0700 "$BACKUP_DIR"

docker exec imds-postgres pg_dump \
  -U imds_owner \
  -d imds_marketing \
  --format=custom \
  --no-owner \
  --no-privileges > "$OUTPUT"

sha256sum "$OUTPUT" > "$OUTPUT.sha256"
find "$BACKUP_DIR" -type f -name 'imds-marketing-*.dump' -mtime "+$RETENTION_DAYS" -delete
find "$BACKUP_DIR" -type f -name 'imds-marketing-*.dump.sha256' -mtime "+$RETENTION_DAYS" -delete

echo "$OUTPUT"
