# ReCircuit — Progress

One line per task from the build playbook. Tick a task only after its VERIFY output has been shown and it is committed.

- [x] T0.1 Repo scaffold, standing instructions and stack lock
- [x] T0.2 Docker Compose with PostgreSQL 16 and role bootstrap
- [x] T1.1 Migrations 001–003: extensions, identity, catalogue
- [x] T1.2 Migration 004: unit and assembly graph (C1, C2)
- [x] T1.3 Migration 005: event ledger (C3–C6) and audit log
- [x] T1.4 Migrations 006–008: diagnostics, custody, EPR (C7–C10)
- [x] T1.5 Migration 009: assembly procedures from the TRD
- [x] T1.6 Migration 010: routines defined by contract (E5)
- [x] T1.7 Migrations 011–012: views and indexes (E2)
- [x] T1.8 pgTAP safety suite: C1–C10 and the walkthrough
- [x] T2.1 Deterministic seed generator
- [x] T2.2 Query evidence for Q1–Q8
- [x] T3.1 Migration 013: roles, grants, RLS
- [x] T3.2 API skeleton: config, pipeline, error mapper
- [x] T3.3 Authentication
- [x] T3.4 Routers: catalogue, units, assembly, events, tests
- [x] T3.5 Routers: transfers, certificates, compliance
- [x] T3.6 Routers: reports, audit, admin, public
- [x] T4.1 Web scaffold, types, API client, auth
- [ ] T4.2 Unit passport (S7) and public passport (S8)
- [ ] T4.3 Collector (S2) and technician (S3) workbenches
- [ ] T4.4 Recycler (S4) and certificate wizard (S10)
- [ ] T4.5 Auditor (S6) and remaining screens
- [ ] T5.1 End-to-end flows F1–F5
- [ ] T5.2 Load and concurrency evidence
- [ ] T6.1 CI pipeline
- [ ] T6.2 README and one-command setup
- [ ] T6.3 Traceability matrix
- [ ] T6.4 Backup and restore drill
- [ ] T6.5 Spec sync

## Notes

- Deferred / observations are recorded below, newest last.
- T0.2: Docker daemon had to be started manually. rc_owner is created without CREATEROLE per spec; T3.1 (roles migration) needs it, to be handled there.
- T1.1: dbmate runs with DBMATE_MIGRATIONS_TABLE=dbmate.schema_migrations so public holds only domain tables (keeps the 6/18 table counts exact). Host port is configurable via DB_HOST_PORT.
- T1.6: pgTAP lives in the db container (apt: postgresql-16-pgtap, pg_prove) and runs against a scratch database built from the migrations; `make db-test` formalises this in T1.8. The sp_refresh_material_recovery test is skipped until migration 011 exists, and its failure case needs the roles from T3.1 (re-enabled/extended there). Admin routines skip or self-attribute the audit row only when rc.actor_id is unset (first-administrator bootstrap); "not found" admin cases raise 23514 (INVALID_VALUE) because §B.4 has no dedicated code.
- T1.8: `make db-test` builds a scratch database `recircuit_test` from the migrations, installs pgTAP (apt, first use) and runs db/tests/t*.sql: 114 tests, all green. The walkthrough fixture uses past dates (Aug–Sep 2026) and adds a producer-to-collector manifest and a second loose battery so Q7 has no false positives and the reuse inventory has a health-86 entry (a reinstalled battery is correctly no longer loose stock). A self-parent link is refused by the cycle trigger (RC002) before the CHECK runs. T-C10b is covered both with SET CONSTRAINTS (t07) and at a real COMMIT (t07b).
- T2.1: `python -m seed --profile small|large --seed N [--jobs K] [--dsn URL]` (run from the repo root with the venv in api/.venv; the DSN defaults to the rc_owner login on localhost:$DB_HOST_PORT). small: 8 orgs, 40 models, 505 units, 3,763 events; two fresh-database runs print identical counts and event-hash digest. Determinism of ids/hashes holds for --jobs 1; with more jobs scenario content is still identical but ids may differ. Exception to "no direct inserts": the `material` reference rows are inserted directly because no routine exists for them. The seed also plants deliberate custody gaps (no manifest at the recycler) and missing-unit discrepancies so Q7 and the auditor screens have data; Q7 returns exactly the planted gap units on the small profile.
- T2.2: evidence in docs/plans. Two targets missed and reported, not hidden: Q1 queried directly by passport_uid is 215 ms (the API must resolve passport_uid to unit_id first; 0.4 ms), and Q7 custody gaps takes 4.6 s on the large profile (function-call overhead in the TRD query; an index did not help). Decision needed on Q7 (query or schema change) before the traceability matrix is finalised.
- T3.1: roles, grants and RLS (migration 013) with 38 role tests; `make db-test` is at 152 tests, all green. Findings that go into the T6.5 spec sync as errata:
  - E6: erratum E4's `REVOKE UPDATE ... FROM rc_owner` on lifecycle_event cannot be applied: foreign-key checks (diagnostic_test.event_id, corrects_event_id) lock the referenced row with FOR KEY SHARE, which PostgreSQL only allows with UPDATE privilege. The owner keeps UPDATE there; trg_event_immutable refuses it (RC003). DELETE and TRUNCATE are revoked from the owner, and UPDATE/DELETE/TRUNCATE on audit_log from everyone.
  - E7: a security_invoker view nested in an owner-rights view is checked against the calling role, so v_public_passport can no longer join v_unit_current; it reads the latest event itself (same columns and values). public_reader also needs EXECUTE on fn_latest_health and sp_verify_chain (PostgreSQL checks function EXECUTE against the caller); both are SECURITY DEFINER.
  - rc_owner needs CREATEROLE (added to db/bootstrap/00_roles.sh; existing volumes: `ALTER ROLE rc_owner CREATEROLE`). Roles are cluster-wide, so 013 creates them only if missing and its down migration drops them only when nothing else depends on them.
  - Deviations from the TRD matrix, all deliberate: staff roles may also EXECUTE sp_verify_chain and fn_part_tree (the staff passport shows chain_verified); nobody can read actor.password_hash (column-level SELECT); mv_material_recovery has no RLS so only rc_auditor/rc_admin read it; RLS policies are scoped TO the staff roles. The route table lists COLLECTOR for harvest/reinstall but the TRD matrix (enforced here) allows only the technician: T3.4 must follow the matrix.
  - Staff views run as the caller, so v_unit_current's holder is computed from the manifests the caller may see (RLS); it can differ between organisations.
- T3.2: API skeleton in api/app (config, allowlist, db pipeline, errors, health). Routines are called with named notation (`p_unit => %s::bigint`) so omitted arguments use the routine's default. The error mapper additionally maps FK violations (23503) and data exceptions (class 22) to INVALID_VALUE 400 instead of a 500, and request-validation errors to INVALID_VALUE 400. API tests run against a testcontainers PostgreSQL 16 built from the real migrations (needs Docker and dbmate on PATH).
- T3.3: auth in api/app/auth.py and routers/auth.py. A locked account answers exactly like a wrong password (generic 401 INVALID_CREDENTIALS), so lockout is not observable. Refresh sessions and failure counters are in process memory (single instance). bcrypt is pinned to 4.0.1 and confirmed working with passlib 1.7.4 here. app/main.py was touched only to mount the router. Access-token expiry is judged on an injectable clock (tests).
- T3.4: routers for catalogue, units, assembly, events, tests, reuse inventory and QR. The passport reads unit_id by passport_uid first, then the view by unit_id (see docs/plans/SUMMARY.md). Harvest and reinstall are TECHNICIAN-only (TRD matrix, enforced by grants); dismantle is COLLECTOR and TECHNICIAN. `Database.run` gained a `followup` read executed in the same transaction (used to return the new event's hash), and `Database.transaction` runs several reads in one snapshot. Not-found answers use code NOT_FOUND (404), which the §B.4 catalogue does not list. No GET /materials route exists in §B.3, so the catalogue editor (S11) will need the material list from somewhere; flagged for T4.5.
- T3.5: transfers, certificates and compliance routers. The 20-way race test issues 20 certificates over the same 5 recycled units: one 201, nineteen 409 (CERT_UNIT_REUSED or CONFLICT_RETRY). A producer may read and set targets only for its own organisation id (403 otherwise).
- T3.6: reports (Q1-Q8 with CSV), audit verify/log, admin and public routers; daily refresh task (first run at startup, then every 24 h) as rc_admin; 32 API tests green. Role-dependent report access: material-recovery, custody-gaps and tamper-check are AUDITOR/ADMIN; reuse-inventory is TECHNICIAN/AUDITOR/ADMIN; certificate-backing is PRODUCER/RECYCLER/AUDITOR/ADMIN (row-level security scopes it). The 429 body uses the code RATE_LIMITED, which §B.4 does not list. The public passport is cached 60 s per passport and limited to PUBLIC_RATE_LIMIT per IP (in memory, single instance).
- T4.1: web scaffold (Vite 6, React 18, Tailwind 4, TanStack Query) with S1 login, in-memory access token plus httpOnly refresh cookie, a role-guarded router, a single event colour map, and toasts for API refusals. Verified in a real browser (Playwright, headless Chromium) against the seeded small world: admin, auditor, producer01, collector01, refurbisher01 and recycler01 (password recircuit-demo) each land on /admin, /auditor, /producer, /collector, /technician and /recycler. Touched outside web/: api/app/main.py (CORS for CORS_ORIGINS with credentials, required for the cookie flow), docker-compose.yml (web service), e2e/package.json (Playwright, used from T5.1). Tailwind 4 is configured in CSS (@theme in src/index.css), so there is no tailwind.config.ts. `docker compose up --build` now serves the app on :5173 and the API on :8000.
