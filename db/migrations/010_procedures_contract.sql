-- migrate:up
-- Routines defined by contract (build playbook B.3, errata E5). Organisation and actor always come
-- from the transaction-local settings rc.org_id / rc.actor_id, never from parameters, except in the
-- sp_admin_* routines. Business rules C1-C10 are enforced by the triggers and constraints, not here.

-- FR-3.1: register a catalogue model for the caller's organisation; spec keys checked against TRD section 4
CREATE FUNCTION sp_register_model(p_model_number VARCHAR, p_category VARCHAR, p_mass_g NUMERIC,
                                  p_spec JSONB DEFAULT '{}')
RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE k TEXT; v_id INT;
BEGIN
  IF p_spec IS NULL THEN
    p_spec := '{}'::jsonb;
  END IF;
  IF jsonb_typeof(p_spec) <> 'object' THEN
    RAISE EXCEPTION 'spec must be a JSON object' USING ERRCODE = '23514';
  END IF;
  FOR k IN SELECT jsonb_object_keys(p_spec) LOOP
    IF NOT (k = ANY (COALESCE(fn_spec_keys(p_category), ARRAY[]::TEXT[]))) THEN
      RAISE EXCEPTION 'spec key "%" is not allowed for category %', k, p_category USING ERRCODE = 'RC012';
    END IF;
  END LOOP;
  INSERT INTO part_model (manufacturer_id, model_number, category, mass_g, spec)
  VALUES (fn_ctx_org(), p_model_number, p_category, p_mass_g, p_spec)
  RETURNING model_id INTO v_id;
  RETURN v_id;
END $$;

-- FR-3.3: replace a model's material composition; only the model's manufacturer may do so
-- p_materials = [{"material_id":3,"mass_mg":1200.5}, ...]
CREATE PROCEDURE sp_set_materials(p_model INT, p_materials JSONB)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM part_model WHERE model_id = p_model AND manufacturer_id = fn_ctx_org()) THEN
    RAISE EXCEPTION 'model % is not one of your organisation''s models', p_model USING ERRCODE = '42501';
  END IF;
  DELETE FROM model_material WHERE model_id = p_model;
  INSERT INTO model_material (model_id, material_id, mass_mg)
  SELECT p_model, x.material_id, x.mass_mg
  FROM jsonb_to_recordset(COALESCE(p_materials, '[]'::jsonb)) AS x(material_id INT, mass_mg NUMERIC);
END $$;

-- FR-9.6: upsert the caller's producer target for a category and financial year
CREATE PROCEDURE sp_set_target(p_category VARCHAR, p_fy CHAR(7), p_target_kg NUMERIC)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO epr_target (producer_id, category, financial_year, target_kg)
  VALUES (fn_ctx_org(), p_category, p_fy, p_target_kg)
  ON CONFLICT (producer_id, category, financial_year) DO UPDATE SET target_kg = EXCLUDED.target_kg;
END $$;

-- FR-4.1: create a unit; with p_parent also opens the first assembly period at now() (no event)
CREATE FUNCTION sp_create_unit(p_model INT, p_serial VARCHAR, p_manufactured_on DATE DEFAULT NULL,
                               p_parent BIGINT DEFAULT NULL)
RETURNS BIGINT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id BIGINT;
BEGIN
  INSERT INTO unit (model_id, serial_no, manufactured_on)
  VALUES (p_model, p_serial, p_manufactured_on)
  RETURNING unit_id INTO v_id;
  IF p_parent IS NOT NULL THEN
    INSERT INTO assembly_link (child_unit_id, installed_at, parent_unit_id)
    VALUES (v_id, now(), p_parent);
  END IF;
  RETURN v_id;
END $$;

-- FR-4.6: all-or-nothing bulk creation
-- p_units = [{"model_id":1,"serial_no":"S1","manufactured_on":"2026-01-31","parent_unit_id":null}, ...]
CREATE FUNCTION sp_bulk_create_units(p_units JSONB)
RETURNS BIGINT[]
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE el JSONB; ids BIGINT[] := ARRAY[]::BIGINT[];
BEGIN
  FOR el IN SELECT value FROM jsonb_array_elements(p_units) WITH ORDINALITY AS t(value, ord) ORDER BY ord LOOP
    ids := ids || sp_create_unit((el->>'model_id')::INT,
                                 el->>'serial_no',
                                 (el->>'manufactured_on')::DATE,
                                 (el->>'parent_unit_id')::BIGINT);
  END LOOP;
  RETURN ids;
END $$;

-- FR-7.1/7.2: a DIAGNOSED event and its tests in one transaction
-- p_tests = [{"test_type":"BATTERY_SOH","result":"PASS","measured_value":86,"health_score":86}, ...]
CREATE PROCEDURE sp_record_tests(p_unit BIGINT, p_at TIMESTAMPTZ, p_facility INT, p_tests JSONB)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_event BIGINT;
BEGIN
  CALL sp_record_event(p_unit, 'DIAGNOSED', p_at, p_facility);
  SELECT event_id INTO v_event FROM lifecycle_event
   WHERE unit_id = p_unit ORDER BY event_id DESC LIMIT 1;
  INSERT INTO diagnostic_test (event_id, test_type, result, measured_value, health_score)
  SELECT v_event, x.test_type, x.result, x.measured_value, x.health_score
  FROM jsonb_to_recordset(COALESCE(p_tests, '[]'::jsonb))
       AS x(test_type VARCHAR, result VARCHAR, measured_value NUMERIC, health_score SMALLINT);
END $$;

-- FR-8.1/8.2: manifest and its items in one transaction; the sender is the caller's organisation
-- p_items = [{"unit_id":10,"declared_condition":"WORKING"}, ...]
CREATE FUNCTION sp_create_transfer(p_manifest_no VARCHAR, p_to_org INT, p_shipped_at TIMESTAMPTZ,
                                   p_total_mass_kg NUMERIC, p_items JSONB)
RETURNS BIGINT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id BIGINT;
BEGIN
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'a manifest needs at least one unit' USING ERRCODE = '23514';
  END IF;
  INSERT INTO custody_transfer (manifest_no, from_org_id, to_org_id, shipped_at, total_mass_kg)
  VALUES (p_manifest_no, fn_ctx_org(), p_to_org, p_shipped_at, p_total_mass_kg)
  RETURNING transfer_id INTO v_id;
  INSERT INTO transfer_item (transfer_id, unit_id, declared_condition)
  SELECT v_id, x.unit_id, x.declared_condition
  FROM jsonb_to_recordset(p_items) AS x(unit_id BIGINT, declared_condition VARCHAR);   -- C8 per row
  RETURN v_id;
END $$;

-- FR-9.1..9.4: certificate, then its backing units, then one audit row. The caller sets SERIALIZABLE.
-- p_units = [{"unit_id":10,"recovered_mass_g":1100}, ...]
CREATE FUNCTION sp_issue_certificate(p_cert_no VARCHAR, p_category VARCHAR, p_quantity_kg NUMERIC,
                                     p_fy CHAR(7), p_issued_on DATE, p_units JSONB)
RETURNS BIGINT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id BIGINT;
BEGIN
  INSERT INTO epr_certificate (cert_no, recycler_id, category, quantity_kg, financial_year, issued_on)
  VALUES (p_cert_no, fn_ctx_org(), p_category, p_quantity_kg, p_fy, p_issued_on)
  RETURNING cert_id INTO v_id;
  INSERT INTO certificate_unit (unit_id, cert_id, recovered_mass_g)         -- C9, C10a per row
  SELECT x.unit_id, v_id, x.recovered_mass_g
  FROM jsonb_to_recordset(COALESCE(p_units, '[]'::jsonb)) AS x(unit_id BIGINT, recovered_mass_g NUMERIC);
  INSERT INTO audit_log (actor_id, action, entity, entity_id, details)
  VALUES (current_setting('rc.actor_id')::INT, 'CERT_ISSUE', 'epr_certificate', v_id::TEXT,
          jsonb_build_object('cert_no', p_cert_no, 'quantity_kg', p_quantity_kg,
                             'unit_count', jsonb_array_length(COALESCE(p_units, '[]'::jsonb))));
  RETURN v_id;
END $$;

-- FR-9.5: the issuing recycler allocates a certificate to one producer, once
CREATE PROCEDURE sp_allocate_certificate(p_cert BIGINT, p_producer INT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_current INT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM organization WHERE org_id = p_producer AND org_type = 'PRODUCER') THEN
    RAISE EXCEPTION 'organisation % is not a producer', p_producer USING ERRCODE = 'RC016';
  END IF;
  SELECT producer_id INTO v_current FROM epr_certificate
   WHERE cert_id = p_cert AND recycler_id = fn_ctx_org() FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'certificate % is not one of your organisation''s certificates', p_cert
      USING ERRCODE = '42501';
  END IF;
  IF v_current IS NOT NULL THEN
    RAISE EXCEPTION 'certificate % is already allocated', p_cert USING ERRCODE = 'RC015';
  END IF;
  UPDATE epr_certificate SET producer_id = p_producer WHERE cert_id = p_cert;
  INSERT INTO audit_log (actor_id, action, entity, entity_id, details)
  VALUES (current_setting('rc.actor_id')::INT, 'CERT_ALLOCATE', 'epr_certificate', p_cert::TEXT,
          jsonb_build_object('producer_id', p_producer));
END $$;

-- Administration. rc.actor_id is absent only while bootstrapping the very first administrator
-- (run by the migration owner); in that case there is nobody to attribute the audit row to.
CREATE FUNCTION sp_admin_create_org(p_name VARCHAR, p_type VARCHAR, p_cpcb VARCHAR, p_gstin CHAR(15))
RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id INT; v_actor INT := NULLIF(current_setting('rc.actor_id', true), '')::INT;
BEGIN
  INSERT INTO organization (org_name, org_type, cpcb_reg_no, gstin)
  VALUES (p_name, p_type, p_cpcb, p_gstin)
  RETURNING org_id INTO v_id;
  IF v_actor IS NOT NULL THEN
    INSERT INTO audit_log (actor_id, action, entity, entity_id, details)
    VALUES (v_actor, 'ORG_CREATE', 'organization', v_id::TEXT,
            jsonb_build_object('org_name', p_name, 'org_type', p_type));
  END IF;
  RETURN v_id;
END $$;

CREATE FUNCTION sp_admin_create_facility(p_org INT, p_name VARCHAR, p_pincode CHAR(6),
                                         p_capacity NUMERIC DEFAULT NULL)
RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id INT;
BEGIN
  INSERT INTO facility (org_id, facility_name, pincode, authorised_capacity_tpa)
  VALUES (p_org, p_name, p_pincode, p_capacity)
  RETURNING facility_id INTO v_id;
  RETURN v_id;
END $$;

-- the bcrypt hash is computed by the API; the password itself never reaches the database
CREATE FUNCTION sp_admin_create_actor(p_facility INT, p_name VARCHAR, p_role VARCHAR, p_email VARCHAR,
                                      p_password_hash TEXT)
RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id INT; v_actor INT := NULLIF(current_setting('rc.actor_id', true), '')::INT;
BEGIN
  INSERT INTO actor (facility_id, full_name, role, email, password_hash)
  VALUES (p_facility, p_name, p_role, p_email, p_password_hash)
  RETURNING actor_id INTO v_id;
  INSERT INTO audit_log (actor_id, action, entity, entity_id, details)
  VALUES (COALESCE(v_actor, v_id), 'ACTOR_CREATE', 'actor', v_id::TEXT,
          jsonb_build_object('role', p_role, 'facility_id', p_facility));
  RETURN v_id;
END $$;

CREATE PROCEDURE sp_admin_set_actor_active(p_actor INT, p_active BOOLEAN)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE actor SET is_active = p_active WHERE actor_id = p_actor;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'actor % does not exist', p_actor USING ERRCODE = '23514';
  END IF;
  INSERT INTO audit_log (actor_id, action, entity, entity_id, details)
  VALUES (current_setting('rc.actor_id')::INT,
          CASE WHEN p_active THEN 'ACTOR_ACTIVATE' ELSE 'ACTOR_DEACTIVATE' END,
          'actor', p_actor::TEXT, NULL);
END $$;

-- FR-11 / nightly refresh; granted to rc_admin only (migration 013).
-- mv_material_recovery is created in migration 011; the name is resolved when the procedure runs.
CREATE PROCEDURE sp_refresh_material_recovery()
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_material_recovery;
END $$;

-- Login lookup: used before a user exists, so it takes no rc.* context; granted to rc_auth only.
CREATE FUNCTION fn_auth_lookup(p_email VARCHAR)
RETURNS TABLE (actor_id INT, org_id INT, role VARCHAR, password_hash TEXT, is_active BOOLEAN)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT a.actor_id, fn_org_of_facility(a.facility_id), a.role, a.password_hash, a.is_active
  FROM actor a WHERE a.email = p_email
$$;

-- migrate:down
DROP FUNCTION fn_auth_lookup(VARCHAR);
DROP PROCEDURE sp_refresh_material_recovery();
DROP PROCEDURE sp_admin_set_actor_active(INT, BOOLEAN);
DROP FUNCTION sp_admin_create_actor(INT, VARCHAR, VARCHAR, VARCHAR, TEXT);
DROP FUNCTION sp_admin_create_facility(INT, VARCHAR, CHAR, NUMERIC);
DROP FUNCTION sp_admin_create_org(VARCHAR, VARCHAR, VARCHAR, CHAR);
DROP PROCEDURE sp_allocate_certificate(BIGINT, INT);
DROP FUNCTION sp_issue_certificate(VARCHAR, VARCHAR, NUMERIC, CHAR, DATE, JSONB);
DROP FUNCTION sp_create_transfer(VARCHAR, INT, TIMESTAMPTZ, NUMERIC, JSONB);
DROP PROCEDURE sp_record_tests(BIGINT, TIMESTAMPTZ, INT, JSONB);
DROP FUNCTION sp_bulk_create_units(JSONB);
DROP FUNCTION sp_create_unit(INT, VARCHAR, DATE, BIGINT);
DROP PROCEDURE sp_set_target(VARCHAR, CHAR, NUMERIC);
DROP PROCEDURE sp_set_materials(INT, JSONB);
DROP FUNCTION sp_register_model(VARCHAR, VARCHAR, NUMERIC, JSONB);
