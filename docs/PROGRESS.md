# ReCircuit — Progress

One line per task from the build playbook. Tick a task only after its VERIFY output has been shown and it is committed.

- [x] T0.1 Repo scaffold, standing instructions and stack lock
- [x] T0.2 Docker Compose with PostgreSQL 16 and role bootstrap
- [ ] T1.1 Migrations 001–003: extensions, identity, catalogue
- [ ] T1.2 Migration 004: unit and assembly graph (C1, C2)
- [ ] T1.3 Migration 005: event ledger (C3–C6) and audit log
- [ ] T1.4 Migrations 006–008: diagnostics, custody, EPR (C7–C10)
- [ ] T1.5 Migration 009: assembly procedures from the TRD
- [ ] T1.6 Migration 010: routines defined by contract (E5)
- [ ] T1.7 Migrations 011–012: views and indexes (E2)
- [ ] T1.8 pgTAP safety suite: C1–C10 and the walkthrough
- [ ] T2.1 Deterministic seed generator
- [ ] T2.2 Query evidence for Q1–Q8
- [ ] T3.1 Migration 013: roles, grants, RLS
- [ ] T3.2 API skeleton: config, pipeline, error mapper
- [ ] T3.3 Authentication
- [ ] T3.4 Routers: catalogue, units, assembly, events, tests
- [ ] T3.5 Routers: transfers, certificates, compliance
- [ ] T3.6 Routers: reports, audit, admin, public
- [ ] T4.1 Web scaffold, types, API client, auth
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
