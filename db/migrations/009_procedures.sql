-- migrate:up
CREATE FUNCTION fn_part_tree(p_root BIGINT, p_as_of TIMESTAMPTZ DEFAULT now())
RETURNS TABLE (depth INT, unit_id BIGINT, parent_unit_id BIGINT,
               serial_no VARCHAR, model_number VARCHAR, category VARCHAR)
LANGUAGE sql STABLE AS $$
  WITH RECURSIVE bom AS (
    SELECT 1 AS depth, a.child_unit_id, a.parent_unit_id
    FROM assembly_link a
    WHERE a.parent_unit_id = p_root
      AND tstzrange(a.installed_at, a.removed_at) @> p_as_of
    UNION ALL
    SELECT b.depth + 1, a.child_unit_id, a.parent_unit_id
    FROM assembly_link a JOIN bom b ON a.parent_unit_id = b.child_unit_id
    WHERE tstzrange(a.installed_at, a.removed_at) @> p_as_of AND b.depth < 10
  )
  SELECT b.depth, u.unit_id, b.parent_unit_id, u.serial_no, m.model_number, m.category
  FROM bom b JOIN unit u ON u.unit_id = b.child_unit_id
             JOIN part_model m ON m.model_id = u.model_id
  ORDER BY b.depth, m.category;
$$;

-- FR-5.8: create sub-units under an existing device, atomically.
-- p_parts = [{"model_id":12,"serial_no":"BAT-0091"}, ...]
CREATE PROCEDURE sp_dismantle(p_device BIGINT, p_parts JSONB, p_at TIMESTAMPTZ, p_facility INT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE part JSONB; new_id BIGINT; child_state VARCHAR(20);
BEGIN
  FOR part IN SELECT * FROM jsonb_array_elements(p_parts) LOOP
    INSERT INTO unit (model_id, serial_no)
      VALUES ((part->>'model_id')::INT, part->>'serial_no')
      ON CONFLICT (model_id, serial_no) DO NOTHING
      RETURNING unit_id INTO new_id;
    IF new_id IS NULL THEN                      -- unit already registered: reuse it
      SELECT unit_id INTO new_id FROM unit
       WHERE model_id = (part->>'model_id')::INT AND serial_no = part->>'serial_no';
    END IF;
    -- record that it was inside the device up to now, if not already linked
    IF NOT EXISTS (SELECT 1 FROM assembly_link WHERE child_unit_id = new_id AND removed_at IS NULL) THEN
      INSERT INTO assembly_link (child_unit_id, installed_at, parent_unit_id)
      SELECT new_id, COALESCE(MIN(e.occurred_at), p_at - interval '1 second'), p_device
      FROM lifecycle_event e WHERE e.unit_id = p_device;
    END IF;
    -- a part arrives with its device: if its own history has not caught up
    -- (e.g. latest event MANUFACTURED at the factory), record COLLECTED first
    SELECT current_state INTO child_state FROM v_unit_current WHERE unit_id = new_id;
    IF child_state IS NULL OR child_state NOT IN ('COLLECTED','DIAGNOSED') THEN
      CALL sp_record_event(new_id, 'COLLECTED', p_at, p_facility);
    END IF;
    CALL sp_record_event(new_id, 'HARVESTED', p_at, p_facility);   -- C6 closes the link
  END LOOP;
END $$;

-- FR-5.1 + EVT REINSTALLED: open a new period, then log the event
CREATE PROCEDURE sp_reinstall(p_unit BIGINT, p_new_parent BIGINT, p_at TIMESTAMPTZ, p_facility INT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO assembly_link (child_unit_id, installed_at, parent_unit_id)
  VALUES (p_unit, p_at, p_new_parent);                 -- C1 / C2 may refuse here
  CALL sp_record_event(p_unit, 'REINSTALLED', p_at, p_facility);  -- C5 requires HARVESTED before
END $$;

-- migrate:down
DROP PROCEDURE sp_reinstall(BIGINT, BIGINT, TIMESTAMPTZ, INT);
DROP PROCEDURE sp_dismantle(BIGINT, JSONB, TIMESTAMPTZ, INT);
DROP FUNCTION fn_part_tree(BIGINT, TIMESTAMPTZ);
