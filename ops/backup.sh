#!/usr/bin/env bash
# Nightly logical backup of the recircuit database (NFR-10, FR-12.4).
#   ops/backup.sh                  one backup into ./backups (or $BACKUP_DIR)
# Schedule it with cron, for example at 02:30 every night:
#   30 2 * * *  cd /path/to/ReCircuit && ops/backup.sh >> backups/backup.log 2>&1
# Environment: BACKUP_DIR (default ./backups), BACKUP_KEEP_DAYS (default 14), COMPOSE (default "docker compose").
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-backups}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"
COMPOSE="${COMPOSE:-docker compose}"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
target="${BACKUP_DIR}/recircuit-${stamp}.dump"

mkdir -p "$BACKUP_DIR"
# custom format: compressed, and pg_restore can restore it selectively or in parallel
$COMPOSE exec -T db pg_dump -U postgres -Fc --no-password recircuit > "${target}.partial"
mv "${target}.partial" "$target"
# a dump that cannot be listed is not a backup
$COMPOSE exec -T db pg_restore --list < "$target" > /dev/null
echo "backup written: ${target} ($(wc -c < "$target" | tr -d ' ') bytes)"

find "$BACKUP_DIR" -name 'recircuit-*.dump' -mtime +"$KEEP_DAYS" -print -delete
