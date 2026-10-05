# Backup and restore

## What is backed up

`ops/backup.sh` takes a logical backup of the `recircuit` database with `pg_dump -Fc` (custom format: compressed and
selectively restorable). It checks that the dump can be listed, and deletes dumps older than `BACKUP_KEEP_DAYS`
(default 14). Schedule it nightly:

```cron
30 2 * * *  cd /path/to/ReCircuit && ops/backup.sh >> backups/backup.log 2>&1
```

Dumps go to `./backups` (git-ignored). Copy them off the machine; a backup on the same disk is not a backup.

## Restoring

Restore into an **empty** database. The cluster-wide roles (`rc_owner`, `rc_app`, `rc_producer`, …) must already exist; on a
new cluster start the stack once (`docker compose up -d db`) so the bootstrap script and migrations create them.

```bash
docker compose exec -T db psql -U postgres -c "CREATE DATABASE recircuit_restore OWNER rc_owner"
docker compose exec -T db pg_restore -U postgres -d recircuit_restore --no-owner --role=rc_owner --exit-on-error < backups/recircuit-<timestamp>.dump
```

To make the restored database the live one, stop the API, rename the databases (`ALTER DATABASE … RENAME TO …`) and start
the API again. Then run `make db-test`: it builds its own scratch database from the migrations and proves the schema,
rules and roles are all intact.

## Restore drill (run once, 05-Oct-2026)

`ops/restore_drill.sh` automates the check: back up, restore into a new empty database, compare row counts with the
source, recompute every hash chain, confirm history is still append-only and that roles and row-level security survived,
then drop the copy. Output of the run on the seeded small world:

```text
backup written: backups/recircuit-<timestamp>.dump (390322 bytes)
== restoring backups/recircuit-<timestamp>.dump into an empty database (recircuit_restore)
== row counts, source vs restored
audit_log 51
custody_transfer 333
epr_certificate 17
lifecycle_event 3763
organization 8
unit 505
== every hash chain in the restored copy
units checked 505, broken 0
== history is still append-only in the copy
NOTICE:  UPDATE refused with RC003
== roles and policies survived
rc_technician may read unit: true
rc_technician may insert certificates: false
public_reader may read unit: false
row-level security tables: 6
== drill finished; the restored database was dropped
```

`make db-test` afterwards: 172 tests, all successful.

The drill found one real defect, which is fixed: `pg_restore` refreshes materialized views with an empty `search_path`,
and `fn_org_of_facility` named its table unqualified, so `mv_material_recovery` could not be rebuilt. The function now
reads `public.facility` (migration 002).

## Point-in-time recovery (procedure, not exercised here)

A nightly dump restores to the moment of the dump. To restore to any moment, add WAL archiving to PostgreSQL and keep a
base backup:

1. In `postgresql.conf`: `wal_level = replica`, `archive_mode = on`, `archive_command = 'cp %p /archive/%f'` (use object storage in production).
2. Take base backups with `pg_basebackup -U postgres -D /backups/base-<date> -Ft -z -X none`.
3. To recover: restore the base backup into an empty data directory, set `restore_command = 'cp /archive/%f %p'` and
   `recovery_target_time = '<timestamp>'` in `postgresql.conf`, create an empty `recovery.signal` file and start the server.

The drill above exercises the logical backup only. Rehearse the WAL procedure on a spare machine before relying on it.
