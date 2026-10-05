-- T3.1: least-privilege roles, grants and row-level security. Everything rolls back at the end.
-- Checks run as the named role through pg_temp.as_role(); the identity (rc.*) is set as the API would set it.
BEGIN;
SELECT plan(38);
\o /dev/null
\ir ../fixtures/walkthrough.sql
\o

-- run one statement as a role and hand back the scalar result as text; the role is reset afterwards
CREATE FUNCTION pg_temp.as_role(p_role TEXT, p_sql TEXT) RETURNS TEXT LANGUAGE plpgsql AS $f$
DECLARE res TEXT;
BEGIN
  EXECUTE format('SET LOCAL ROLE %I', p_role);
  EXECUTE p_sql INTO res;
  RESET ROLE;
  RETURN res;
END $f$;
-- set the identity the API would set for a request
CREATE FUNCTION pg_temp.ctx(p_org TEXT, p_actor TEXT, p_role TEXT) RETURNS VOID LANGUAGE sql AS $f$
  SELECT set_config('rc.org_id', current_setting(p_org), true), set_config('rc.actor_id', current_setting(p_actor), true),
         set_config('rc.role', p_role, true) $f$;

-- a manifest between producer and recycler that the collector is not part of, holding a unit with no events
SELECT pg_temp.ctx('wt.org_p', 'wt.act_p', 'PRODUCER');
SELECT set_config('wt.u_role', sp_create_unit(current_setting('wt.m_ssd')::INT, 'ROLE-1')::text, true);
SELECT set_config('wt.mf_role', sp_create_transfer('MF-ROLE-1', current_setting('wt.org_y')::INT, '2026-09-26T08:00:00Z', 1,
  format('[{"unit_id":%s,"declared_condition":"WORKING"}]', current_setting('wt.u_role'))::jsonb)::text, true);
SELECT pg_temp.ctx('wt.org_y', 'wt.act_y', 'RECYCLER_OPERATOR');
CALL sp_receive_transfer(current_setting('wt.mf_role')::BIGINT, '2026-09-27T08:00:00Z');

-- ---------------------------------------------------------------- the access model itself
SELECT is((SELECT rolinherit FROM pg_roles WHERE rolname = 'rc_app'), false, 'rc_app is NOINHERIT');
SELECT ok(pg_has_role('rc_app', 'rc_technician', 'member') AND NOT has_table_privilege('rc_app', 'unit', 'SELECT'),
          'rc_app is a member of the access roles but holds no privileges of its own');
SELECT is((SELECT count(*) FROM pg_class WHERE relname IN ('custody_transfer','transfer_item','transfer_discrepancy',
            'epr_certificate','certificate_unit','epr_target') AND relrowsecurity), 6::BIGINT, 'row-level security is on for the six scoped tables');

-- ---------------------------------------------------------------- FR-1.4: the database refuses, whatever the API does
SELECT throws_ok($$SET LOCAL ROLE rc_technician; INSERT INTO epr_certificate (cert_no, recycler_id, category, quantity_kg, financial_year, issued_on)
                   VALUES ('X-1', 1, 'ITEW2', 1, '2026-27', '2026-10-01')$$, '42501', NULL,
                 'rc_technician: INSERT INTO epr_certificate is permission denied');
SELECT throws_ok($$SET LOCAL ROLE rc_collector; INSERT INTO unit (model_id, serial_no) VALUES (1, 'NOPE')$$, '42501', NULL,
                 'rc_collector: direct INSERT INTO unit is permission denied');
SELECT throws_ok($$SET LOCAL ROLE rc_technician; UPDATE lifecycle_event SET event_type = event_type$$, '42501', NULL,
                 'rc_technician: UPDATE on lifecycle_event is permission denied');
SELECT throws_ok($$SET LOCAL ROLE rc_admin; DELETE FROM audit_log$$, '42501', NULL, 'rc_admin: DELETE on audit_log is permission denied');
SELECT throws_ok($$SET LOCAL ROLE rc_owner; UPDATE lifecycle_event SET event_type = event_type$$, 'RC003', NULL,
                 'rc_owner keeps UPDATE on lifecycle_event (foreign-key checks need it) but the C3 trigger refuses');
SELECT throws_ok($$SET LOCAL ROLE rc_owner; DELETE FROM lifecycle_event$$, '42501', NULL, 'rc_owner: DELETE on lifecycle_event is revoked');
SELECT throws_ok($$SET LOCAL ROLE rc_owner; TRUNCATE lifecycle_event$$, '42501', NULL, 'rc_owner: TRUNCATE on lifecycle_event is revoked');
SELECT throws_ok($$SET LOCAL ROLE rc_owner; UPDATE audit_log SET action = action$$, '42501', NULL, 'rc_owner: UPDATE on audit_log is revoked');

-- routines by role (TRD section 3 matrix)
SELECT pg_temp.ctx('wt.org_c', 'wt.act_c', 'COLLECTOR');
SELECT throws_ok($$SET LOCAL ROLE rc_collector; SELECT sp_issue_certificate('X','X',1,'2026-27','2026-10-01','[]')$$, '42501', NULL,
                 'rc_collector may not issue certificates');
SELECT throws_ok($$SET LOCAL ROLE rc_technician; SELECT sp_register_model('X','OTHER',1)$$, '42501', NULL, 'rc_technician may not register models');
SELECT throws_ok($$SET LOCAL ROLE rc_admin; CALL sp_record_event(1, 'COLLECTED', now() - interval '1 day', 1)$$, '42501', NULL,
                 'rc_admin may not record events');
SELECT throws_ok($$SET LOCAL ROLE rc_auditor; CALL sp_refresh_material_recovery()$$, '42501', NULL, 'rc_auditor may not refresh the material view');
SELECT lives_ok(format($f$SELECT pg_temp.as_role('rc_collector', 'SELECT sp_create_unit(%s, ''ROLE-2'')')$f$, current_setting('wt.m_ssd')),
                'rc_collector can create a unit through the SECURITY DEFINER routine');
SELECT set_config('rc.org_id', current_setting('wt.org_d'), true), set_config('rc.actor_id', current_setting('wt.act_x'), true), set_config('rc.role', 'ADMIN', true);
SELECT lives_ok($$CALL sp_refresh_material_recovery()$$, 'sp_refresh_material_recovery runs for the admin context (superuser stand-in)');

-- ---------------------------------------------------------------- FR-1.5: organisations see only their own manifests
SELECT pg_temp.ctx('wt.org_c', 'wt.act_c', 'COLLECTOR');
SELECT is(pg_temp.as_role('rc_collector', $$SELECT count(*) FROM custody_transfer WHERE manifest_no = 'MF-ROLE-1'$$), '0',
          'RLS: a collector sees 0 of another organisations''s manifests (table)');
SELECT is(pg_temp.as_role('rc_collector', format('SELECT count(*) FROM transfer_item WHERE unit_id = %s', current_setting('wt.u_role'))), '0',
          'RLS: ... and 0 of its items');
SELECT is(pg_temp.as_role('rc_collector', format('SELECT current_holder_org_id FROM v_unit_current WHERE unit_id = %s', current_setting('wt.u_role'))), NULL,
          'RLS through a staff view: the collector cannot see who received the unit (security_invoker)');
SELECT pg_temp.ctx('wt.org_y', 'wt.act_y', 'RECYCLER_OPERATOR');
SELECT is(pg_temp.as_role('rc_recycler', $$SELECT count(*) FROM custody_transfer WHERE manifest_no = 'MF-ROLE-1'$$), '1',
          'RLS: the receiving recycler sees the manifest');
SELECT is(pg_temp.as_role('rc_recycler', format('SELECT current_holder_org_id FROM v_unit_current WHERE unit_id = %s', current_setting('wt.u_role'))),
          current_setting('wt.org_y'), 'RLS through a staff view: the receiver sees itself as holder');
SELECT pg_temp.ctx('wt.org_d', 'wt.act_a', 'AUDITOR');
SELECT is(pg_temp.as_role('rc_auditor', $$SELECT count(*) FROM custody_transfer WHERE manifest_no = 'MF-ROLE-1'$$), '1', 'the auditor sees every manifest');

-- certificates and targets
SELECT pg_temp.ctx('wt.org_c', 'wt.act_c', 'COLLECTOR');
SELECT is(pg_temp.as_role('rc_collector', 'SELECT count(*) FROM epr_certificate'), '0', 'RLS: a collector sees 0 certificates (table)');
SELECT is(pg_temp.as_role('rc_collector', 'SELECT count(*) FROM v_certificate_backing'), '0', 'RLS through a staff view: 0 rows in v_certificate_backing');
SELECT is(pg_temp.as_role('rc_collector', 'SELECT count(*) FROM certificate_unit'), '0', 'RLS: 0 certificate units');
SELECT is(pg_temp.as_role('rc_collector', 'SELECT count(*) FROM v_epr_compliance'), '0', 'RLS through a staff view: 0 rows in v_epr_compliance');
SELECT pg_temp.ctx('wt.org_p', 'wt.act_p', 'PRODUCER');
SELECT is(pg_temp.as_role('rc_producer', 'SELECT count(*) FROM v_certificate_backing'), '1', 'the producer sees the certificate allocated to it');
SELECT pg_temp.ctx('wt.org_d', 'wt.act_a', 'AUDITOR');
SELECT is(pg_temp.as_role('rc_auditor', 'SELECT count(*) FROM audit_log WHERE action = ''CERT_ISSUE'''), '1', 'the auditor reads audit_log');
SELECT throws_ok($$SET LOCAL ROLE rc_technician; SELECT count(*) FROM audit_log$$, '42501', NULL, 'a technician cannot read audit_log');
SELECT throws_ok($$SET LOCAL ROLE rc_collector; SELECT count(*) FROM mv_material_recovery$$, '42501', NULL,
                 'a collector cannot read the material-recovery view (no row-level security on it)');

-- ---------------------------------------------------------------- nobody reads password hashes
SELECT throws_ok($$SET LOCAL ROLE rc_admin; SELECT password_hash FROM actor$$, '42501', NULL, 'rc_admin cannot read actor.password_hash');
SELECT is(pg_temp.as_role('rc_admin', $$SELECT count(*) FROM (SELECT email, role FROM actor) a$$), (SELECT count(*)::text FROM actor),
          'rc_admin reads the other actor columns');

-- ---------------------------------------------------------------- login lookup and the public boundary
SELECT is(pg_temp.as_role('rc_auth', $$SELECT actor_id FROM fn_auth_lookup('arjun@example.com')$$), current_setting('wt.act_c'),
          'rc_auth runs fn_auth_lookup');
SELECT throws_ok($$SET LOCAL ROLE rc_auth; SELECT count(*) FROM actor$$, '42501', NULL, 'rc_auth has no table access');
SELECT is(pg_temp.as_role('public_reader', format('SELECT latest_health FROM v_public_passport WHERE passport_uid = %L',
          (SELECT passport_uid::text FROM unit WHERE unit_id = current_setting('wt.battery')::BIGINT))), '86',
          'public_reader reads v_public_passport: health 86');
SELECT throws_ok($$SET LOCAL ROLE public_reader; SELECT count(*) FROM unit$$, '42501', NULL, 'public_reader gets permission denied on unit');
SELECT throws_ok($$SET LOCAL ROLE public_reader; SELECT count(*) FROM lifecycle_event$$, '42501', NULL, 'public_reader gets permission denied on lifecycle_event');

SELECT * FROM finish();
ROLLBACK;
