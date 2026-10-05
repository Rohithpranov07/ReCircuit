# Targets are added task by task; see docs/PROGRESS.md.
-include .env
export

DB_HOST_PORT  ?= 5432
DB_CONTAINER  := docker compose exec -T db
TEST_DB       := recircuit_test
MIGRATE_URL   := postgres://rc_owner:$(strip $(RC_OWNER_PASSWORD))@localhost:$(strip $(DB_HOST_PORT))/$(TEST_DB)?sslmode=disable

.PHONY: db-test
# Builds a scratch database from the migrations, installs pgTAP in it and runs every file in db/tests.
# pgTAP and pg_prove come from the PostgreSQL image's apt repository and are installed on first use.
db-test:
	docker compose up -d --wait db
	$(DB_CONTAINER) bash -c 'command -v pg_prove >/dev/null && dpkg -s postgresql-16-pgtap >/dev/null 2>&1 || \
	  (DEBIAN_FRONTEND=noninteractive apt-get update -qq >/dev/null && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq postgresql-16-pgtap libtap-parser-sourcehandler-pgtap-perl >/dev/null)'
	$(DB_CONTAINER) psql -U postgres -qAtc "DROP DATABASE IF EXISTS $(TEST_DB)" -c "CREATE DATABASE $(TEST_DB) OWNER rc_owner"
	DBMATE_MIGRATIONS_TABLE=dbmate.schema_migrations DBMATE_NO_DUMP_SCHEMA=true \
	  dbmate --url "$(MIGRATE_URL)" -d db/migrations up >/dev/null
	$(DB_CONTAINER) psql -U postgres -d $(TEST_DB) -qAtc "CREATE EXTENSION pgtap"
	$(DB_CONTAINER) rm -rf /tmp/rc
	$(DB_CONTAINER) mkdir -p /tmp/rc/db
	docker compose cp db/tests db:/tmp/rc/db/tests
	docker compose cp db/fixtures db:/tmp/rc/db/fixtures
	$(DB_CONTAINER) bash -c 'cd /tmp/rc/db/tests && pg_prove -U postgres -d $(TEST_DB) t*.sql'
