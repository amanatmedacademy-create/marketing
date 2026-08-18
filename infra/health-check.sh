#!/usr/bin/env bash
set -euo pipefail

fail() { echo "FAIL: $*" >&2; exit 1; }

command -v docker >/dev/null || fail "docker missing"
command -v nginx >/dev/null || fail "nginx missing"

docker inspect -f '{{.State.Health.Status}}' imds-postgres 2>/dev/null | grep -q '^healthy$' || fail "imds-postgres is not healthy"
docker ps --format '{{.Names}}' | grep -qx 'imds-postgrest' || fail "imds-postgrest is not running"
curl -fsS http://127.0.0.1:3000/ >/dev/null || fail "PostgREST is unreachable"

if systemctl list-unit-files imds-marketing.service >/dev/null 2>&1; then
  systemctl is-active --quiet imds-marketing || fail "imds-marketing service is not active"
  curl -fsS http://127.0.0.1:8787/api/health >/dev/null || fail "Marketing API health check failed"
fi

nginx -t >/dev/null 2>&1 || fail "nginx configuration invalid"

echo "OK: IMDS Marketing infrastructure is healthy"
