-- migrate:up
-- Least privilege (TRD section 3, build playbook B.3/B.4, errata E2-E4).
-- All writes happen through SECURITY DEFINER routines owned by rc_owner; the access roles only get
-- EXECUTE on the routines they may call and SELECT on what they may read.

-- Roles are cluster-wide: create them only if another database of this cluster has not already.
DO $$
DECLARE r TEXT;
BEGIN
  FOREACH r IN ARRAY ARRAY['rc_auth','rc_producer','rc_collector','rc_technician','rc_recycler',
                           'rc_auditor','rc_admin','public_reader'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('CREATE ROLE %I NOLOGIN', r);
    END IF;
  END LOOP;
END $$;
GRANT rc_auth, rc_producer, rc_collector, rc_technician, rc_recycler, rc_auditor, rc_admin, public_reader
  TO rc_app;

-- Nobody gets anything by default.
REVOKE ALL ON ALL TABLES    IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL PROCEDURES IN SCHEMA public FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

-- C3, second line of defence: no role may change or remove history. The trigger is the real guard, because an
-- owner can re-grant itself. TRUNCATE is revoked too: it does not fire row triggers.
-- Exception for the owner on lifecycle_event: it keeps UPDATE, because foreign-key checks from diagnostic_test
-- (and the self-reference corrects_event_id) lock the referenced row with FOR KEY SHARE, which PostgreSQL only
-- allows with UPDATE privilege. Row UPDATEs by the owner are still refused by trg_event_immutable (RC003).
REVOKE UPDATE, DELETE, TRUNCATE ON audit_log FROM PUBLIC, rc_owner, rc_app, rc_auth,
  rc_producer, rc_collector, rc_technician, rc_recycler, rc_auditor, rc_admin, public_reader;
REVOKE UPDATE, DELETE, TRUNCATE ON lifecycle_event FROM PUBLIC, rc_app, rc_auth,
  rc_producer, rc_collector, rc_technician, rc_recycler, rc_auditor, rc_admin, public_reader;
REVOKE DELETE, TRUNCATE ON lifecycle_event FROM rc_owner;

-- ---------------------------------------------------------------------------------- read access
-- Every staff role reads the shared ledger and catalogue; the views below are security_invoker (E2), so these
-- table privileges are what they run on, and row-level security applies to the caller.
GRANT SELECT ON organization, facility, part_model, material, model_material, unit, assembly_link,
                lifecycle_event, event_transition, diagnostic_test,
                custody_transfer, transfer_item, transfer_discrepancy,
                epr_certificate, certificate_unit, epr_target
  TO rc_producer, rc_collector, rc_technician, rc_recycler, rc_auditor, rc_admin;
-- actor: everything except the password hash, for every role (nobody reads hashes through SQL)
GRANT SELECT (actor_id, facility_id, full_name, role, email, is_active) ON actor
  TO rc_producer, rc_collector, rc_technician, rc_recycler, rc_auditor, rc_admin;
GRANT SELECT ON audit_log TO rc_auditor, rc_admin;

GRANT SELECT ON v_unit_current, v_unit_passport, v_reuse_inventory, v_certificate_backing, v_epr_compliance
  TO rc_producer, rc_collector, rc_technician, rc_recycler, rc_auditor, rc_admin;
-- the nightly material-recovery view has no row-level security, so it is limited to the oversight roles
GRANT SELECT ON mv_material_recovery TO rc_auditor, rc_admin;

-- the public boundary: one view, nothing else. PostgreSQL checks EXECUTE on the functions a view calls against the
-- calling role (only table access is checked as the view owner), so public_reader needs these two; both are
-- SECURITY DEFINER (E3), so the tables behind them stay out of its reach.
GRANT SELECT ON v_public_passport TO public_reader;
GRANT EXECUTE ON FUNCTION fn_latest_health(BIGINT), sp_verify_chain(BIGINT) TO public_reader;

-- helpers that views and policies call as the invoking role
GRANT EXECUTE ON FUNCTION fn_org_of_facility(INT), fn_ctx_org(), fn_ctx_role()
  TO rc_producer, rc_collector, rc_technician, rc_recycler, rc_auditor, rc_admin;
GRANT EXECUTE ON FUNCTION fn_part_tree(BIGINT, TIMESTAMPTZ)
  TO rc_producer, rc_collector, rc_technician, rc_recycler, rc_auditor, rc_admin;
-- the staff passport (FR-4.4) shows chain_verified, so every staff role may verify a chain
GRANT EXECUTE ON FUNCTION sp_verify_chain(BIGINT)
  TO rc_producer, rc_collector, rc_technician, rc_recycler, rc_auditor, rc_admin;

-- ------------------------------------------------------------------------- write access (EXECUTE)
GRANT EXECUTE ON FUNCTION  sp_register_model(VARCHAR, VARCHAR, NUMERIC, JSONB) TO rc_producer;
GRANT EXECUTE ON PROCEDURE sp_set_materials(INT, JSONB)                         TO rc_producer;
GRANT EXECUTE ON PROCEDURE sp_set_target(VARCHAR, CHAR, NUMERIC)                TO rc_producer;

GRANT EXECUTE ON FUNCTION  sp_create_unit(INT, VARCHAR, DATE, BIGINT)           TO rc_producer, rc_collector;
GRANT EXECUTE ON FUNCTION  sp_bulk_create_units(JSONB)                          TO rc_producer, rc_collector;

GRANT EXECUTE ON PROCEDURE sp_record_event(BIGINT, VARCHAR, TIMESTAMPTZ, INT, BIGINT)
  TO rc_producer, rc_collector, rc_technician, rc_recycler;
GRANT EXECUTE ON PROCEDURE sp_dismantle(BIGINT, JSONB, TIMESTAMPTZ, INT)        TO rc_collector, rc_technician;
GRANT EXECUTE ON PROCEDURE sp_harvest(BIGINT, TIMESTAMPTZ, INT)                 TO rc_technician;
GRANT EXECUTE ON PROCEDURE sp_reinstall(BIGINT, BIGINT, TIMESTAMPTZ, INT)       TO rc_technician;
GRANT EXECUTE ON PROCEDURE sp_record_tests(BIGINT, TIMESTAMPTZ, INT, JSONB)     TO rc_technician;

GRANT EXECUTE ON FUNCTION  sp_create_transfer(VARCHAR, INT, TIMESTAMPTZ, NUMERIC, JSONB)
  TO rc_collector, rc_technician, rc_recycler;
GRANT EXECUTE ON PROCEDURE sp_receive_transfer(BIGINT, TIMESTAMPTZ, BIGINT[], BIGINT[])
  TO rc_collector, rc_technician, rc_recycler;

GRANT EXECUTE ON FUNCTION  sp_issue_certificate(VARCHAR, VARCHAR, NUMERIC, CHAR, DATE, JSONB) TO rc_recycler;
GRANT EXECUTE ON PROCEDURE sp_allocate_certificate(BIGINT, INT)                 TO rc_recycler;

GRANT EXECUTE ON FUNCTION  sp_admin_create_org(VARCHAR, VARCHAR, VARCHAR, CHAR) TO rc_admin;
GRANT EXECUTE ON FUNCTION  sp_admin_create_facility(INT, VARCHAR, CHAR, NUMERIC) TO rc_admin;
GRANT EXECUTE ON FUNCTION  sp_admin_create_actor(INT, VARCHAR, VARCHAR, VARCHAR, TEXT) TO rc_admin;
GRANT EXECUTE ON PROCEDURE sp_admin_set_actor_active(INT, BOOLEAN)              TO rc_admin;
GRANT EXECUTE ON PROCEDURE sp_refresh_material_recovery()                       TO rc_admin;

-- login: used before a user exists; rc_auth gets this and nothing else
GRANT EXECUTE ON FUNCTION fn_auth_lookup(VARCHAR) TO rc_auth;

-- ------------------------------------------------------------------------------ row-level security
-- The table owner (rc_owner, and therefore every SECURITY DEFINER routine) bypasses these policies.
-- They are scoped TO the staff roles: public_reader reaches these tables only through v_public_passport ->
-- v_unit_current, and must neither evaluate the policy helpers (it has no EXECUTE on them) nor see any row.
ALTER TABLE custody_transfer     ENABLE ROW LEVEL SECURITY;
ALTER TABLE transfer_item        ENABLE ROW LEVEL SECURITY;
ALTER TABLE transfer_discrepancy ENABLE ROW LEVEL SECURITY;
ALTER TABLE epr_certificate      ENABLE ROW LEVEL SECURITY;
ALTER TABLE certificate_unit     ENABLE ROW LEVEL SECURITY;
ALTER TABLE epr_target           ENABLE ROW LEVEL SECURITY;

CREATE POLICY ct_scope ON custody_transfer FOR SELECT
  TO rc_producer, rc_collector, rc_technician, rc_recycler, rc_auditor, rc_admin
  USING (fn_ctx_role() IN ('AUDITOR','ADMIN')
         OR from_org_id = fn_ctx_org() OR to_org_id = fn_ctx_org());
CREATE POLICY ti_scope ON transfer_item FOR SELECT
  TO rc_producer, rc_collector, rc_technician, rc_recycler, rc_auditor, rc_admin
  USING (EXISTS (SELECT 1 FROM custody_transfer ct WHERE ct.transfer_id = transfer_item.transfer_id));
CREATE POLICY td_scope ON transfer_discrepancy FOR SELECT
  TO rc_producer, rc_collector, rc_technician, rc_recycler, rc_auditor, rc_admin
  USING (EXISTS (SELECT 1 FROM custody_transfer ct WHERE ct.transfer_id = transfer_discrepancy.transfer_id));
CREATE POLICY ec_scope ON epr_certificate FOR SELECT
  TO rc_producer, rc_collector, rc_technician, rc_recycler, rc_auditor, rc_admin
  USING (fn_ctx_role() IN ('AUDITOR','ADMIN')
         OR recycler_id = fn_ctx_org() OR producer_id = fn_ctx_org());
CREATE POLICY cu_scope ON certificate_unit FOR SELECT
  TO rc_producer, rc_collector, rc_technician, rc_recycler, rc_auditor, rc_admin
  USING (EXISTS (SELECT 1 FROM epr_certificate c WHERE c.cert_id = certificate_unit.cert_id));
CREATE POLICY et_scope ON epr_target FOR SELECT
  TO rc_producer, rc_collector, rc_technician, rc_recycler, rc_auditor, rc_admin
  USING (fn_ctx_role() IN ('AUDITOR','ADMIN') OR producer_id = fn_ctx_org());

-- migrate:down
DROP POLICY et_scope ON epr_target;
DROP POLICY cu_scope ON certificate_unit;
DROP POLICY ec_scope ON epr_certificate;
DROP POLICY td_scope ON transfer_discrepancy;
DROP POLICY ti_scope ON transfer_item;
DROP POLICY ct_scope ON custody_transfer;
ALTER TABLE epr_target           DISABLE ROW LEVEL SECURITY;
ALTER TABLE certificate_unit     DISABLE ROW LEVEL SECURITY;
ALTER TABLE epr_certificate      DISABLE ROW LEVEL SECURITY;
ALTER TABLE transfer_discrepancy DISABLE ROW LEVEL SECURITY;
ALTER TABLE transfer_item        DISABLE ROW LEVEL SECURITY;
ALTER TABLE custody_transfer     DISABLE ROW LEVEL SECURITY;

REVOKE ALL ON ALL TABLES IN SCHEMA public
  FROM rc_auth, rc_producer, rc_collector, rc_technician, rc_recycler, rc_auditor, rc_admin, public_reader;
REVOKE ALL (actor_id, facility_id, full_name, role, email, is_active) ON actor
  FROM rc_producer, rc_collector, rc_technician, rc_recycler, rc_auditor, rc_admin;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public
  FROM rc_auth, rc_producer, rc_collector, rc_technician, rc_recycler, rc_auditor, rc_admin, public_reader;
REVOKE ALL ON ALL PROCEDURES IN SCHEMA public
  FROM rc_auth, rc_producer, rc_collector, rc_technician, rc_recycler, rc_auditor, rc_admin, public_reader;

ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO PUBLIC;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO PUBLIC;
GRANT EXECUTE ON ALL PROCEDURES IN SCHEMA public TO PUBLIC;
GRANT UPDATE, DELETE, TRUNCATE ON audit_log TO rc_owner;
GRANT DELETE, TRUNCATE ON lifecycle_event TO rc_owner;

REVOKE rc_auth, rc_producer, rc_collector, rc_technician, rc_recycler, rc_auditor, rc_admin, public_reader
  FROM rc_app;
-- The NOLOGIN roles are cluster-wide and may still hold privileges in other databases, so they are
-- dropped only when nothing else depends on them.
DO $$
DECLARE r TEXT;
BEGIN
  FOREACH r IN ARRAY ARRAY['rc_auth','rc_producer','rc_collector','rc_technician','rc_recycler',
                           'rc_auditor','rc_admin','public_reader'] LOOP
    BEGIN
      EXECUTE format('DROP ROLE %I', r);
    EXCEPTION WHEN dependent_objects_still_exist THEN
      NULL;
    END;
  END LOOP;
END $$;
