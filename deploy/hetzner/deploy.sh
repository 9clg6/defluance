#!/usr/bin/env bash
# Deploy Defluance to a server you can reach over SSH, with Docker installed.
#   deploy/hetzner/deploy.sh root@203.0.113.7 [domain]
# Without a domain the address is <ip>.sslip.io (free DNS that points at the IP), which Caddy gets a certificate for.
# Run again to update: the vault, the data and the secrets stay where they are.
set -euo pipefail
host=${1:?usage: deploy.sh user@host [domain]}
ip=${host#*@}
domain=${2:-${ip//./-}.sslip.io}
dir=/opt/defluance
cd "$(dirname "$0")/../.."

node scripts/pack-cli.mjs --no-pack
ssh "$host" "mkdir -p $dir/vault"
rsync -az --delete dist-npm/ "$host:$dir/dist-npm/"
rsync -az deploy/hetzner/Dockerfile deploy/hetzner/compose.yaml deploy/hetzner/Caddyfile deploy/hetzner/.dockerignore deploy/hetzner/backup.sh deploy/hetzner/set-secret "$host:$dir/"

ssh "$host" bash -s -- "$dir" "$domain" <<'REMOTE'
set -euo pipefail
dir=$1; domain=$2; cd "$dir"
# the build context is this folder: the bundle goes where the Dockerfile expects it
if [ ! -f .env ]; then
  umask 077
  cat > .env <<ENV
DFL_ADMIN_TOKEN=dfl_$(openssl rand -hex 24)
DFL_SESSION_SECRET=$(openssl rand -hex 32)
ENV
fi
sed -i '/^DOMAIN=/d;/^DFL_PUBLIC_URL=/d' .env
printf 'DOMAIN=%s\nDFL_PUBLIC_URL=https://%s\n' "$domain" "$domain" >> .env
chown -R 1000:1000 vault   # the container runs as the node user
docker compose build
docker compose run -T --rm --no-deps defluance init /vault </dev/null >/dev/null   # schema, templates and git repo; keeps what exists
# commit that first state: a vault with uncommitted files cannot merge an agent draft
docker compose run -T --rm --no-deps --entrypoint sh defluance -c 'cd /vault && git add -A && { git diff --cached --quiet || git -c user.name=Defluance -c user.email=defluance@localhost commit -qm "init defluance"; }' </dev/null
docker compose up -d
docker compose ps
# daily backup of the vault and the database, kept for 14 days
cat > /etc/systemd/system/defluance-backup.service <<UNIT
[Unit]
Description=Defluance backup (vault bundle and database)
[Service]
Type=oneshot
ExecStart=$dir/backup.sh
UNIT
cat > /etc/systemd/system/defluance-backup.timer <<UNIT
[Unit]
Description=Daily Defluance backup
[Timer]
OnCalendar=*-*-* 03:30:00
Persistent=true
RandomizedDelaySec=10min
[Install]
WantedBy=timers.target
UNIT
systemctl daemon-reload
systemctl enable --now defluance-backup.timer >/dev/null 2>&1
REMOTE
echo "https://$domain  (admin token: ssh $host grep ADMIN_TOKEN $dir/.env)"
