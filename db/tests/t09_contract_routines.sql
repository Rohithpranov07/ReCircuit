-- pgTAP: one success and one failure per contract routine (build playbook B.3, task T1.6).
-- Runs as the superuser inside one transaction that is rolled back; contexts are set with set_config.
BEGIN;
SELECT plan(38);

-- ---------------------------------------------------------------- fixtures (fixed ids, rolled back)
INSERT INTO organization (org_id, org_name, org_type) VALUES
  (9001,'Demo Producer 91','PRODUCER'), (9002,'Demo Recycler 92','RECYCLER'),
  (9003,'Demo Collector 93','COLLECTOR'), (9004,'Demo Producer 94','PRODUCER');
INSERT INTO facility (facility_id, org_id, facility_name, pincode) VALUES
  (9001,9001,'Producer Plant','600001'), (9002,9002,'Recycler Plant','600002'),
  (9003,9003,'Collector Hub','600003'), (9004,9004,'Other Plant','600004');
INSERT INTO actor (actor_id, facility_id, full_name, role, email, password_hash) VALUES
  (9001,9001,'Demo Producer','PRODUCER','prod91@example.com','hash'),
  (9002,9002,'Demo Recycler','RECYCLER_OPERATOR','rec92@example.com','hash'),
  (9005,9001,'Demo Admin','ADMIN','admin91@example.com','hash');
INSERT INTO material (material_id, material_name, is_critical) VALUES (9001,'Test Cobalt',true);
INSERT INTO part_model (model_id, manufacturer_id, model_number, category, mass_g)
  VALUES (9004, 9004, 'OTHER-PRODUCER-MODEL', 'OTHER', 5);
CREATE TEMP TABLE ctx (k TEXT PRIMARY KEY, v BIGINT);

-- ================================================================ producer context
SELECT set_config('rc.org_id','9001',true), set_config('rc.actor_id','9001',true), set_config('rc.role','PRODUCER',true);

-- sp_register_model
INSERT INTO ctx SELECT 'dev',  sp_register_model('LTP-14','DEVICE',1500.00,'{"form_factor":"laptop"}');
INSERT INTO ctx SELECT 'bat',  sp_register_model('BP-56Wh','BATTERY',250.00);
SELECT cmp_ok((SELECT v FROM ctx WHERE k='dev'), '>', 0::BIGINT, 'sp_register_model returns a model id');
SELECT throws_ok($$SELECT sp_register_model('BP-BAD','BATTERY',10,'{"bogus":1}')$$, 'RC012', NULL,
                 'sp_register_model rejects an unknown spec key (RC012)');

-- sp_set_materials
SELECT lives_ok(format($f$CALL sp_set_materials(%s, '[{"material_id":9001,"mass_mg":1200.5}]')$f$,
                       (SELECT v FROM ctx WHERE k='bat')), 'sp_set_materials replaces the composition');
SELECT is((SELECT count(*) FROM model_material WHERE model_id=(SELECT v FROM ctx WHERE k='bat')), 1::BIGINT,
          'composition holds one material row');
SELECT throws_ok($$CALL sp_set_materials(9004, '[{"material_id":9001,"mass_mg":1}]')$$, '42501', NULL,
                 'sp_set_materials refuses another producer''s model');

-- sp_set_target
CALL sp_set_target('ITEW2','2026-27',100);
CALL sp_set_target('ITEW2','2026-27',150);
SELECT is((SELECT target_kg FROM epr_target WHERE producer_id=9001 AND category='ITEW2' AND financial_year='2026-27'),
          150.000::NUMERIC, 'sp_set_target upserts for the caller''s organisation');
SELECT throws_ok($$CALL sp_set_target('ITEW2','2026-27',-1)$$, '23514', NULL, 'sp_set_target refuses a non-positive target');

-- sp_create_unit
INSERT INTO ctx SELECT 'dev1', sp_create_unit((SELECT v FROM ctx WHERE k='dev')::INT, 'LAP-1', '2023-03-10');
INSERT INTO ctx SELECT 'bat1', sp_create_unit((SELECT v FROM ctx WHERE k='bat')::INT, 'BAT-1', '2023-03-10',
                                              (SELECT v FROM ctx WHERE k='dev1'));
SELECT cmp_ok((SELECT v FROM ctx WHERE k='dev1'), '>', 0::BIGINT, 'sp_create_unit returns a unit id');
SELECT is((SELECT count(*) FROM assembly_link WHERE child_unit_id=(SELECT v FROM ctx WHERE k='bat1')
             AND parent_unit_id=(SELECT v FROM ctx WHERE k='dev1') AND removed_at IS NULL), 1::BIGINT,
          'sp_create_unit with a parent opens one assembly period');
SELECT throws_ok(format($f$SELECT sp_create_unit(%s,'LAP-1')$f$, (SELECT v FROM ctx WHERE k='dev')), '23505', NULL,
                 'sp_create_unit refuses a duplicate (model, serial)');

-- sp_bulk_create_units
SELECT is(array_length(sp_bulk_create_units(format('[{"model_id":%s,"serial_no":"BULK-1"},{"model_id":%s,"serial_no":"BULK-2","manufactured_on":"2026-01-31"}]',
                                                   (SELECT v FROM ctx WHERE k='dev'), (SELECT v FROM ctx WHERE k='dev'))::JSONB), 1), 2,
          'sp_bulk_create_units returns one id per element');
SELECT throws_ok(format($f$SELECT sp_bulk_create_units('[{"model_id":%s,"serial_no":"BULK-3"},{"model_id":%s,"serial_no":"BULK-1"}]')$f$,
                        (SELECT v FROM ctx WHERE k='dev'), (SELECT v FROM ctx WHERE k='dev')), '23505', NULL,
                 'sp_bulk_create_units fails on a duplicate element');
SELECT is((SELECT count(*) FROM unit WHERE serial_no='BULK-3'), 0::BIGINT,
          'sp_bulk_create_units is all-or-nothing');

-- sp_record_tests (needs a unit that may become DIAGNOSED)
DO $$ DECLARE v_dev1 BIGINT := (SELECT v FROM ctx WHERE k='dev1'); BEGIN CALL sp_record_event(v_dev1::BIGINT, 'COLLECTED', '2026-09-01T09:00:00Z', 9001); END $$;
SELECT lives_ok(format($f$CALL sp_record_tests(%s,'2026-09-02T09:00:00Z',9001,'[{"test_type":"BATTERY_SOH","result":"PASS","measured_value":86,"health_score":86}]')$f$,
                       (SELECT v FROM ctx WHERE k='dev1')), 'sp_record_tests records a DIAGNOSED event with its tests');
SELECT is((SELECT count(*) FROM diagnostic_test t JOIN lifecycle_event e USING (event_id)
            WHERE e.unit_id=(SELECT v FROM ctx WHERE k='dev1') AND e.event_type='DIAGNOSED'), 1::BIGINT,
          'exactly one test row hangs off the DIAGNOSED event');
SELECT throws_ok(format($f$CALL sp_record_tests(%s,'2026-09-03T09:00:00Z',9001,'[{"test_type":"BATTERY_SOH","result":"PASS","health_score":101}]')$f$,
                        (SELECT v FROM ctx WHERE k='dev1')), '23514', NULL,
                 'sp_record_tests refuses a score above 100');
SELECT is((SELECT count(*) FROM lifecycle_event WHERE unit_id=(SELECT v FROM ctx WHERE k='dev1') AND event_type='DIAGNOSED'),
          1::BIGINT, 'the failed call left no extra DIAGNOSED event');

-- sp_create_transfer
INSERT INTO ctx SELECT 'mf1', sp_create_transfer('MF-T-1', 9002, '2026-09-04T09:00:00Z', 1.5,
       format('[{"unit_id":%s,"declared_condition":"WORKING"}]', (SELECT v FROM ctx WHERE k='dev1'))::JSONB);
SELECT is((SELECT count(*) FROM transfer_item WHERE transfer_id=(SELECT v FROM ctx WHERE k='mf1')), 1::BIGINT,
          'sp_create_transfer stores the manifest with its item');
SELECT throws_ok(format($f$SELECT sp_create_transfer('MF-T-2',9002,'2026-09-05T09:00:00Z',1.5,'[{"unit_id":%s,"declared_condition":"WORKING"}]')$f$,
                        (SELECT v FROM ctx WHERE k='dev1')), 'RC008', NULL,
                 'sp_create_transfer refuses a unit already on an open manifest (RC008)');

-- ================================================================ recycler context
SELECT set_config('rc.org_id','9002',true), set_config('rc.actor_id','9002',true), set_config('rc.role','RECYCLER_OPERATOR',true);
INSERT INTO ctx SELECT 'rec1', sp_create_unit((SELECT v FROM ctx WHERE k='dev')::INT, 'REC-1');
INSERT INTO ctx SELECT 'rec2', sp_create_unit((SELECT v FROM ctx WHERE k='dev')::INT, 'REC-2');
DO $$ DECLARE v_rec1 BIGINT := (SELECT v FROM ctx WHERE k='rec1'); BEGIN CALL sp_record_event(v_rec1::BIGINT, 'COLLECTED', '2026-09-10T09:00:00Z', 9002); END $$;
DO $$ DECLARE v_rec1 BIGINT := (SELECT v FROM ctx WHERE k='rec1'); BEGIN CALL sp_record_event(v_rec1::BIGINT, 'RECYCLED',  '2026-09-11T09:00:00Z', 9002); END $$;
DO $$ DECLARE v_rec2 BIGINT := (SELECT v FROM ctx WHERE k='rec2'); BEGIN CALL sp_record_event(v_rec2::BIGINT, 'COLLECTED', '2026-09-10T09:00:00Z', 9002); END $$;
DO $$ DECLARE v_rec2 BIGINT := (SELECT v FROM ctx WHERE k='rec2'); BEGIN CALL sp_record_event(v_rec2::BIGINT, 'RECYCLED',  '2026-09-11T09:00:00Z', 9002); END $$;

-- sp_issue_certificate (C10b is deferred to COMMIT, so force the check inside the test)
INSERT INTO ctx SELECT 'cert1', sp_issue_certificate('RC-T-001','ITEW2',0.9,'2026-27','2026-10-01',
       format('[{"unit_id":%s,"recovered_mass_g":1100}]', (SELECT v FROM ctx WHERE k='rec1'))::JSONB);
SELECT lives_ok($$SET CONSTRAINTS ALL IMMEDIATE$$, 'sp_issue_certificate: 0.9 kg claimed, 1.1 kg backed passes the COMMIT check');
SET CONSTRAINTS ALL DEFERRED;
SELECT is((SELECT count(*) FROM audit_log WHERE action='CERT_ISSUE' AND entity_id=(SELECT v FROM ctx WHERE k='cert1')::TEXT),
          1::BIGINT, 'sp_issue_certificate writes one CERT_ISSUE audit row');
SELECT throws_ok(format($f$SELECT sp_issue_certificate('RC-T-002','ITEW2',0.5,'2026-27','2026-10-01','[{"unit_id":%s,"recovered_mass_g":900}]')$f$,
                        (SELECT v FROM ctx WHERE k='dev1')), 'RC009', NULL,
                 'sp_issue_certificate refuses a unit not recycled by the issuer (RC009)');
SELECT throws_ok(format($f$SELECT sp_issue_certificate('RC-T-003','ITEW2',5,'2026-27','2026-10-01','[{"unit_id":%s,"recovered_mass_g":1100}]'); SET CONSTRAINTS ALL IMMEDIATE$f$,
                        (SELECT v FROM ctx WHERE k='rec2')), 'RC010', NULL,
                 'sp_issue_certificate: 5 kg claimed against 1.1 kg backed fails (RC010)');

-- sp_allocate_certificate
DO $$ DECLARE v_cert1 BIGINT := (SELECT v FROM ctx WHERE k='cert1'); BEGIN CALL sp_allocate_certificate(v_cert1, 9001); END $$;
SELECT is((SELECT producer_id FROM epr_certificate WHERE cert_id=(SELECT v FROM ctx WHERE k='cert1')), 9001,
          'sp_allocate_certificate sets the producer');
SELECT is((SELECT count(*) FROM audit_log WHERE action='CERT_ALLOCATE' AND entity_id=(SELECT v FROM ctx WHERE k='cert1')::TEXT),
          1::BIGINT, 'sp_allocate_certificate writes one CERT_ALLOCATE audit row');
SELECT throws_ok(format($f$CALL sp_allocate_certificate(%s, 9004)$f$, (SELECT v FROM ctx WHERE k='cert1')), 'RC015', NULL,
                 'sp_allocate_certificate refuses a second allocation (RC015)');
SELECT throws_ok(format($f$CALL sp_allocate_certificate(%s, 9002)$f$, (SELECT v FROM ctx WHERE k='cert1')), 'RC016', NULL,
                 'sp_allocate_certificate refuses a non-producer (RC016)');

-- ================================================================ admin context
SELECT set_config('rc.org_id','9001',true), set_config('rc.actor_id','9005',true), set_config('rc.role','ADMIN',true);

INSERT INTO ctx SELECT 'org', sp_admin_create_org('Demo Collector 95','COLLECTOR','CPCB-T-95','27AAAAA0000A1Z5');
SELECT cmp_ok((SELECT v FROM ctx WHERE k='org'), '>', 0::BIGINT, 'sp_admin_create_org returns an org id');
SELECT throws_ok($$SELECT sp_admin_create_org('Bad Type Org','NOT_A_TYPE',NULL,NULL)$$, '23514', NULL,
                 'sp_admin_create_org refuses an unknown organisation type');

INSERT INTO ctx SELECT 'fac', sp_admin_create_facility((SELECT v FROM ctx WHERE k='org')::INT, 'Hub 95', '600095', 12.5);
SELECT cmp_ok((SELECT v FROM ctx WHERE k='fac'), '>', 0::BIGINT, 'sp_admin_create_facility returns a facility id');
SELECT throws_ok(format($f$SELECT sp_admin_create_facility(%s,'Bad Pin','012345')$f$, (SELECT v FROM ctx WHERE k='org')),
                 '23514', NULL, 'sp_admin_create_facility refuses a bad pincode');

INSERT INTO ctx SELECT 'act', sp_admin_create_actor((SELECT v FROM ctx WHERE k='fac')::INT, 'Demo Collector','COLLECTOR','col95@example.com','hash');
SELECT is((SELECT count(*) FROM audit_log WHERE action='ACTOR_CREATE' AND entity_id=(SELECT v FROM ctx WHERE k='act')::TEXT),
          1::BIGINT, 'sp_admin_create_actor writes one ACTOR_CREATE audit row');
SELECT throws_ok(format($f$SELECT sp_admin_create_actor(%s,'Dup','COLLECTOR','col95@example.com','hash')$f$, (SELECT v FROM ctx WHERE k='fac')),
                 '23505', NULL, 'sp_admin_create_actor refuses a duplicate email');

DO $$ DECLARE v_act BIGINT := (SELECT v FROM ctx WHERE k='act'); BEGIN CALL sp_admin_set_actor_active(v_act::INT, false); END $$;
SELECT is((SELECT is_active FROM actor WHERE actor_id=(SELECT v FROM ctx WHERE k='act')), false,
          'sp_admin_set_actor_active deactivates the actor');
SELECT throws_ok($$CALL sp_admin_set_actor_active(999999, true)$$, '23514', NULL,
                 'sp_admin_set_actor_active refuses an unknown actor');

-- fn_auth_lookup
SELECT is((SELECT actor_id FROM fn_auth_lookup('col95@example.com')), (SELECT v FROM ctx WHERE k='act')::INT,
          'fn_auth_lookup finds the actor by email');
SELECT is((SELECT count(*) FROM fn_auth_lookup('nobody@example.com')), 0::BIGINT,
          'fn_auth_lookup returns no row for an unknown email');

-- sp_refresh_material_recovery: the materialized view arrives with migration 011
SELECT CASE WHEN to_regclass('public.mv_material_recovery') IS NULL
            THEN skip('mv_material_recovery does not exist yet (migration 011)', 1)
            ELSE lives_ok($$CALL sp_refresh_material_recovery()$$, 'sp_refresh_material_recovery refreshes the view')
       END;

SELECT * FROM finish();
ROLLBACK;
