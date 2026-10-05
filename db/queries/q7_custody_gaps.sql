-- Q7 — custody gaps (TRD section 9, FR-8.7): units with an event at an organisation that never received them.
SELECT DISTINCT e.unit_id, fn_org_of_facility(e.facility_id) AS org_id
FROM lifecycle_event e
WHERE fn_org_of_facility(e.facility_id) <> COALESCE(
        (SELECT fn_org_of_facility(f.facility_id) FROM lifecycle_event f
          WHERE f.unit_id = e.unit_id ORDER BY f.event_id LIMIT 1), -1)   -- not the unit's first org
  AND NOT EXISTS (
        SELECT 1 FROM transfer_item ti JOIN custody_transfer ct USING (transfer_id)
        WHERE ti.unit_id = e.unit_id AND ct.to_org_id = fn_org_of_facility(e.facility_id)
          AND ct.received_at IS NOT NULL AND ct.received_at <= e.occurred_at);
