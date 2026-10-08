#!/usr/bin/env bash
# Runs before the migration (the deploy script calls it from the app directory). Makes sure the
# database and the object store are up, then dumps the database so a bad migration, or a release
# that quietly wrote bad data, can be undone. Keeps every dump from the last 14 days and never fewer
# than the five newest.
set -euo pipefail
# The dumps hold the whole ledger: readable by the deploy account only.
umask 077

compose() { docker compose --env-file .tag "$@"; }

compose up -d --wait postgres s3
compose up storage-bootstrap

mkdir -p backups
chmod 700 backups
dump="backups/cashier-$(date +%Y%m%d-%H%M%S).dump"
partial="$dump.partial"
trap 'rm -f -- "$partial"' EXIT

compose exec -T postgres pg_dump -U cashier -Fc moli-cashier-db > "$partial"
# A dump cut short still leaves a file; only one whose table of contents reads back counts.
compose exec -T postgres pg_restore --list < "$partial" > /dev/null
mv -- "$partial" "$dump"
echo "[pre-deploy] database dumped to $dump"

# Past the five newest, drop the dumps older than 14 days.
ls -1t backups/cashier-*.dump | tail -n +6 | while read -r old; do
  if [ -n "$(find "$old" -mtime +14)" ]; then rm -- "$old"; fi
done
