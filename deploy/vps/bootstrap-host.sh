#!/usr/bin/env bash
set -euo pipefail

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y ca-certificates curl gnupg nginx tar gzip ufw

if ! command -v node >/dev/null 2>&1 || [ "$(node -p 'Number(process.versions.node.split(`.`)[0])' 2>/dev/null || echo 0)" -lt 22 ]; then
  mkdir -p /etc/apt/keyrings
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg
  echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main" > /etc/apt/sources.list.d/nodesource.list
  apt-get update
  apt-get install -y nodejs
fi

npm install -g tsx

ufw allow OpenSSH || true
ufw allow 'Nginx Full' || true
ufw --force enable || true

mkdir -p /opt/imds-marketing/releases
if ! id imds >/dev/null 2>&1; then
  useradd --system --home /opt/imds-marketing --shell /usr/sbin/nologin imds
fi
chown -R imds:imds /opt/imds-marketing

printf 'Node: '; node --version
printf 'npm: '; npm --version
printf 'nginx: '; nginx -v 2>&1

echo 'VPS bootstrap completed.'
