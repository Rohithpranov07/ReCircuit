# Query evidence — `large` seed (NFR-6, NFR-7)

Dataset: `python -m seed --profile large --seed 42 --jobs 4`, followed by `ANALYZE`.
50,046 units · 519,962 events · 316,135 diagnostic tests · 35,320 manifests · 492 certificates.
Environment: PostgreSQL 16.15 in Docker (aarch64, macOS host), default configuration, warm cache
(each statement was run once to warm, the saved plan is the second run). Full plans sit next to this file.
No view was rewritten to improve a plan.

| Query | File | Execution time | Main access paths | Target | Result |
| --- | --- | --- | --- | --- | --- |
| Q1 passport, step 1: resolve `passport_uid` → `unit_id` | `q1a_passport_resolve_uid.txt` | 0.05 ms | Index Scan `unit_passport_uid_key` | — | — |
| Q1 passport, step 2: `v_unit_passport WHERE unit_id` | `q1b_passport_by_unit_id.txt` | 0.36 ms | Index Scans on every table (`unit_pkey`, `lifecycle_event_unit_time`, `transfer_item_unit`, `assembly_link_excl`, …) | p95 < 200 ms | **met** |
| Q1 passport, direct: `v_unit_passport WHERE passport_uid` | `q1_passport.txt` | 215 ms | Seq Scan `transfer_item`/`custody_transfer`, full window scan of `lifecycle_event` | p95 < 200 ms | **missed** (see note 1) |
| Q2 part tree (recursive CTE, device 4827 on 2025-06-01, 5 parts) | `q2_part_tree.txt` | 0.23 ms | Index Scan `assembly_link_parent` (both recursion arms), `unit_pkey` | p95 < 300 ms | **met** |
| Q3 current state of one unit | `q3_current_state_unit.txt` | 0.16 ms | Index Scan `lifecycle_event_unit_time`, `transfer_item_unit` | — | — |
| Q3 current state of every unit, grouped | `q3_current_state_all.txt` | 214 ms | Index Scan `lifecycle_event_unit_time` (window), Seq Scan `transfer_item` | reports < 2 s | **met** |
| Q4 reuse inventory (BATTERY, health ≥ 80) | `q4_reuse_inventory.txt` | 824 ms | Seq Scan `lifecycle_event`/`diagnostic_test` (window over all scored tests), Index Scans on `unit`, `part_model` | US-5 < 1 s | **met** |
| Q6 certificates with backing below the claim | `q6_certificate_backing.txt` | 7.9 ms | Seq Scan `epr_certificate`, `certificate_unit` (492 and 25,658 rows) | reports < 2 s | **met** |
| Q7 custody gaps (`db/queries/q7_custody_gaps.sql`) | `q7_custody_gaps.txt` | 4,625 ms | Seq Scan `lifecycle_event`; Index Scan Backward `lifecycle_event_unit_time` (per row) | reports < 2 s | **missed** (see note 2) |
| Q8 `sp_verify_chain` on the unit with the most events (23) | `q8_verify_chain.txt`, `q8_verify_chain_rows.txt` | 3.5 ms (0.06 ms for the row fetch) | Index Scan Backward `lifecycle_event_unit_time` | — | — |

## Notes

1. **Q1.** `v_unit_passport` joins `v_unit_current`, whose window functions rank every event and every received
   manifest. A predicate on `passport_uid` does not reach those subqueries (it is not a predicate on the window's
   partition key), so the direct form computes the state of all 50,046 units before filtering: 215 ms, over the
   200 ms target. A predicate on `unit_id` *is* pushed into the windows, so the passport query is 0.36 ms.
   The API therefore resolves `passport_uid` to `unit_id` first (one indexed lookup, 0.05 ms) and reads the view
   by `unit_id` — an access pattern, not a view change. T3.4 must follow it; T5.2 measures it end to end.
2. **Q7.** The TRD query evaluates `fn_org_of_facility()` (a `LANGUAGE sql` function with a `FROM`, which PostgreSQL
   does not inline) up to three times per event row plus a correlated "first event" subquery: about 1.5 million
   function calls over 519,962 rows. An index does not remove per-row function cost. A covering index
   `lifecycle_event (unit_id, event_id) INCLUDE (facility_id, occurred_at, event_type)` was tried on this dataset
   and changed nothing (4.66 s and 4.72 s), so it was dropped again and no index was added. Q7 is a P1 report;
   the 2 s target is **not met on the large profile** (the small profile runs it in milliseconds). Possible
   remedies need a schema or query change (store the organisation on the event, or a materialized gap list) and
   are left for an explicit decision rather than made silently here.
3. Q5 (`mv_material_recovery`) is read from a materialized view and is not part of this evidence.
