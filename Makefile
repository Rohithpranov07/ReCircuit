# Targets are added task by task; see docs/PROGRESS.md.
-include .env
export

DB_HOST_PORT  ?= 5432
DB_CONTAINER  := docker compose exec -T db
PYTHON        ?= api/.venv/bin/python
APP_MIGRATE_URL := postgres://rc_owner:$(strip $(RC_OWNER_PASSWORD))@localhost:$(strip $(DB_HOST_PORT))/recircuit?sslmode=disable
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

.PHONY: e2e
# Starts from nothing: a fresh database, the migrations, the small seed (python -m seed, never direct SQL), the whole
# stack, then the five browser flows F1-F5. WARNING: `down -v` deletes the local database volume.
e2e:
	docker compose down -v
	docker compose up -d --wait db
	DBMATE_MIGRATIONS_TABLE=dbmate.schema_migrations DBMATE_NO_DUMP_SCHEMA=true \
	  dbmate --url "$(APP_MIGRATE_URL)" -d db/migrations up >/dev/null
	$(PYTHON) -m seed --profile small --seed 42 | sed -n '/^profile/,/allocated/p'
	docker compose up -d --build --wait api web
	cd e2e && npm ci && npx playwright install chromium && npx playwright test

.PHONY: demo venv
# One command from a fresh clone: environment file, database, migrations, small demo world, API and web.
demo:
	@test -f .env || cp .env.example .env
	docker compose up -d --build --wait
	@echo
	@echo "ReCircuit is running:  http://localhost:5173   (API http://localhost:8000/api/v1/health)"
	@echo "Demo logins (fictional), password recircuit-demo:"
	@echo "  admin@example.com  auditor@example.com  producer01@example.com  collector01@example.com"
	@echo "  refurbisher01@example.com  recycler01@example.com"

# Python environment for the seed generator, the API tests and the load scripts (Python 3.12).
venv:
	python3.12 -m venv api/.venv
	api/.venv/bin/pip install -q "psycopg[binary,pool]==3.3.6" "faker==40.40.0" "bcrypt==4.0.1" \
	  "fastapi==0.142.2" "uvicorn[standard]==0.54.0" "pydantic==2.13.5" "pyjwt==2.15.1" "passlib[bcrypt]==1.7.4" \
	  "qrcode[pil]==8.2" "slowapi==0.1.10" "pytest==9.1.1" "pytest-asyncio==1.4.0" "httpx==0.28.1" \
	  "testcontainers[postgres]==4.15.0" "ruff==0.16.10" "mypy==2.4.0" "types-passlib==1.7.7.20260211" types-qrcode
