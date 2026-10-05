-- migrate:up
-- Views read by staff roles are security_invoker (E2) so row-level security applies to the caller.
CREATE VIEW v_unit_current WITH (security_invoker = true) AS
WITH last_event AS (
  SELECT e.unit_id, e.event_type, e.occurred_at, e.facility_id,
         ROW_NUMBER() OVER (PARTITION BY e.unit_id ORDER BY e.event_id DESC) AS rn
  FROM lifecycle_event e
), last_receipt AS (
  SELECT ti.unit_id, ct.to_org_id,
         ROW_NUMBER() OVER (PARTITION BY ti.unit_id ORDER BY ct.received_at DESC) AS rn
  FROM transfer_item ti JOIN custody_transfer ct USING (transfer_id)
  WHERE ct.received_at IS NOT NULL
)
SELECT u.unit_id, u.passport_uid,
       le.event_type   AS current_state,
       le.occurred_at  AS state_since,
       COALESCE(lr.to_org_id, fn_org_of_facility(le.facility_id)) AS current_holder_org_id
FROM unit u
LEFT JOIN last_event   le ON le.unit_id = u.unit_id AND le.rn = 1
LEFT JOIN last_receipt lr ON lr.unit_id = u.unit_id AND lr.rn = 1;

CREATE VIEW v_unit_passport WITH (security_invoker = true) AS
SELECT u.unit_id, u.passport_uid, u.serial_no, u.manufactured_on,
       m.model_id, m.model_number, m.category, m.mass_g, m.spec,
       o.org_name AS manufacturer,
       c.current_state, c.state_since, c.current_holder_org_id,
       (SELECT a.parent_unit_id FROM assembly_link a
         WHERE a.child_unit_id = u.unit_id AND a.removed_at IS NULL) AS current_parent_id
FROM unit u
JOIN part_model m   ON m.model_id = u.model_id
JOIN organization o ON o.org_id   = m.manufacturer_id
JOIN v_unit_current c ON c.unit_id = u.unit_id;

CREATE VIEW v_reuse_inventory WITH (security_invoker = true) AS
WITH latest_score AS (
  SELECT e.unit_id, t.health_score, t.test_type, e.occurred_at,
         ROW_NUMBER() OVER (PARTITION BY e.unit_id ORDER BY e.event_id DESC, t.test_id DESC) AS rn
  FROM lifecycle_event e JOIN diagnostic_test t ON t.event_id = e.event_id
  WHERE t.health_score IS NOT NULL
)
SELECT c.unit_id, c.passport_uid, m.category, m.model_number,
       s.health_score AS latest_health, s.test_type, s.occurred_at AS tested_at,
       c.current_holder_org_id
FROM v_unit_current c
JOIN unit u        ON u.unit_id = c.unit_id
JOIN part_model m  ON m.model_id = u.model_id
LEFT JOIN latest_score s ON s.unit_id = c.unit_id AND s.rn = 1
WHERE c.current_state = 'HARVESTED'
   OR (c.current_state = 'DIAGNOSED'
       AND NOT EXISTS (SELECT 1 FROM assembly_link a
                       WHERE a.child_unit_id = c.unit_id AND a.removed_at IS NULL)
       AND EXISTS (SELECT 1 FROM assembly_link a WHERE a.child_unit_id = c.unit_id));  -- was once installed

CREATE VIEW v_certificate_backing WITH (security_invoker = true) AS
SELECT c.cert_id, c.cert_no, c.recycler_id, c.producer_id, c.category, c.financial_year,
       c.quantity_kg AS claimed_kg,
       ROUND(COALESCE(SUM(cu.recovered_mass_g),0) / 1000, 3) AS backed_kg,
       COUNT(cu.unit_id) AS unit_count
FROM epr_certificate c LEFT JOIN certificate_unit cu USING (cert_id)
GROUP BY c.cert_id;

CREATE VIEW v_epr_compliance WITH (security_invoker = true) AS
SELECT t.producer_id, t.category, t.financial_year, t.target_kg,
       COALESCE(SUM(c.quantity_kg),0) AS acquired_kg,
       ROUND(100 * COALESCE(SUM(c.quantity_kg),0) / t.target_kg, 1) AS pct_of_target
FROM epr_target t
LEFT JOIN epr_certificate c
  ON c.producer_id = t.producer_id AND c.category = t.category AND c.financial_year = t.financial_year
GROUP BY t.producer_id, t.category, t.financial_year, t.target_kg;

CREATE MATERIALIZED VIEW mv_material_recovery AS
SELECT fn_org_of_facility(e.facility_id)      AS recycler_id,
       date_trunc('quarter', e.occurred_at)   AS quarter,
       mat.material_name, mat.is_critical,
       ROUND(SUM(mm.mass_mg) / 1e6, 3)        AS recovered_kg,
       COUNT(DISTINCT e.unit_id)              AS units
FROM lifecycle_event e
JOIN unit u            ON u.unit_id = e.unit_id
JOIN model_material mm ON mm.model_id = u.model_id
JOIN material mat      ON mat.material_id = mm.material_id
WHERE e.event_type = 'RECYCLED'
GROUP BY 1, 2, 3, 4;
CREATE UNIQUE INDEX mv_material_recovery_key ON mv_material_recovery (recycler_id, quarter, material_name);

-- latest scored test for a unit, in any state (the reuse view only covers loose parts)
-- SECURITY DEFINER (E3): functions inside a view run as the caller, and public_reader has no table rights
CREATE FUNCTION fn_latest_health(p_unit BIGINT) RETURNS SMALLINT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT t.health_score FROM lifecycle_event e JOIN diagnostic_test t ON t.event_id = e.event_id
  WHERE e.unit_id = p_unit AND t.health_score IS NOT NULL
  ORDER BY e.event_id DESC, t.test_id DESC LIMIT 1
$$;

-- owner-rights view (deliberately not security_invoker): the one thing public_reader may read.
-- It reads the latest event itself instead of joining v_unit_current: a security_invoker view nested inside an
-- owner-rights view is checked against the *calling* role, which would give public_reader a need for table
-- privileges (erratum E6). Same columns, same values as the TRD version.
CREATE VIEW v_public_passport AS
SELECT u.passport_uid,
       m.model_number, m.category, o.org_name AS manufacturer,
       u.manufactured_on,
       (SELECT e.event_type FROM lifecycle_event e
         WHERE e.unit_id = u.unit_id ORDER BY e.event_id DESC LIMIT 1)    AS current_state,
       (SELECT jsonb_agg(jsonb_build_object('type', e.event_type,
                                            'date', e.occurred_at::date) ORDER BY e.event_id)
          FROM lifecycle_event e WHERE e.unit_id = u.unit_id)              AS history,
       fn_latest_health(u.unit_id)                                         AS latest_health,
       (sp_verify_chain(u.unit_id) IS NULL)                               AS chain_verified
FROM unit u
JOIN part_model m   ON m.model_id = u.model_id
JOIN organization o ON o.org_id = m.manufacturer_id;
-- SECURITY BARRIER so filters cannot leak rows
ALTER VIEW v_public_passport SET (security_barrier = true);

-- migrate:down
DROP VIEW v_public_passport;
DROP FUNCTION fn_latest_health(BIGINT);
DROP INDEX mv_material_recovery_key;
DROP MATERIALIZED VIEW mv_material_recovery;
DROP VIEW v_epr_compliance;
DROP VIEW v_certificate_backing;
DROP VIEW v_reuse_inventory;
DROP VIEW v_unit_passport;
DROP VIEW v_unit_current;
