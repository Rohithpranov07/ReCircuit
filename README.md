# ReCircuit

A component-level digital product passport for e-waste, built on PostgreSQL 16, FastAPI and React.
Every physical part is a unit with a QR passport; the database records which unit sat inside which and
when, keeps an append-only hash-chained event ledger, tracks custody between organisations, and ties each
recycled unit to at most one EPR certificate.

Specifications live in [`docs/`](docs): the PRD and the Technical Deep-Dive. Progress is tracked in
[`docs/PROGRESS.md`](docs/PROGRESS.md) and pinned versions in [`docs/stack.lock.md`](docs/stack.lock.md).

Setup instructions are added as the stack comes online.
