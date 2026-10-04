#!/usr/bin/env bash
# Runs before the migration (the deploy script calls it from the app directory). Makes sure the
# database and the object store are up, then dumps the database so a bad migration can be undone.
# Keeps the five newest dumps in ./backups.
set -euo pipefail

compose() { docker compose --env-file .tag "$@"; }

compose up -d --wait postgres s3
compose up storage-bootstrap

mkdir -p backups
dump="backups/cashier-$(date +%Y%m%d-%H%M%S).dump"
compose exec -T postgres pg_dump -U cashier -Fc moli-cashier-db > "$dump"
echo "[pre-deploy] database dumped to $dump"

ls -1t backups/cashier-*.dump | tail -n +6 | xargs -r rm --
