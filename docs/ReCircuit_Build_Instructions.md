# ReCircuit — Complete Build Instructions for Claude Code

### A drift-proof, task-by-task playbook aligned to *ReCircuit Technical Deep-Dive (TRD) v1.0*

*V Rohith Pranov · 24BCE0619 · BCSE302P Database Systems Lab · 05-Oct-2026 · v1.0*

---

> **Purpose.** This playbook builds ReCircuit — a component-level digital product passport for e-waste on PostgreSQL 16, FastAPI and React — in 30 self-contained tasks. Each task is a prompt you paste into Claude Code. Each one names the only files it may touch, says what not to do, and ends with VERIFY commands whose output proves it is done.

> **Alignment guarantee.** The source of truth is `docs/ReCircuit_Technical_Deep_Dive.md` (the TRD). Every table, column, trigger, procedure, view, SQLSTATE and API type in this playbook is copied from it. **If any prompt here disagrees with the TRD, the TRD wins** — with one exception: the five errata in §B.0, which were found by running the TRD's SQL on PostgreSQL 16.13 and are corrections *to* the TRD. Requirement IDs (FR-x.y, NFR-x) refer to `docs/ReCircuit_PRD.md`; rule IDs (C1–C10) refer to both.

## Contents

- §A. Operating Contract
- §B. Canonical Specifications
- §C. How these prompts prevent the three failure modes
- §D. The Build — task-by-task prompts (Phases 0–6)
- §E. Build order
- §F. Final acceptance

---

## §A. Operating Contract — paste this into `CLAUDE.md` first

```markdown
# CLAUDE.md — ReCircuit standing instructions (obey every session)

## What ReCircuit is
A component-level digital product passport for e-waste. Every physical part (device, board,
battery, storage, memory, display, chip) is a `unit` with a QR passport. PostgreSQL 16 records
which unit was inside which, when (assembly periods); an append-only, SHA-256 hash-chained event
ledger; custody manifests between organisations; and EPR certificates where each recycled unit
backs at most one certificate. FastAPI is a thin, role-aware transport. React is the UI.

## GROUND TRUTH (never change without an explicit instruction from Rohith)
- Spec: docs/ReCircuit_Technical_Deep_Dive.md (TRD). Requirements: docs/ReCircuit_PRD.md.
  Playbook: docs/ReCircuit_Build_Instructions.md. TRD wins over PRD; playbook §B.0 errata win over TRD.
- THE DATABASE IS THE FINAL AUTHORITY. Business rules C1–C10 live in PostgreSQL constraints and
  triggers. Never re-implement a rule in Python or TypeScript as a substitute; the UI may PRE-CHECK
  for UX only, and the database decision is always final.
- Nothing "current" is stored. No status/holder/current_parent columns. Current state comes from
  v_unit_current.
- All writes to ledger tables go through the sp_* routines in §B.3. The API never runs INSERT,
  UPDATE or DELETE directly.
- Module boundaries: db/ owns schema and rules; api/ owns transport, auth, error mapping;
  web/ owns presentation; seed/ uses the same sp_* routines as the API.

## THE INVIOLABLE INVARIANT
No code path, role or migration may UPDATE or DELETE a row of lifecycle_event or audit_log, or
weaken constraints C1–C10. If a task seems to need this, STOP and ask.

## ANTI-HALLUCINATION RULES (hard)
1. Never invent a table, column, routine, SQLSTATE, endpoint or type. Use only the names in
   playbook §B. If you need one that is not there, stop and ask one question.
2. Before using any library API (psycopg 3, FastAPI, pyjwt, passlib, slowapi, qrcode, pgTAP,
   testcontainers, dbmate, html5-qrcode, TanStack Query, Playwright, k6), read its official docs
   in this session (or the installed package source) and use the signatures you actually saw.
   Never write a call from memory.
3. Verify every package exists and its version installs before adding it. Record versions in
   docs/stack.lock.md.
4. Import shared types; never redefine them. TS types live only in web/src/api/types.ts;
   Pydantic models only in api/app/schemas.py; both mirror §B.2 field for field.
5. PostgreSQL PROCEDUREs are invoked with CALL; FUNCTIONs with SELECT. Check §B.3's "kind"
   column, never guess.
6. Never fabricate output. Paste real command output when reporting VERIFY results. If a
   command fails, say so.

## ANTI-DRIFT RULES (hard)
1. Touch only the files the current task lists under "Files you may touch".
2. No unrelated refactors, renames, reformatting or "improvements".
3. SQL copied from the TRD stays byte-identical except where §B.0 errata say otherwise.
4. Names in code = names in §B, exactly (snake_case in SQL/Python, same field names in TS).
5. One task at a time, in dependency order. Do not start a task whose `depends:` are not done.

## QUALITY GATES
- SQL: migrations are dbmate files with `-- migrate:up` / `-- migrate:down`; every SECURITY
  DEFINER routine has `SET search_path = public`; every rule violation raises the SQLSTATE in §B.4.
- Python 3.12: ruff + mypy --strict clean; parameterised SQL only (no f-strings with user data);
  validate every request with Pydantic.
- TypeScript: strict mode, eslint clean, no `any`.
- Timestamps: TIMESTAMPTZ in DB, ISO-8601 with offset over HTTP. Never create future-dated
  events in seed or tests (the database refuses them by design).

## WORKING METHOD
1. Restate the task goal in one line and list the files you will touch.
2. Plan; then implement only what the task asks.
3. Run the task's VERIFY commands; paste the real output.
4. Add or extend a test for the behaviour you built.
5. One commit per task: `T<id>: <title>` (conventional, imperative).
6. Update docs/PROGRESS.md: tick the task, note anything deferred.

## DEFINITION OF DONE (per task)
VERIFY passes with real output shown · tests added and green · lint/type checks clean ·
only allowed files changed (`git diff --stat`) · committed · PROGRESS.md updated.
```

---

## §B. Canonical Specifications (single source of truth)

### B.0 Errata to TRD v1.0 (verified on PostgreSQL 16.13, 05-Oct-2026)

These corrections were found by executing the TRD's SQL. They **override** the TRD text, and the TRD should be updated to match.

| # | TRD location | Problem (observed) | Correction (binding) |
| --- | --- | --- | --- |
| E1 | §2.1 request pipeline | Calls every routine with `SELECT * FROM fn(...)`. PostgreSQL refuses: *"sp_harvest(...) is a procedure — To call a procedure, use CALL."* | The allow-list in §B.3 records each routine's kind; the pipeline uses `CALL` for procedures and `SELECT` for functions |
| E2 | §5, §8, §10, §11 staff views | Ordinary views run with the owner's rights and **bypass RLS**: a role that saw 0 manifests through the table saw 2 through a plain view | Every view read by staff roles is created `WITH (security_invoker = true)`; roles get `SELECT` on the base tables, so RLS applies |
| E3 | §12 `v_public_passport` | `public_reader` got *"permission denied for table lifecycle_event"*: functions inside a view run as the caller | `sp_verify_chain` and `fn_latest_health` are `SECURITY DEFINER SET search_path = public`. Verified: `public_reader` reads the view (health 86) and is still denied on `unit` |
| E4 | §3 grants | `REVOKE … FROM rc_owner`, but `rc_owner` is never created | Migration 001 creates `rc_owner LOGIN` (the migration and object owner). C3's trigger, not the REVOKE, is the real guard, because an owner can re-grant itself |
| E5 | §3–§10 routine list | `sp_create_unit`, `sp_bulk_create_units`, `sp_record_tests`, `sp_register_model`, `sp_set_materials`, `sp_set_target`, `sp_create_transfer`, `sp_issue_certificate`, `sp_allocate_certificate` and `sp_admin_*` are named but not defined | Their signatures and contracts are fixed in §B.3 below; bodies are written in Task T1.6 |

Already applied in TRD v1.0 and **must be kept**: `sp_dismantle` records COLLECTED before HARVESTED (§6); `event_transition` includes `('DIAGNOSED','REINSTALLED')` and `v_reuse_inventory` uses the widened WHERE clause (§14); `fn_latest_health` (§12); trigger names `trg_event_10_transition` / `trg_event_20_chain` (§7).

### B.1 Environment variables (`.env.example`)

```bash
# --- database ---
POSTGRES_PASSWORD=change-me-superuser            # docker postgres superuser (bootstrap only)
RC_OWNER_PASSWORD=change-me-owner                # rc_owner: runs migrations, owns all objects
RC_APP_PASSWORD=change-me-app                    # rc_app: the API's NOINHERIT login role
MIGRATION_DATABASE_URL=postgres://rc_owner:change-me-owner@db:5432/recircuit?sslmode=disable
DATABASE_URL=postgresql://rc_app:change-me-app@db:5432/recircuit
# --- api ---
JWT_SECRET=change-me-32-bytes-minimum
JWT_ACCESS_TTL_MIN=15
JWT_REFRESH_TTL_DAYS=7
BCRYPT_ROUNDS=12
LOGIN_MAX_FAILURES=5
LOGIN_LOCK_MINUTES=15
PUBLIC_BASE_URL=http://localhost:5173            # QR codes encode ${PUBLIC_BASE_URL}/p/{passport_uid}
PUBLIC_RATE_LIMIT=30/minute
CORS_ORIGINS=http://localhost:5173
SERIALIZABLE_RETRIES=3
# --- web ---
VITE_API_BASE_URL=http://localhost:8000/api/v1
```

### B.2 Domain types (verbatim from TRD §5, §10, §12, plus the error shape)

```ts
// web/src/api/types.ts — the ONLY place these TS types are defined
export type Category  = 'DEVICE'|'BOARD'|'BATTERY'|'STORAGE'|'MEMORY'|'DISPLAY'|'CHIP'|'OTHER';
export type EventType = 'MANUFACTURED'|'SOLD'|'COLLECTED'|'DIAGNOSED'|'HARVESTED'
                      | 'REFURBISHED'|'REINSTALLED'|'RECYCLED'|'DISPOSED';
export type Role      = 'PRODUCER'|'COLLECTOR'|'TECHNICIAN'|'RECYCLER_OPERATOR'|'AUDITOR'|'ADMIN';
export type OrgType   = 'PRODUCER'|'COLLECTOR'|'DISMANTLER'|'REFURBISHER'|'RECYCLER';
export type TestResult = 'PASS'|'DEGRADED'|'FAIL';
export type Condition  = 'WORKING'|'FAULTY'|'SCRAP';

export interface UnitPassport {
  unit_id: number;
  passport_uid: string;            // UUID
  serial_no: string;
  manufactured_on: string | null;  // ISO date
  model: { model_id: number; model_number: string; category: Category; mass_g: number;
           manufacturer: string; spec: Record<string, unknown>;
           materials: { material_name: string; mass_mg: number; is_critical: boolean }[] };
  current_state: EventType | null;
  state_since: string | null;      // ISO timestamp
  current_holder: { org_id: number; org_name: string } | null;
  current_parent: { unit_id: number; passport_uid: string; model_number: string } | null;
  chain_verified: boolean;         // from sp_verify_chain
}

export interface PublicPassport {
  passport_uid: string;
  model_number: string; category: Category; manufacturer: string;
  manufactured_on: string | null;
  current_state: EventType | null;
  history: { type: EventType; date: string }[];
  latest_health: number | null;
  chain_verified: boolean;
}

export interface IssueCertificateRequest {
  cert_no: string;                 // e.g. "RC-REC-2026-000412"
  category: string;                // e.g. "ITEW2"  (CPCB EEE code; free text in v1.0)
  quantity_kg: number;
  financial_year: string;          // "2026-27"
  issued_on: string;               // ISO date
  units: { unit_id: number; recovered_mass_g: number }[];
}

export interface ApiError {        // PRD §11 error shape
  error: { code: string; constraint: string | null; message: string };
}
```

Pydantic models in `api/app/schemas.py` mirror these field for field (same names, same optionality; `Literal[...]` for the unions).

### B.3 Database routines and API routes (the allow-list)

**Kind** decides how the API invokes it (E1). "TRD" = body copied verbatim from the TRD; "B.3" = body written in T1.6 to the contract here.

| Routine | Kind | Signature | Returns | Contract | Body |
| --- | --- | --- | --- | --- | --- |
| `sp_record_event` | PROCEDURE | `(p_unit BIGINT, p_type VARCHAR, p_at TIMESTAMPTZ, p_facility INT, p_corrects BIGINT DEFAULT NULL)` | — | Facility must belong to `rc.org_id` (RC013); actor = `rc.actor_id` | TRD §7 |
| `sp_harvest` | PROCEDURE | `(p_unit BIGINT, p_at TIMESTAMPTZ, p_facility INT)` | — | HARVESTED event; C6 closes link | TRD §7 |
| `sp_dismantle` | PROCEDURE | `(p_device BIGINT, p_parts JSONB, p_at TIMESTAMPTZ, p_facility INT)` | — | `p_parts = [{model_id, serial_no}]`; COLLECTED-then-HARVESTED per part | TRD §6 |
| `sp_reinstall` | PROCEDURE | `(p_unit BIGINT, p_new_parent BIGINT, p_at TIMESTAMPTZ, p_facility INT)` | — | Opens a period, then REINSTALLED | TRD §6 |
| `sp_receive_transfer` | PROCEDURE | `(p_transfer BIGINT, p_at TIMESTAMPTZ, p_missing BIGINT[] DEFAULT '{}', p_extra BIGINT[] DEFAULT '{}')` | — | Receiver only (RC014) | TRD §9 |
| `sp_record_tests` | PROCEDURE | `(p_unit BIGINT, p_at TIMESTAMPTZ, p_facility INT, p_tests JSONB)` | — | Calls `sp_record_event(…,'DIAGNOSED',…)` then inserts each `{test_type, result, measured_value, health_score}` against that event | B.3 |
| `sp_set_materials` | PROCEDURE | `(p_model INT, p_materials JSONB)` | — | Model's manufacturer must be `rc.org_id`; replaces composition `[{material_id, mass_mg}]` (catalogue is reference data) | B.3 |
| `sp_set_target` | PROCEDURE | `(p_category VARCHAR, p_fy CHAR(7), p_target_kg NUMERIC)` | — | Upsert into `epr_target` for producer `rc.org_id` | B.3 |
| `sp_allocate_certificate` | PROCEDURE | `(p_cert BIGINT, p_producer INT)` | — | Issuer = `rc.org_id`; only if `producer_id IS NULL`, else RC015; producer org_type must be PRODUCER (RC016); writes `audit_log` `CERT_ALLOCATE` | B.3 |
| `sp_admin_set_actor_active` | PROCEDURE | `(p_actor INT, p_active BOOLEAN)` | — | Writes `audit_log` `ACTOR_DEACTIVATE`/`ACTOR_ACTIVATE` | B.3 |
| `sp_create_unit` | FUNCTION | `(p_model INT, p_serial VARCHAR, p_manufactured_on DATE DEFAULT NULL, p_parent BIGINT DEFAULT NULL)` | `BIGINT` unit_id | With `p_parent`, also opens a period at `now()` (no event) | B.3 |
| `sp_bulk_create_units` | FUNCTION | `(p_units JSONB)` | `BIGINT[]` | Array of `{model_id, serial_no, manufactured_on?, parent_unit_id?}`; all-or-nothing | B.3 |
| `sp_register_model` | FUNCTION | `(p_model_number VARCHAR, p_category VARCHAR, p_mass_g NUMERIC, p_spec JSONB DEFAULT '{}')` | `INT` model_id | Manufacturer = `rc.org_id`; spec keys checked against TRD §4 list (RC012) | B.3 |
| `sp_create_transfer` | FUNCTION | `(p_manifest_no VARCHAR, p_to_org INT, p_shipped_at TIMESTAMPTZ, p_total_mass_kg NUMERIC, p_items JSONB)` | `BIGINT` transfer_id | Sender = `rc.org_id`; items `[{unit_id, declared_condition}]`; C8 applies | B.3 |
| `sp_issue_certificate` | FUNCTION | `(p_cert_no VARCHAR, p_category VARCHAR, p_quantity_kg NUMERIC, p_fy CHAR(7), p_issued_on DATE, p_units JSONB)` | `BIGINT` cert_id | Recycler = `rc.org_id`; units `[{unit_id, recovered_mass_g}]`; C9/C10; writes `audit_log` `CERT_ISSUE`; caller runs SERIALIZABLE | B.3 |
| `sp_admin_create_org` | FUNCTION | `(p_name VARCHAR, p_type VARCHAR, p_cpcb VARCHAR, p_gstin CHAR(15))` | `INT` org_id | Writes `audit_log` | B.3 |
| `sp_admin_create_facility` | FUNCTION | `(p_org INT, p_name VARCHAR, p_pincode CHAR(6), p_capacity NUMERIC DEFAULT NULL)` | `INT` facility_id | — | B.3 |
| `sp_admin_create_actor` | FUNCTION | `(p_facility INT, p_name VARCHAR, p_role VARCHAR, p_email VARCHAR, p_password_hash TEXT)` | `INT` actor_id | Hash computed in Python; writes `audit_log` `ACTOR_CREATE` | B.3 |
| `sp_refresh_material_recovery` | PROCEDURE | `()` | — | `REFRESH MATERIALIZED VIEW CONCURRENTLY mv_material_recovery`; granted to `rc_admin` only | B.3 |
| `fn_auth_lookup` | FUNCTION | `(p_email VARCHAR)` | `TABLE(actor_id INT, org_id INT, role VARCHAR, password_hash TEXT, is_active BOOLEAN)` | Granted to `rc_auth` only; used before a user exists | B.3 |
| `sp_verify_chain` | FUNCTION | `(p_unit BIGINT)` | `BIGINT` (NULL = intact) | SECURITY DEFINER (E3) | TRD §7 |
| `fn_part_tree` | FUNCTION | `(p_root BIGINT, p_as_of TIMESTAMPTZ DEFAULT now())` | `TABLE(depth, unit_id, parent_unit_id, serial_no, model_number, category)` | — | TRD §6 |
| `fn_latest_health` | FUNCTION | `(p_unit BIGINT)` | `SMALLINT` | SECURITY DEFINER (E3) | TRD §12 |

All `sp_*` routines are `SECURITY DEFINER SET search_path = public`, owned by `rc_owner`.

**Routes (base `/api/v1`)** — each calls exactly one routine/view inside one transaction:

| Method & path | Role(s) | DB object | FR |
| --- | --- | --- | --- |
| `POST /auth/login`, `/auth/refresh`, `/auth/logout` | anonymous → staff | `fn_auth_lookup` (as `rc_auth`) | FR-1.1–1.2 |
| `GET/POST /organizations`, `POST /organizations/{id}/facilities`, `GET/POST/PATCH /actors` | ADMIN | `sp_admin_*` | FR-2 |
| `GET/POST /models`, `PUT /models/{id}/materials` | PRODUCER (write), staff (read) | `sp_register_model`, `sp_set_materials` | FR-3 |
| `POST /units`, `POST /units/bulk` | PRODUCER, COLLECTOR | `sp_create_unit`, `sp_bulk_create_units` | FR-4.1, 4.6 |
| `GET /units/{passport_uid}` | staff | `v_unit_passport` + tab queries | FR-4.3–4.4 |
| `GET /units/{id}/qr` | staff | — (PNG from `passport_uid`) | FR-4.2 |
| `GET /units/{id}/tree?as_of=` | staff | `fn_part_tree` | FR-5.5–5.6 |
| `GET /units/{id}/history` | staff | `assembly_link` | FR-5.7 |
| `POST /units/{id}/dismantle` / `harvest` / `reinstall` | COLLECTOR, TECHNICIAN | `sp_dismantle` / `sp_harvest` / `sp_reinstall` | FR-5.1–5.8 |
| `GET/POST /units/{id}/events` | staff / PRODUCER, COLLECTOR, TECHNICIAN, RECYCLER_OPERATOR | `lifecycle_event` / `sp_record_event` | FR-6 |
| `POST /units/{id}/tests` | TECHNICIAN | `sp_record_tests` | FR-7.1–7.2 |
| `GET /inventory/reuse?category=&min_health=` | TECHNICIAN | `v_reuse_inventory` | FR-7.3 |
| `GET/POST /transfers`, `POST /transfers/{id}/receive` | COLLECTOR, TECHNICIAN, RECYCLER_OPERATOR | `sp_create_transfer`, `sp_receive_transfer` | FR-8 |
| `GET/POST /certificates`, `POST /certificates/{id}/allocate` | RECYCLER_OPERATOR (write); PRODUCER, AUDITOR (read) | `sp_issue_certificate`, `sp_allocate_certificate`, `v_certificate_backing` | FR-9 |
| `GET/PUT /compliance/{producer_id}` | PRODUCER, AUDITOR | `v_epr_compliance`, `sp_set_target` | FR-9.6 |
| `GET /reports/{name}?format=csv` | role-dependent | Q1–Q8 (TRD §11) | FR-10 |
| `GET /audit/verify?unit=`, `GET /audit/log` | AUDITOR, ADMIN | `sp_verify_chain`, `audit_log` | FR-10.8, 12.2 |
| `GET /public/p/{passport_uid}` | anonymous | `v_public_passport` | FR-11 |

Role → database role map (fixed): login (no user yet) `→rc_auth`, `PRODUCER→rc_producer`, `COLLECTOR→rc_collector`, `TECHNICIAN→rc_technician`, `RECYCLER_OPERATOR→rc_recycler`, `AUDITOR→rc_auditor`, `ADMIN→rc_admin`, anonymous→`public_reader`.

### B.4 Datastore object names and error catalogue

**Tables (18):** `organization`, `facility`, `actor`, `part_model`, `material`, `model_material`, `unit`, `assembly_link`, `lifecycle_event`, `event_transition`, `diagnostic_test`, `custody_transfer`, `transfer_item`, `transfer_discrepancy`, `epr_certificate`, `certificate_unit`, `epr_target`, `audit_log`.

**Views:** `v_unit_current`, `v_unit_passport`, `v_reuse_inventory`, `v_certificate_backing`, `v_epr_compliance` (all `security_invoker = true`, E2) · `v_public_passport` (owner-rights, `security_barrier = true`) · `mv_material_recovery` (materialized).

**Triggers:** `trg_asm_no_cycle` (C2) · `trg_event_10_transition` (C5) · `trg_event_20_chain` (C4) · `trg_event_harvest` (C6) · `trg_event_immutable`, `trg_audit_immutable` (C3) · `trg_test_event_type` (C7) · `trg_transfer_one_open` (C8) · `trg_cert_unit_recycled` (C9) · `trg_cert_quantity`, `trg_cert_quantity_head` (C10b). C1 = constraint `assembly_link_excl`; C10a = `certificate_unit_pkey`.

**Error catalogue** (TRD §16.1, plus RC015/RC016 for `sp_allocate_certificate`):

| SQLSTATE | API code | HTTP | Rule |
| --- | --- | --- | --- |
| `23P01` on `assembly_link_excl` | `ASM_OVERLAP` | 409 | C1 |
| `RC002` | `ASM_CYCLE` | 409 | C2 |
| `RC003` | `HISTORY_IMMUTABLE` | 409 | C3 |
| `RC005` | `ILLEGAL_TRANSITION` | 422 | C5 |
| `RC006` | `HARVEST_NOT_INSTALLED` | 409 | C6 |
| `RC007` | `TEST_WRONG_EVENT` | 409 | C7 |
| `RC008` | `TRANSFER_ALREADY_OPEN` | 409 | C8 |
| `RC009` | `CERT_UNIT_NOT_RECYCLED` | 409 | C9 |
| `23505` on `certificate_unit_pkey` | `CERT_UNIT_REUSED` | 409 | C10a |
| `RC010` | `CERT_OVERCLAIM` | 409 | C10b |
| `RC011` | `EVENT_OUT_OF_ORDER` | 422 | C5 |
| `RC012` | `SPEC_KEY_UNKNOWN` | 400 | — |
| `RC013` | `FACILITY_NOT_YOURS` | 403 | — |
| `RC014` | `TRANSFER_NOT_OPEN` | 409 | — |
| `RC015` | `CERT_ALREADY_ALLOCATED` | 409 | EPR-5 |
| `RC016` | `NOT_A_PRODUCER` | 422 | EPR-5 |
| `42501` | `FORBIDDEN` | 403 | FR-1.4 |
| `40001` | retried, then `CONFLICT_RETRY` | 409 | NFR-4 |
| `23514` (CHECK) | `INVALID_VALUE` | 400 | — |
| other `23505` | `DUPLICATE` | 409 | — |

### B.5 Repository structure (fixed)

```text
recircuit/
├── CLAUDE.md                          # §A, verbatim
├── docker-compose.yml                 # db, api, web
├── .env.example                       # §B.1
├── docs/
│   ├── ReCircuit_PRD.md
│   ├── ReCircuit_Technical_Deep_Dive.md
│   ├── ReCircuit_Build_Instructions.md
│   ├── PROGRESS.md                    # task checklist (T0.1 creates)
│   ├── stack.lock.md                  # verified versions (T0.1)
│   ├── traceability.csv               # FR/NFR → object → test (T6.3)
│   └── plans/                         # EXPLAIN ANALYZE outputs (T2.2)
├── db/
│   ├── migrations/                    # dbmate: 001_…013_ (TRD §16.2 order; procedures split into 009 + 010)
│   ├── tests/                         # pgTAP: t01_…sql
│   └── fixtures/walkthrough.sql       # TRD §14 scenario, past dates
├── api/
│   ├── pyproject.toml
│   ├── app/
│   │   ├── main.py  config.py  db.py  auth.py  errors.py  schemas.py  allowlist.py
│   │   └── routers/ auth.py admin.py catalogue.py units.py transfers.py certificates.py reports.py public.py
│   └── tests/                         # pytest + testcontainers
├── seed/
│   ├── __main__.py  profiles.py  world.py
├── web/
│   ├── package.json  vite.config.ts  tailwind.config.ts
│   └── src/
│       ├── api/ types.ts  client.ts
│       ├── auth/  components/  routes/   # S1–S13 (PRD §13)
│       └── main.tsx
├── e2e/                               # Playwright: f1…f5.spec.ts
└── loadtest/passport.js               # k6
```

### B.6 Pinned stack (confirm latest compatible in-session, then lock in `docs/stack.lock.md`)

| Layer | Package / tool | Constraint |
| --- | --- | --- |
| Database | PostgreSQL | **16.x** (image `postgres:16`); extensions `pgcrypto`, `btree_gist` only |
| Migrations | dbmate | latest stable |
| DB tests | pgTAP | installed into the test database; verify `CREATE EXTENSION pgtap` works on the image (install package if missing) |
| API runtime | Python | **3.12** |
| API | fastapi, uvicorn, pydantic v2, psycopg[binary,pool] **3.x**, pyjwt, passlib[bcrypt], qrcode[pil], slowapi | latest compatible; if passlib warns against the installed bcrypt, pin bcrypt to the newest version passlib supports and record why |
| API tests | pytest, pytest-asyncio, httpx, testcontainers[postgres] | latest compatible |
| Lint/types | ruff, mypy | strict |
| Web | Node **20 LTS**, React **18**, TypeScript, Vite, Tailwind CSS, @tanstack/react-query, react-router, html5-qrcode, recharts | latest compatible with React 18 |
| E2E / load | @playwright/test, k6 | latest |
| CI | GitHub Actions | ubuntu-latest |

---

## §C. How these prompts prevent the three failure modes

| Failure mode | What causes it | Mechanism in this playbook |
| --- | --- | --- |
| **Hallucination** | Inventing APIs, table names, error codes, library calls | §A rule "read official docs in-session"; every name lives in §B; routine kind (CALL vs SELECT) is listed, not guessed; VERIFY demands real output |
| **Errors** | Untested SQL, wrong privileges, silent rule gaps | §B.0 errata come from executing the spec; pgTAP negative tests (T1.8) land **before** any API or UI; every task ends in VERIFY |
| **Drift** | Re-deriving types, wandering refactors, rules re-implemented in app code | "Files you may touch" per task; explicit `Do NOT`; SQL byte-copied from the TRD; types defined once (§B.2); the invariant and "database is the final authority" in CLAUDE.md |

---

## §D. The Build — task-by-task prompts

Do all **[P0]** tasks first, in order. Paste one prompt at a time.

### PHASE 0 — Foundation

### T0.1 · Repo scaffold, CLAUDE.md and stack lock — `/` · [P0] · depends: —

> **PROMPT**
> Goal: create the empty repository skeleton from §B.5 with standing instructions and a verified stack.
> Files you may touch: `CLAUDE.md`, `.env.example`, `.gitignore`, `docs/PROGRESS.md`, `docs/stack.lock.md`, `README.md`, and empty directories from §B.5 (with `.gitkeep`).
> Requirements:
> 1. Write `CLAUDE.md` with the exact contents of §A (copy, do not edit).
> 2. Write `.env.example` with the exact variables of §B.1.
> 3. Create every directory in §B.5; add `.gitkeep` where empty.
> 4. `docs/PROGRESS.md`: one unchecked line per task T0.1–T6.5 from this playbook.
> 5. For each package in §B.6, check that it exists and find the latest compatible version (`pip index versions …`, `npm view … version`, official release pages). Write the chosen versions and the date checked to `docs/stack.lock.md`.
> 6. Copy `ReCircuit_PRD.md`, `ReCircuit_Technical_Deep_Dive.md` and this file into `docs/`.
> Do NOT write any application code, SQL, or package manifests yet.
> **VERIFY:** `ls -R | head -60` matches §B.5; `diff <(sed -n '/^```markdown/,/^```$/p' docs/ReCircuit_Build_Instructions.md | sed '1d;$d') CLAUDE.md` prints nothing; `docs/stack.lock.md` lists every §B.6 package with a version.

---

### T0.2 · Docker Compose with PostgreSQL 16 and role bootstrap — `docker-compose.yml`, `db/` · [P0] · depends: T0.1

> **PROMPT**
> Goal: one command brings up PostgreSQL 16 with the `recircuit` database and the two login roles.
> Files you may touch: `docker-compose.yml`, `db/bootstrap/00_roles.sh`, `README.md` (setup section only).
> Requirements:
> 1. Service `db` uses image `postgres:16`, a named volume, healthcheck `pg_isready`, and `.env`.
> 2. `db/bootstrap/00_roles.sh` (mounted at `/docker-entrypoint-initdb.d/`) creates database `recircuit`, role `rc_owner LOGIN` with `RC_OWNER_PASSWORD` that owns database `recircuit` (E4), and role `rc_app LOGIN NOINHERIT` with `RC_APP_PASSWORD`. Nothing else.
> 3. Placeholder services `api` and `web` are commented out until T3.2 and T4.1.
> Do NOT create tables, extensions or other roles here; migrations own those.
> **VERIFY:** `docker compose up -d db && docker compose exec db psql -U rc_owner -d recircuit -Atc "select current_user, version()"` prints `rc_owner|PostgreSQL 16…`; `docker compose exec db psql -U postgres -Atc "select rolname, rolinherit from pg_roles where rolname in ('rc_owner','rc_app') order by 1"` prints `rc_app|f` and `rc_owner|t`.

---

### PHASE 1 — The database (the core domain and its safety layer)

> **Rule for all Phase 1 tasks:** SQL comes from the TRD section named, **copied byte for byte**, then wrapped in dbmate `-- migrate:up` / `-- migrate:down`. Every `-- migrate:down` drops exactly what its `up` created, in reverse order. Run migrations as `rc_owner` with `dbmate --url "$MIGRATION_DATABASE_URL" up`.

### T1.1 · Migrations 001–003: extensions, identity, catalogue — `db/migrations/` · [P0] · depends: T0.2

> **PROMPT**
> Goal: create the reference-data foundation.
> Files you may touch: `db/migrations/001_extensions.sql`, `002_identity.sql`, `003_catalogue.sql`.
> Requirements:
> 1. 001: the two `CREATE EXTENSION` lines from TRD §2.1 ("Extensions").
> 2. 002: from TRD §3 "Data model", the first SQL block only: tables `organization`, `facility`, `actor` and functions `fn_org_of_facility`, `fn_ctx_org`, `fn_ctx_role`. Keep `PRODUCER` in `actor.role` (TRD role note).
> 3. 003: TRD §4 SQL block (`part_model`, its GIN index, `material`, `model_material`), plus a SQL-callable copy of the spec-key list as function `fn_spec_keys(p_category VARCHAR) RETURNS TEXT[]` returning the arrays in the TRD §4 JSON block exactly.
> Do NOT add roles, grants or RLS (that is T3.1), and do NOT add columns not in the TRD.
> **VERIFY:** `dbmate up` succeeds; `psql -Atc "\dt"` lists exactly the 6 tables; `psql -Atc "select fn_spec_keys('BATTERY')"` prints `{chemistry,capacity_mAh,nominal_V,cycle_rating}`; `dbmate rollback` ×3 then `dbmate up` succeeds (down migrations work).

---

### T1.2 · Migration 004: unit and assembly graph (C1, C2) — `db/migrations/004_unit_assembly.sql` · [P0] · depends: T1.1

> **PROMPT**
> Goal: units and time-bounded assembly with overlap and cycle prevention.
> Files you may touch: `db/migrations/004_unit_assembly.sql`.
> Requirements:
> 1. `CREATE TABLE unit` exactly as in TRD §5 (table only, no views).
> 2. TRD §6 first SQL block: `assembly_link` with constraint `assembly_link_excl`, index `assembly_link_parent`, function `fn_asm_no_cycle`, trigger `trg_asm_no_cycle`.
> Do NOT create `fn_part_tree`, `sp_dismantle` or `sp_reinstall` here (they depend on later objects).
> **VERIFY:** `dbmate up`; then in psql: insert 2 units of a seeded model; insert link (A in B, 2026-01-01); a second overlapping link for A must fail with `assembly_link_excl`; link B into A at 2026-02-01 must fail with SQLSTATE `RC002` (`\set VERBOSITY verbose` shows the code). Paste both errors.

---

### T1.3 · Migration 005: event ledger (C3–C6) and audit log — `db/migrations/005_event_ledger.sql` · [P0] · depends: T1.2

> **PROMPT**
> Goal: the append-only, hash-chained ledger with legal transitions.
> Files you may touch: `db/migrations/005_event_ledger.sql`.
> Requirements:
> 1. From TRD §7: table `lifecycle_event`, index `lifecycle_event_unit_time`, table `event_transition` and its full INSERT, then append `INSERT INTO event_transition VALUES ('DIAGNOSED','REINSTALLED');` (TRD §14 fix).
> 2. Table `audit_log` from TRD §13 (must exist before `trg_audit_immutable`).
> 3. From TRD §7: `fn_event_transition`, `fn_event_chain`, `fn_event_digest`, triggers `trg_event_10_transition`, `trg_event_20_chain`, `fn_event_harvest` + `trg_event_harvest`, `fn_event_immutable` + `trg_event_immutable` + `trg_audit_immutable`, `sp_record_event`, `sp_harvest`, `sp_verify_chain`.
> 4. Apply E3: `sp_verify_chain` gets `SECURITY DEFINER SET search_path = public`. Every `sp_*` here gets `SET search_path = public`.
> Do NOT add any UPDATE/DELETE path, and do NOT change the digest input format (it is part of the hash contract).
> **VERIFY:** `dbmate up`; `psql -Atc "select count(*) from event_transition"` prints `24`; `psql -Atc "select tgname from pg_trigger where tgrelid='lifecycle_event'::regclass and not tgisinternal order by 1"` prints the four `trg_event_*` triggers; `UPDATE lifecycle_event SET event_type=event_type` raises `RC003`.

---

### T1.4 · Migrations 006–008: diagnostics, custody, EPR (C7–C10) — `db/migrations/` · [P0] · depends: T1.3

> **PROMPT**
> Goal: the remaining ledger tables and their rules.
> Files you may touch: `db/migrations/006_diagnostics.sql`, `007_custody.sql`, `008_epr.sql`.
> Requirements:
> 1. 006: TRD §8 `diagnostic_test`, its index, `fn_test_event_type`, `trg_test_event_type` (no view here).
> 2. 007: TRD §9 `custody_transfer`, `transfer_item` + index, `transfer_discrepancy`, `fn_transfer_one_open` + trigger, `sp_receive_transfer` (with `SET search_path = public`).
> 3. 008: TRD §10 `epr_certificate`, `certificate_unit` + index, `epr_target`, `fn_cert_unit_recycled` + trigger, `fn_cert_quantity`, both constraint triggers. Views are T1.7.
> Do NOT create views or the Q7 query here.
> **VERIFY:** `dbmate up`; `psql -Atc "select count(*) from information_schema.tables where table_schema='public' and table_type='BASE TABLE'"` prints `18`.

---

### T1.5 · Migration 009: assembly procedures from the TRD — `db/migrations/009_procedures.sql` · [P0] · depends: T1.4

> **PROMPT**
> Goal: the TRD-defined multi-step routines.
> Files you may touch: `db/migrations/009_procedures.sql`.
> Requirements:
> 1. Copy from TRD §6: `fn_part_tree`, `sp_dismantle` (the version that records COLLECTED before HARVESTED), `sp_reinstall`.
> 2. `sp_dismantle` reads `v_unit_current`, which is created later (011). That is fine: PL/pgSQL resolves table and view names when the procedure first runs, not when it is created. `fn_part_tree` is `LANGUAGE sql` and is validated at creation, so it must come after `unit`, `assembly_link` and `part_model` (it does).
> 3. Add `SET search_path = public` to each `sp_*`.
> Do NOT write the §B.3 "B.3"-bodied routines here; that is T1.6.
> **VERIFY:** `dbmate up` succeeds; `psql -Atc "select proname, prokind from pg_proc where proname in ('fn_part_tree','sp_dismantle','sp_reinstall') order by 1"` prints `fn_part_tree|f`, `sp_dismantle|p`, `sp_reinstall|p`.

---

### T1.6 · Migration 010: routines defined by contract (E5) — `db/migrations/010_procedures_contract.sql` · [P0] · depends: T1.5

> **PROMPT**
> Goal: implement every §B.3 routine whose Body column says "B.3".
> Files you may touch: `db/migrations/010_procedures_contract.sql`, `db/tests/t09_contract_routines.sql`.
> Requirements:
> 1. Implement exactly these, with the exact names, kinds, parameter names, defaults and return types in §B.3: `sp_record_tests`, `sp_set_materials`, `sp_set_target`, `sp_allocate_certificate`, `sp_admin_set_actor_active`, `sp_create_unit`, `sp_bulk_create_units`, `sp_register_model`, `sp_create_transfer`, `sp_issue_certificate`, `sp_admin_create_org`, `sp_admin_create_facility`, `sp_admin_create_actor`, `sp_refresh_material_recovery`, `fn_auth_lookup`. (`sp_refresh_material_recovery` references `mv_material_recovery`, created in 011 — PL/pgSQL resolves it at run time.)
> 2. All are `SECURITY DEFINER SET search_path = public`. Organisation/actor come from `rc.org_id`/`rc.actor_id`, never from parameters (except admin routines).
> 3. Writes to ledger tables go through existing routines where one exists (`sp_record_tests` calls `sp_record_event`).
> 4. Raise RC012, RC015, RC016 exactly as in §B.4.
> 5. `sp_issue_certificate` inserts the certificate, then its units, then one `audit_log` row; it does not set the isolation level (the caller does).
> 6. pgTAP file tests one success and one failure per routine.
> Do NOT add parameters, rename anything, or re-check C1–C10 in these bodies (the triggers do it).
> **VERIFY:** `dbmate up`; `pg_prove -d recircuit db/tests/t09_contract_routines.sql` → `All tests successful`.

---

### T1.7 · Migrations 011–012: views and indexes (E2) — `db/migrations/011_views.sql`, `012_indexes.sql` · [P0] · depends: T1.6

> **PROMPT**
> Goal: every derived view, with RLS-respecting options.
> Files you may touch: `db/migrations/011_views.sql`, `db/migrations/012_indexes.sql`.
> Requirements:
> 1. Copy from TRD: `v_unit_current`, `v_unit_passport` (§5); `v_reuse_inventory` (§8) **with the widened WHERE from §14**; `v_certificate_backing`, `v_epr_compliance` (§10); `mv_material_recovery` + its unique index (§11); `fn_latest_health` + `v_public_passport` (§12).
> 2. Apply E2: add `WITH (security_invoker = true)` to `v_unit_current`, `v_unit_passport`, `v_reuse_inventory`, `v_certificate_backing`, `v_epr_compliance`. Keep `v_public_passport` owner-rights with `security_barrier = true`.
> 3. Apply E3: `fn_latest_health` gets `SECURITY DEFINER SET search_path = public`.
> 4. 012: B-tree indexes on every FK column not already indexed (list them in a comment with the query you used to find them).
> 5. Grant to `public_reader` happens in T3.1, not here.
> Do NOT change any view's column list or names.
> **VERIFY:** `dbmate up`; `psql -Atc "select relname, reloptions from pg_class where relname like 'v\_%' order by 1"` shows `security_invoker=true` on the five staff views and `security_barrier=true` on `v_public_passport`.

---

### T1.8 · pgTAP safety suite: C1–C10 and the walkthrough — `db/tests/`, `db/fixtures/` · [P0] · depends: T1.7

> **PROMPT**
> Goal: prove every integrity rule before anything is built on top of the database.
> Files you may touch: `db/tests/t01_rules.sql` … `t08_*.sql`, `db/fixtures/walkthrough.sql`, `Makefile` (target `db-test` only).
> Requirements:
> 1. `db/fixtures/walkthrough.sql`: the TRD §14 scenario as SQL, using **past** dates (e.g. September 2026), setting `rc.actor_id`/`rc.org_id`/`rc.role` with `set_config` before each actor's steps.
> 2. One pgTAP test per row of TRD §16.4, using `throws_ok(sql, 'SQLSTATE', …)` for refusals and `is(…)`/`results_eq(…)` for successes: T-C1, T-C2, T-C3 (UPDATE and DELETE), T-C4/Q8 (tamper as superuser with the trigger disabled, then re-enable), T-C5, T-C5b, T-C6, T-C7, T-C8, T-C9, T-C10a, T-C10b, RC013, EPR happy path, part tree on a past date, reuse inventory health 86.
> 3. Add T-C6 explicitly: a COLLECTED loose unit (never installed) → `sp_harvest` raises `RC006`.
> 4. Each test runs in a transaction that rolls back (except where COMMIT is needed for C10b — use a savepoint-free separate test file and clean up).
> 5. `make db-test` runs all files with `pg_prove`.
> Do NOT weaken a constraint to make a test pass. If a test fails, report it and stop.
> **VERIFY:** `make db-test` → `All tests successful.` with the total test count printed.

---

### PHASE 2 — Seed data and query evidence

### T2.1 · Deterministic seed generator — `seed/` · [P0] · depends: T1.8

> **PROMPT**
> Goal: `small` and `large` synthetic worlds created only through §B.3 routines.
> Files you may touch: `seed/**`, `api/pyproject.toml` (add the seed's dependencies only).
> Requirements:
> 1. `python -m seed --profile small|large --seed N [--jobs K]`; profiles exactly as TRD §13 (small ≈ 500 units / 4,000 events; large 50,000 units / ≈ 500,000 events).
> 2. Connect as `rc_owner` for admin routines; for each simulated actor, `set_config('rc.actor_id'|'rc.org_id'|'rc.role', …, true)` then call routines (CALL for procedures, SELECT for functions per §B.3).
> 3. All event timestamps strictly in the past and non-decreasing per unit.
> 4. Organisation names are clearly fictional (e.g. "Demo Recycler 03"); emails use `example.com`.
> 5. Same seed → identical row counts and identical `md5(string_agg(event_hash::text, '' order by event_id))`.
> Do NOT insert into tables directly, and do NOT disable triggers.
> **VERIFY:** `python -m seed --profile small --seed 42` twice on fresh DBs prints identical counts and identical hash digest; `make db-test` still green.

---

### T2.2 · Query evidence for Q1–Q8 — `docs/plans/` · [P0] · depends: T2.1

> **PROMPT**
> Goal: show each report uses indexes and meets NFR-6 on the `large` seed.
> Files you may touch: `docs/plans/*.txt`, `db/migrations/012_indexes.sql` (only to add a missing index, with justification), `db/queries/q7_custody_gaps.sql`.
> Requirements:
> 1. Load `--profile large --seed 42`; `ANALYZE`.
> 2. Save `EXPLAIN (ANALYZE, BUFFERS)` for Q1 (passport by `passport_uid`), Q2 (`fn_part_tree` body as plain SQL for a device), Q3, Q4, Q6, Q7 (copy the TRD §9 query to `db/queries/q7_custody_gaps.sql`) and one `sp_verify_chain` call.
> 3. Record execution times in `docs/plans/SUMMARY.md` against NFR-6 targets (passport < 200 ms, part tree < 300 ms).
> Do NOT rewrite a view to make a plan look better; if a target is missed, add an index only, then report.
> **VERIFY:** `docs/plans/SUMMARY.md` table shows each query's time and plan node (Index Scan / Bitmap / Seq); Q1 and Q2 under target.

---

### PHASE 3 — Access and the API

### T3.1 · Migration 013: roles, grants, RLS — `db/migrations/013_roles_rls.sql` · [P0] · depends: T1.8

> **PROMPT**
> Goal: least-privilege roles so the database refuses what a role may not do.
> Files you may touch: `db/migrations/013_roles_rls.sql`, `db/tests/t10_roles.sql`.
> Requirements:
> 1. Create `rc_auth`, `rc_producer`, `rc_collector`, `rc_technician`, `rc_recycler`, `rc_auditor`, `rc_admin`, `public_reader` (NOLOGIN) and grant them all to `rc_app` (TRD §3). `rc_auth` gets EXECUTE on `fn_auth_lookup` and nothing else.
> 2. `REVOKE ALL ON ALL TABLES/FUNCTIONS/PROCEDURES IN SCHEMA public FROM PUBLIC`.
> 3. `GRANT EXECUTE` on each routine exactly per the TRD §3 permission matrix; `rc_auditor`/`rc_admin` read everything; staff roles get `SELECT` on base tables they read through `security_invoker` views (E2).
> 4. Enable RLS and add `FOR SELECT` policies on `custody_transfer`, `transfer_item` (via its transfer), `transfer_discrepancy`, `epr_certificate`, `certificate_unit` (via its certificate), `epr_target`, using the TRD §3 pattern.
> 5. `GRANT SELECT ON v_public_passport TO public_reader` and nothing else for `public_reader`.
> 6. `REVOKE UPDATE, DELETE ON lifecycle_event, audit_log` from every role (C3 trigger remains the real guard, E4).
> Do NOT grant INSERT/UPDATE/DELETE on any table to any `rc_*` role.
> **VERIFY:** `pg_prove db/tests/t10_roles.sql` proves: `SET ROLE rc_technician; INSERT INTO epr_certificate …` → 42501; collector of org A sees 0 of org B's manifests via table **and** via a staff view; `SET ROLE public_reader` reads `v_public_passport` (health 86 in the walkthrough fixture) and gets 42501 on `unit`.

---

### T3.2 · API skeleton: config, pipeline, error mapper — `api/` · [P0] · depends: T3.1

> **PROMPT**
> Goal: the FastAPI transport with the one database pipeline and the one error mapper.
> Files you may touch: `api/pyproject.toml`, `api/app/main.py`, `config.py`, `db.py`, `errors.py`, `allowlist.py`, `api/Dockerfile`, `docker-compose.yml` (enable `api`), `api/tests/test_pipeline.py`.
> Requirements:
> 1. Read psycopg 3 pool and transaction docs in-session before writing `db.py`.
> 2. `allowlist.py`: a dict of every §B.3 routine → `("PROCEDURE"|"FUNCTION", ordered param names)`; nothing else is callable.
> 3. `db.run(claims, routine, **params)`: one transaction; `SET LOCAL ROLE` from the §B.3 role map; `set_config('rc.actor_id'|'rc.org_id'|'rc.role', …, true)`; `CALL` or `SELECT * FROM` per allow-list (E1); parameters bound, never interpolated. Optional `isolation="serializable"` with retry on `40001` up to `SERIALIZABLE_RETRIES`.
> 4. `errors.py`: map SQLSTATE (+ constraint name for 23P01/23505) to the §B.4 catalogue and the `ApiError` shape; unknown DB errors → 500 with a generic message (log the detail server-side only).
> 5. `GET /api/v1/health` returns DB version.
> Do NOT add endpoints beyond `/health` in this task; do NOT add an ORM.
> **VERIFY:** `docker compose up -d api && curl -s localhost:8000/api/v1/health` shows PostgreSQL 16; `pytest api/tests/test_pipeline.py` proves a procedure is CALLed, a function is SELECTed, and RC005 maps to HTTP 422 `ILLEGAL_TRANSITION`.

---

### T3.3 · Authentication — `api/app/auth.py`, `routers/auth.py` · [P0] · depends: T3.2

> **PROMPT**
> Goal: login, refresh, logout and role guards (FR-1.1–1.3, 1.6).
> Files you may touch: `api/app/auth.py`, `api/app/routers/auth.py`, `api/app/schemas.py` (auth models only), `api/tests/test_auth.py`.
> Requirements:
> 1. Read pyjwt and passlib docs in-session. Hash with bcrypt, rounds = `BCRYPT_ROUNDS`.
> 2. Login calls `fn_auth_lookup` through `db.run` with role `rc_auth` and no `rc.*` context; generic 401 on any failure; lock after `LOGIN_MAX_FAILURES` in `LOGIN_LOCK_MINUTES` (in-memory, documented as single-instance).
> 3. Access JWT (`JWT_ACCESS_TTL_MIN`) with `actor_id`, `org_id`, `role`; refresh token single-use rotation in an httpOnly cookie.
> 4. Dependency `require_roles(*roles)` used by all later routers.
> 5. Deactivated actors (`is_active = false`) cannot log in.
> Do NOT store tokens or passwords in plaintext anywhere, including logs.
> **VERIFY:** `pytest api/tests/test_auth.py` covers: good login, wrong password (401), 6th failure locked, refresh rotation (old refresh rejected), deactivated user rejected.

---

### T3.4 · Routers: catalogue, units, assembly, events, tests — `api/app/routers/` · [P0] · depends: T3.3

> **PROMPT**
> Goal: endpoints for FR-3 to FR-7 exactly as in §B.3 routes.
> Files you may touch: `api/app/routers/catalogue.py`, `units.py`, `api/app/schemas.py` (models from §B.2 only), `api/tests/test_units.py`.
> Requirements:
> 1. Implement only the routes in §B.3 for models, units, tree, history, dismantle, harvest, reinstall, events, tests, reuse inventory, QR.
> 2. `GET /units/{passport_uid}` returns `UnitPassport` (§B.2) built from `v_unit_passport` + materials + `sp_verify_chain`.
> 3. QR: read the `qrcode` docs; encode `${PUBLIC_BASE_URL}/p/{passport_uid}`; return `image/png`.
> 4. Every write = one `db.run` call.
> Do NOT compute state, holder or parent in Python; read them from views.
> **VERIFY:** `pytest api/tests/test_units.py` runs flow F1 + F2 via HTTP against a testcontainers DB: dismantle → tests (86) → reuse inventory lists the battery → reinstall 201 → duplicate reinstall 409 `ASM_OVERLAP`.

---

### T3.5 · Routers: transfers, certificates, compliance — `api/app/routers/` · [P0] · depends: T3.4

> **PROMPT**
> Goal: endpoints for FR-8 and FR-9.
> Files you may touch: `api/app/routers/transfers.py`, `certificates.py`, `api/app/schemas.py` (`IssueCertificateRequest` only), `api/tests/test_epr.py`.
> Requirements:
> 1. Routes per §B.3; `POST /certificates` calls `sp_issue_certificate` with `isolation="serializable"`.
> 2. Allocation, compliance read and target upsert per §B.3.
> 3. A concurrency test: 20 parallel requests issue certificates over the same 5 recycled units → exactly 1 success; the rest 409 (`CERT_UNIT_REUSED` or `CONFLICT_RETRY`).
> Do NOT check backing or reuse in Python.
> **VERIFY:** `pytest api/tests/test_epr.py` green, including the concurrency test and a 409 `CERT_OVERCLAIM`.

---

### T3.6 · Routers: reports, audit, admin, public — `api/app/routers/` · [P0] · depends: T3.5

> **PROMPT**
> Goal: FR-2, FR-10, FR-11, FR-12.2 endpoints.
> Files you may touch: `api/app/routers/reports.py`, `admin.py`, `public.py`, `api/tests/test_reports.py`, `api/tests/test_public.py`.
> Requirements:
> 1. `GET /reports/{name}` for exactly: `passport`, `part-tree`, `current-state`, `reuse-inventory`, `material-recovery`, `certificate-backing`, `custody-gaps`, `tamper-check`; `?format=csv` streams CSV with identical rows.
> 2. `/audit/verify` loops `sp_verify_chain` in batches of 1,000 units.
> 3. Public route runs as `public_reader` with no JWT, reads only `v_public_passport`, returns `PublicPassport`; read slowapi docs and apply `PUBLIC_RATE_LIMIT`; 60 s in-memory cache.
> 4. A daily asyncio task CALLs `sp_refresh_material_recovery` through `db.run` with a system context of role `rc_admin` (the API never holds `rc_owner` credentials).
> Do NOT expose `unit_id` or any staff field in the public response.
> **VERIFY:** `pytest api/tests/test_reports.py api/tests/test_public.py` green; a test asserts the public JSON keys equal the `PublicPassport` keys exactly; 31 requests in a minute → the 31st returns 429.

---

### PHASE 4 — The web portal

### T4.1 · Web scaffold, types, API client, auth — `web/` · [P0] · depends: T3.3

> **PROMPT**
> Goal: React 18 + Vite + Tailwind app shell with login and role routing.
> Files you may touch: `web/**` except `web/src/routes/*` screens beyond Login and a role home stub; `docker-compose.yml` (enable `web`).
> Requirements:
> 1. `web/src/api/types.ts` = §B.2 verbatim.
> 2. `client.ts`: typed fetch wrapper; on `ApiError` show `error.message` in a toast; 401 → refresh once → login.
> 3. Screen S1 Login; after login route to the role's dashboard path.
> 4. Event-type colour map (one constant), always paired with the label.
> Do NOT add a state-management library beyond TanStack Query.
> **VERIFY:** `npm run build` and `npm run lint` clean; `npx tsc --noEmit` clean; manual login as each seeded role lands on its own route (screenshot list in PROGRESS.md).

---

### T4.2 · Unit passport (S7) and public passport (S8) — `web/src/routes/` · [P0] · depends: T4.1, T3.6

> **PROMPT**
> Goal: the two passport screens.
> Files you may touch: `web/src/routes/passport/**`, `web/src/routes/public/**`, `web/src/components/PartTree.tsx`, `Timeline.tsx`.
> Requirements:
> 1. S7 tabs: Overview, Parts tree (date picker defaulting to now; re-queries `/tree?as_of=`), Timeline, Tests, Custody, Certificates.
> 2. S8 at `/p/:passportUid`: no auth bundle; shows `PublicPassport` with a "chain verified" badge.
> 3. QR scan via html5-qrcode (read its docs); manual passport ID fallback.
> Do NOT derive state client-side.
> **VERIFY:** builds clean; on the walkthrough fixture, S7 for battery shows parent laptop 51007 and, with date 2026-01-01, parent 50991; S8 shows health 86.

---

### T4.3 · Collector (S2) and technician (S3) workbenches — `web/src/routes/` · [P0] · depends: T4.2

> **PROMPT**
> Goal: intake, dismantle, test, harvest, reinstall, reuse inventory.
> Files you may touch: `web/src/routes/collector/**`, `web/src/routes/technician/**`.
> Requirements:
> 1. S2: scan → COLLECTED; Dismantle form (parts list) → `/dismantle`; create manifest.
> 2. S3: scan part → record tests; harvest; reinstall (pick target device); reuse inventory table filterable by category and min health.
> 3. DB refusals appear as plain-language messages (e.g. "This battery is still inside device …").
> Do NOT disable a button based on a client-side guess of a database rule, except as a hint.
> **VERIFY:** Playwright smoke (`e2e/f1.spec.ts`, `f2.spec.ts`) passes against the dev stack.

---

### T4.4 · Recycler (S4) and certificate wizard (S10) — `web/src/routes/` · [P0] · depends: T4.3

> **PROMPT**
> Goal: receive manifests, record recycling, issue and allocate certificates.
> Files you may touch: `web/src/routes/recycler/**`.
> Requirements:
> 1. S4: incoming manifests; receive with missing/extra pickers; recycle queue.
> 2. S10: details → pick recycled units with a running backed-kg total → confirm; Issue disabled until backed ≥ claimed (hint only; DB decides).
> 3. Allocate to a producer.
> Do NOT compute compliance client-side.
> **VERIFY:** `e2e/f3.spec.ts` passes, including a forced over-claim showing `CERT_OVERCLAIM`.

---

### T4.5 · Auditor (S6) and remaining screens — `web/src/routes/` · [P1] · depends: T4.4

> **PROMPT**
> Goal: S5 producer, S6 auditor, S9 manifest, S11 catalogue, S12 reports, S13 admin.
> Files you may touch: `web/src/routes/producer/**`, `auditor/**`, `manifest/**`, `catalogue/**`, `reports/**`, `admin/**`.
> Requirements:
> 1. S6: tamper check (one unit / all), certificate backing, custody gaps, audit log.
> 2. S12: Q1–Q8 with CSV download.
> 3. S11: model form with spec keys from the TRD §4 list per category.
> Do NOT add screens not listed in PRD §13.
> **VERIFY:** `e2e/f4.spec.ts`, `f5.spec.ts` pass; Lighthouse accessibility ≥ 90 on S6 and S8.

---

### PHASE 5 — Hardening and evidence

### T5.1 · End-to-end flows F1–F5 — `e2e/` · [P0] · depends: T4.4

> **PROMPT**
> Goal: the PRD §14 flows run unattended in a browser.
> Files you may touch: `e2e/**`, `Makefile` (target `e2e`).
> Requirements: one spec per flow F1–F5 against a freshly seeded `small` DB; assert both success paths and the refusals named in each flow.
> Do NOT seed by direct SQL; use `python -m seed`.
> **VERIFY:** `make e2e` → 5 passed.

---

### T5.2 · Load and concurrency evidence — `loadtest/` · [P0] · depends: T3.6, T2.1

> **PROMPT**
> Goal: measure NFR-3, NFR-4 and NFR-6.
> Files you may touch: `loadtest/**`, `docs/plans/SUMMARY.md` (append results).
> Requirements: read k6 docs; script `GET /units/{passport_uid}` and `/tree` on the `large` seed; record p95; link the T3.5 concurrency test result.
> Do NOT tune by caching staff endpoints.
> **VERIFY:** k6 summary pasted; passport p95 < 200 ms, tree p95 < 300 ms.

---

### PHASE 6 — Delivery

### T6.1 · CI pipeline — `.github/workflows/ci.yml` · [P0] · depends: T5.1

> **PROMPT**
> Goal: every push runs migrations, pgTAP, pytest, web build/lint, and e2e.
> Files you may touch: `.github/workflows/ci.yml`.
> Requirements: PostgreSQL 16 service; dbmate up; `make db-test`; `pytest`; `npm ci && npm run build && npm run lint`; Playwright on main only.
> Do NOT skip a failing step.
> **VERIFY:** a pushed commit shows a green run (link in PROGRESS.md).

### T6.2 · README and one-command setup — `README.md` · [P0] · depends: T6.1

> **PROMPT**
> Goal: a fresh clone runs with `cp .env.example .env && docker compose up`.
> Files you may touch: `README.md`, `Makefile` (target `demo`).
> Requirements: setup, seed, demo logins (fictional), how to run each test suite, architecture diagram (Mermaid from TRD §2).
> **VERIFY:** on a second machine or clean clone: `make demo` reaches the login page with seeded data.

### T6.3 · Traceability matrix — `docs/traceability.csv` · [P0] · depends: T6.1

> **PROMPT**
> Goal: SM-6 — every P0 requirement linked to a passing test.
> Files you may touch: `docs/traceability.csv`, `scripts/check_traceability.py`, `.github/workflows/ci.yml` (add the check step).
> Requirements: columns `requirement_id,priority,db_object_or_endpoint,test_ids,status`; script fails if any P0 row has no test or a failing test.
> **VERIFY:** `python scripts/check_traceability.py` → `P0 coverage 100%`.

### T6.4 · Backup and restore drill — `ops/` · [P2] · depends: T6.2

> **PROMPT**
> Goal: NFR-10 / FR-12.4.
> Files you may touch: `ops/backup.sh`, `ops/RESTORE.md`.
> Requirements: `pg_dump -Fc` nightly; documented restore into an empty DB followed by `make db-test`.
> **VERIFY:** restore drill output pasted in `ops/RESTORE.md`.

### T6.5 · Spec sync — `docs/` · [P0] · depends: T6.3

> **PROMPT**
> Goal: the three documents describe what was built.
> Files you may touch: `docs/ReCircuit_PRD.md`, `docs/ReCircuit_Technical_Deep_Dive.md`.
> Requirements: apply errata E1–E5 to the TRD text; in the PRD, list `event_transition` as reference data, add `('DIAGNOSED','REINSTALLED')` and the widened reuse rule (FR-7.3, §11.3), add PRODUCER to staff roles, rename the C4/C5 triggers.
> Do NOT change requirement IDs.
> **VERIFY:** `grep -n "SELECT \* FROM {fn}" docs/ReCircuit_Technical_Deep_Dive.md` returns nothing; `grep -c "DIAGNOSED.*REINSTALLED" docs/ReCircuit_PRD.md` ≥ 1.

---

## §E. Build order

| Window (PRD §17) | Tasks | Outcome |
| --- | --- | --- |
| Oct 5–11 | T0.1, T0.2, T1.1, T1.2, T1.3, T1.4 | Database up; 18 tables; C1–C10 objects exist |
| Oct 12–18 | T1.5, T1.6, T1.7, T1.8 | All routines and views; pgTAP safety suite green |
| Oct 19–25 | T2.1, T2.2, T3.1 | Seeded worlds; EXPLAIN evidence; roles and RLS proven |
| Oct 26–Nov 1 | T3.2, T3.3, T3.4, T3.5, T3.6 | Full API with auth, error mapping, concurrency proof |
| Nov 2–8 | T4.1, T4.2, T4.3, T4.4, (T4.5) | Portal screens for F1–F5 |
| Nov 9–14 | T5.1, T5.2, T6.1, T6.2, T6.3, T6.5, (T6.4) | E2E, load numbers, CI, README, traceability, synced docs |
| Nov 16 | — | Final review demo |

---

## §F. Final acceptance — "it's built" when every box is ticked

- [ ] `docker compose up` on a clean clone → login page with seeded `small` world
- [ ] `make db-test` → all pgTAP tests pass, including every row of TRD §16.4
- [ ] `pytest` → green, including the 20-way certificate concurrency test
- [ ] `make e2e` → F1–F5 pass
- [ ] `docs/plans/SUMMARY.md` → passport p95 < 200 ms, part tree p95 < 300 ms on the `large` seed
- [ ] As `rc_technician`, a direct `INSERT INTO epr_certificate` → permission denied
- [ ] As `public_reader`, `v_public_passport` readable and `unit` denied
- [ ] Superuser edit of one event → `/audit/verify` reports it; public page shows "chain not verified"
- [ ] `python scripts/check_traceability.py` → P0 coverage 100%
- [ ] PRD and TRD updated to match the build (T6.5); no errata outstanding
- [ ] No `UPDATE`/`DELETE` on `lifecycle_event` or `audit_log` anywhere in `db/`, `api/`, `seed/` (`grep -rniE "(update|delete from) +(lifecycle_event|audit_log)"` finds only the immutability trigger and tests)
