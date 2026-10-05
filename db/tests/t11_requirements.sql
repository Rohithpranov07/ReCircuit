-- Requirement checks that the rule tests do not already cover (traceability matrix, T6.3). Rolls back at the end.
BEGIN;
SELECT plan(22);
\o /dev/null
\ir ../fixtures/walkthrough.sql
\o

-- FR-1.3 one role, one facility
SELECT throws_ok(format($f$INSERT INTO actor (facility_id, full_name, role, email, password_hash) VALUES (%s,'X','JANITOR','j@example.com','h')$f$, current_setting('wt.fac_c')),
                 '23514', NULL, 'FR-1.3: an actor role outside the six allowed roles fails the CHECK');
SELECT throws_ok($$INSERT INTO actor (facility_id, full_name, role, email, password_hash) VALUES (NULL,'X','ADMIN','k@example.com','h')$$,
                 '23502', NULL, 'FR-1.3: an actor must belong to a facility');

-- FR-2.1 / FR-2.2 organisations
SELECT throws_ok($$SELECT sp_admin_create_org('Dup','RECYCLER','CPCB-DEMO-C01',NULL)$$, '23505', NULL, 'FR-2.1: a duplicate CPCB number is refused');
SELECT throws_ok($$SELECT sp_admin_create_org('Dup2','RECYCLER',NULL,'27DEMOC0001A1Z2')$$, '23505', NULL, 'FR-2.1: a duplicate GSTIN is refused');
SELECT throws_ok($$INSERT INTO organization (org_name, org_type, gstin) VALUES ('Long','RECYCLER','27DEMOXXXXXXXXXXXXXXXXXXXX')$$,
                 '22001', NULL, 'FR-2.1: a GSTIN longer than 15 characters is refused');

-- FR-4.5 nothing "current" is stored on the unit
SELECT columns_are('public', 'unit', ARRAY['unit_id','model_id','serial_no','passport_uid','manufactured_on'],
                   'FR-4.5: unit has no status, holder or parent column');

-- FR-6.1 only the nine event types
SELECT set_config('rc.org_id', current_setting('wt.org_c'), true), set_config('rc.actor_id', current_setting('wt.act_c'), true), set_config('rc.role','COLLECTOR',true);
SELECT throws_ok(format($f$CALL sp_record_event(%s,'LOST','2026-09-27T09:00:00Z',%s)$f$, current_setting('wt.board_lost'), current_setting('wt.fac_c')),
                 'RC005', NULL, 'FR-6.1: an event type outside the nine is refused');
SELECT is((SELECT count(DISTINCT event_type) FROM lifecycle_event WHERE event_type IN
            ('MANUFACTURED','SOLD','COLLECTED','DIAGNOSED','HARVESTED','REFURBISHED','REINSTALLED','RECYCLED','DISPOSED')) > 0, true,
          'FR-6.1: the walkthrough records events of the allowed types');
SELECT ok(EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'lifecycle_event'::regclass AND contype = 'c'
                  AND pg_get_constraintdef(oid) LIKE '%MANUFACTURED%DISPOSED%'), 'FR-6.1: the event_type CHECK constraint lists the nine types');

-- FR-6.6 a correction is a new event that points at the one it corrects; the original is untouched
DO $$ DECLARE v_orig BIGINT := (SELECT event_id FROM lifecycle_event WHERE unit_id = current_setting('wt.board_lost')::BIGINT AND event_type = 'COLLECTED');
BEGIN CALL sp_record_event(current_setting('wt.board_lost')::BIGINT, 'DIAGNOSED', '2026-09-27T09:00:00Z', current_setting('wt.fac_c')::INT, v_orig); END $$;
SELECT is((SELECT corrects_event_id FROM lifecycle_event WHERE unit_id = current_setting('wt.board_lost')::BIGINT AND event_type = 'DIAGNOSED'),
          (SELECT event_id FROM lifecycle_event WHERE unit_id = current_setting('wt.board_lost')::BIGINT AND event_type = 'COLLECTED'),
          'FR-6.6: a correction event references the event it corrects');
SELECT is((SELECT count(*) FROM lifecycle_event WHERE unit_id = current_setting('wt.board_lost')::BIGINT AND event_type = 'COLLECTED'), 1::BIGINT,
          'FR-6.6: the original event is unchanged');

-- FR-8.2 manifest mass and declared condition
SELECT throws_ok(format($f$INSERT INTO custody_transfer (manifest_no, from_org_id, to_org_id, shipped_at, total_mass_kg) VALUES ('MF-T11',%s,%s,'2026-09-01T00:00:00Z',0)$f$,
                        current_setting('wt.org_c'), current_setting('wt.org_y')), '23514', NULL, 'FR-8.2: a manifest mass of zero is refused');
SELECT throws_ok(format($f$INSERT INTO transfer_item (transfer_id, unit_id, declared_condition) VALUES (%s,%s,'PERFECT')$f$, current_setting('wt.mf1'), current_setting('wt.board_gap')),
                 '23514', NULL, 'FR-8.2: a declared condition outside WORKING, FAULTY, SCRAP is refused');

-- FR-9.1 certificate fields
SELECT throws_ok(format($f$INSERT INTO epr_certificate (cert_no, recycler_id, category, quantity_kg, financial_year, issued_on) VALUES ('X-FY',%s,'ITEW2',1,'2026/27','2026-10-01')$f$, current_setting('wt.org_y')),
                 '23514', NULL, 'FR-9.1: a financial year not written YYYY-YY is refused');
SELECT throws_ok(format($f$INSERT INTO epr_certificate (cert_no, recycler_id, category, quantity_kg, financial_year, issued_on) VALUES ('X-KG',%s,'ITEW2',0,'2026-27','2026-10-01')$f$, current_setting('wt.org_y')),
                 '23514', NULL, 'FR-9.1: a quantity of zero kg is refused');
SELECT throws_ok(format($f$INSERT INTO epr_certificate (cert_no, recycler_id, category, quantity_kg, financial_year, issued_on) VALUES ('RC-REC-2026-000412',%s,'ITEW2',1,'2026-27','2026-10-01')$f$, current_setting('wt.org_y')),
                 '23505', NULL, 'FR-9.1: a duplicate certificate number is refused');

-- FR-11.3 passport ids are random UUIDv4
SELECT is((SELECT bool_and(substr(passport_uid::text, 15, 1) = '4' AND substr(passport_uid::text, 20, 1) IN ('8','9','a','b')) FROM unit), true,
          'FR-11.3: every passport id is a version-4 UUID');
SELECT ok(EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'unit_passport_uid_key'), 'FR-11.3 / NFR-7: passport_uid is unique and indexed');

-- NFR-7 the planned indexes exist
SELECT is((SELECT count(*) FROM pg_indexes WHERE indexname IN ('lifecycle_event_unit_time','assembly_link_parent','assembly_link_excl',
            'part_model_spec_gin','diagnostic_test_event','transfer_item_unit','certificate_unit_cert')), 7::BIGINT,
          'NFR-7: the (unit, time), parent, GiST, GIN and join indexes exist');
SELECT is((SELECT count(*) FROM pg_indexes WHERE indexname = 'assembly_link_excl' AND indexdef LIKE '%USING gist%'), 1::BIGINT, 'NFR-7: C1 is backed by a GiST index');
SELECT is((SELECT count(*) FROM pg_indexes WHERE indexname = 'part_model_spec_gin' AND indexdef LIKE '%USING gin%'), 1::BIGINT, 'NFR-7: the spec column has a GIN index');

-- NFR-13 portability: only the two documented extensions
SELECT is((SELECT array_agg(extname ORDER BY extname) FROM pg_extension WHERE extname NOT IN ('plpgsql','pgtap')),
          ARRAY['btree_gist','pgcrypto']::NAME[], 'NFR-13: the only extensions are pgcrypto and btree_gist');

SELECT * FROM finish();
ROLLBACK;
