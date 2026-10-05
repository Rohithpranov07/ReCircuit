-- migrate:up
-- B-tree indexes on every foreign-key column that is not already the leading column of an index.
-- The list below came from this query, run after migration 011:
--
--   SELECT c.conrelid::regclass AS tbl, a.attname AS col
--   FROM pg_constraint c
--   JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
--   WHERE c.contype = 'f'
--     AND NOT EXISTS (SELECT 1 FROM pg_index i
--                     WHERE i.indrelid = c.conrelid AND i.indkey[0] = c.conkey[1])
--   ORDER BY 1, 2;
CREATE INDEX facility_org_id                  ON facility (org_id);
CREATE INDEX actor_facility_id                ON actor (facility_id);
CREATE INDEX model_material_material_id       ON model_material (material_id);
CREATE INDEX lifecycle_event_actor_id         ON lifecycle_event (actor_id);
CREATE INDEX lifecycle_event_corrects_event   ON lifecycle_event (corrects_event_id);
CREATE INDEX lifecycle_event_facility_id      ON lifecycle_event (facility_id);
CREATE INDEX audit_log_actor_id               ON audit_log (actor_id);
CREATE INDEX custody_transfer_from_org_id     ON custody_transfer (from_org_id);
CREATE INDEX custody_transfer_to_org_id       ON custody_transfer (to_org_id);
CREATE INDEX transfer_discrepancy_noted_by    ON transfer_discrepancy (noted_by);
CREATE INDEX transfer_discrepancy_unit_id     ON transfer_discrepancy (unit_id);
CREATE INDEX epr_certificate_producer_id      ON epr_certificate (producer_id);
CREATE INDEX epr_certificate_recycler_id      ON epr_certificate (recycler_id);

-- migrate:down
DROP INDEX epr_certificate_recycler_id;
DROP INDEX epr_certificate_producer_id;
DROP INDEX transfer_discrepancy_unit_id;
DROP INDEX transfer_discrepancy_noted_by;
DROP INDEX custody_transfer_to_org_id;
DROP INDEX custody_transfer_from_org_id;
DROP INDEX audit_log_actor_id;
DROP INDEX lifecycle_event_facility_id;
DROP INDEX lifecycle_event_corrects_event;
DROP INDEX lifecycle_event_actor_id;
DROP INDEX model_material_material_id;
DROP INDEX actor_facility_id;
DROP INDEX facility_org_id;
