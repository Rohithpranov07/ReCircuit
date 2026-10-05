#!/usr/bin/env bash
# Restore drill: back up the live database, restore the dump into a new empty database, and prove the copy is
# sound: same row counts, every hash chain verifies, history is still immutable, roles still hold their grants.
#   ops/restore_drill.sh [dump file]     (without an argument it takes a fresh backup first)
set -euo pipefail

COMPOSE="${COMPOSE:-docker compose}"
DUMP="${1:-}"
DB=recircuit_restore
psql_su() { $COMPOSE exec -T db psql -U postgres -v ON_ERROR_STOP=1 -qAt "$@"; }

if [ -z "$DUMP" ]; then
  BACKUP_DIR="${BACKUP_DIR:-backups}" ops/backup.sh | tee /dev/stderr | sed -n 's/^backup written: \([^ ]*\) .*/\1/p' > .drill-dump
  DUMP="$(cat .drill-dump)"; rm -f .drill-dump
fi

echo "== restoring $DUMP into an empty database ($DB)"
psql_su -c "DROP DATABASE IF EXISTS $DB" -c "CREATE DATABASE $DB OWNER rc_owner" >/dev/null 2>&1
$COMPOSE exec -T db pg_restore -U postgres -d "$DB" --no-owner --role=rc_owner --exit-on-error < "$DUMP"

count_sql="SELECT 'organization '||count(*) FROM organization UNION ALL SELECT 'unit '||count(*) FROM unit UNION ALL
  SELECT 'lifecycle_event '||count(*) FROM lifecycle_event UNION ALL SELECT 'custody_transfer '||count(*) FROM custody_transfer UNION ALL
  SELECT 'epr_certificate '||count(*) FROM epr_certificate UNION ALL SELECT 'audit_log '||count(*) FROM audit_log ORDER BY 1"
echo "== row counts, source vs restored"
diff <(psql_su -d recircuit -c "$count_sql") <(psql_su -d "$DB" -c "$count_sql") && psql_su -d "$DB" -c "$count_sql"

echo "== every hash chain in the restored copy"
psql_su -d "$DB" -c "SELECT 'units checked '||count(*)||', broken '||count(*) FILTER (WHERE sp_verify_chain(unit_id) IS NOT NULL) FROM unit"
echo "== history is still append-only in the copy"
psql_su -d "$DB" -c "DO \$\$ BEGIN UPDATE lifecycle_event SET event_type = event_type WHERE event_id = (SELECT min(event_id) FROM lifecycle_event); RAISE EXCEPTION 'update was allowed'; EXCEPTION WHEN SQLSTATE 'RC003' THEN RAISE NOTICE 'UPDATE refused with RC003'; END \$\$" 2>&1 | grep -E "refused|allowed"
echo "== roles and policies survived"
psql_su -d "$DB" -c "SELECT 'rc_technician may read unit: '||has_table_privilege('rc_technician','unit','SELECT'), 'rc_technician may insert certificates: '||has_table_privilege('rc_technician','epr_certificate','INSERT'), 'public_reader may read unit: '||has_table_privilege('public_reader','unit','SELECT'), 'row-level security tables: '||(SELECT count(*) FROM pg_class WHERE relrowsecurity)" | tr '|' '\n'

psql_su -c "DROP DATABASE $DB" >/dev/null
echo "== drill finished; the restored database was dropped"
