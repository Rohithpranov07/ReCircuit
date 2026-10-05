# ReCircuit

A component-level digital product passport for e-waste, built on PostgreSQL 16, FastAPI and React.
Every physical part is a unit with a QR passport; the database records which unit sat inside which and
when, keeps an append-only hash-chained event ledger, tracks custody between organisations, and ties each
recycled unit to at most one EPR certificate.

Specifications live in [`docs/`](docs): the PRD and the Technical Deep-Dive. Progress is tracked in
[`docs/PROGRESS.md`](docs/PROGRESS.md) and pinned versions in [`docs/stack.lock.md`](docs/stack.lock.md).

## Setup

```bash
cp .env.example .env          # then change the passwords
docker compose up -d db       # PostgreSQL 16; first start creates database `recircuit`
                              # and the login roles `rc_owner` (migrations) and `rc_app` (API)
```

The bootstrap script runs only on an empty data volume. To start over:
`docker compose down -v && docker compose up -d db`.

### Migrations

dbmate keeps its bookkeeping table in its own schema so the `public` schema holds only domain objects:

```bash
export DBMATE_MIGRATIONS_TABLE=dbmate.schema_migrations DBMATE_NO_DUMP_SCHEMA=true
dbmate --url "postgres://rc_owner:<RC_OWNER_PASSWORD>@localhost:5432/recircuit?sslmode=disable" -d db/migrations up
```

If port 5432 is already used on your machine, set `DB_HOST_PORT` in `.env` (for example `5433`) and use that port in the URL.

More setup steps are added as the stack comes online.
