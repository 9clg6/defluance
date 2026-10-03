#!/usr/bin/env bash
# Daily backup, run by the defluance-backup timer: the vault as a git bundle (every note and all its history)
# and the database (tokens, members, audit log, index). Kept for 14 days under /opt/defluance/backups.
# Restore: `git clone backups/<day>/vault.bundle vault`, and copy defluance.sqlite into the data volume.
set -euo pipefail
cd "$(dirname "$0")"
day=$(date +%F); dest=backups/$day; keep=${KEEP_DAYS:-14}
umask 077
mkdir -p "$dest"
git -c safe.directory='*' -C vault bundle create "$PWD/$dest/vault.bundle" --all 2>/dev/null
git -c safe.directory='*' -C vault bundle verify "$PWD/$dest/vault.bundle" >/dev/null 2>&1
if grep -q '^DFL_DATABASE_URL=' .env; then
  echo "database is Postgres: back it up with pg_dump (not done here)"
else
  # VACUUM INTO writes a consistent copy while the server keeps running
  docker compose exec -T defluance node - <<'JS'
const { DatabaseSync } = require("node:sqlite");
require("node:fs").rmSync("/data/backup.tmp", { force: true });
new DatabaseSync("/data/defluance.sqlite").exec("VACUUM INTO '/data/backup.tmp'");
JS
  docker compose cp defluance:/data/backup.tmp "$dest/defluance.sqlite" >/dev/null 2>&1
  docker compose exec -T defluance rm -f /data/backup.tmp
fi
find backups -mindepth 1 -maxdepth 1 -type d -mtime +"$keep" -exec rm -rf {} +
echo "backup $dest: $(du -sh "$dest" | cut -f1)"
