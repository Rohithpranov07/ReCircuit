-- Part trees in time, reuse inventory, current state, custody gaps, material recovery, public passport.
BEGIN;
SELECT plan(17);
\o /dev/null
\ir ../fixtures/walkthrough.sql
\o

-- part tree on a past date (Q2)
SELECT is((SELECT count(*) FROM fn_part_tree(current_setting('wt.laptop_a')::BIGINT, '2026-01-01T00:00:00Z')), 4::BIGINT,
          'Q2: laptop A held four parts on 2026-01-01');
SELECT is((SELECT count(*) FROM fn_part_tree(current_setting('wt.laptop_a')::BIGINT)), 0::BIGINT, 'Q2: laptop A holds nothing now');
SELECT is((SELECT array_agg(unit_id) FROM fn_part_tree(current_setting('wt.laptop_b')::BIGINT)),
          ARRAY[current_setting('wt.battery')::BIGINT], 'Q2: laptop B holds the reinstalled battery now');
SELECT is((SELECT count(*) FROM fn_part_tree(current_setting('wt.laptop_a')::BIGINT, '2026-09-01T09:14:59Z')), 4::BIGINT,
          'Q2: one second before the dismantle the parts are still inside');
SELECT is((SELECT count(*) FROM fn_part_tree(current_setting('wt.laptop_a')::BIGINT, '2026-09-01T09:15:00Z')), 0::BIGINT,
          'Q2: at the dismantle instant the parts are out (half-open period)');
SELECT is((SELECT count(*) FROM fn_part_tree(current_setting('wt.laptop_a')::BIGINT, '2023-03-09T00:00:00Z')), 0::BIGINT,
          'Q2: before manufacture there was nothing');
SELECT is((SELECT array_agg(parent_unit_id ORDER BY installed_at) FROM assembly_link WHERE child_unit_id = current_setting('wt.battery')::BIGINT),
          ARRAY[current_setting('wt.laptop_a')::BIGINT, current_setting('wt.laptop_b')::BIGINT],
          'FR-5.7: the battery has been inside laptop A, then laptop B');

-- reuse inventory (Q4)
SELECT is((SELECT latest_health FROM v_reuse_inventory WHERE unit_id = current_setting('wt.battery2')::BIGINT), 86::SMALLINT,
          'Q4: the loose battery is listed with health 86');
SELECT is((SELECT count(*) FROM v_reuse_inventory WHERE unit_id = current_setting('wt.battery')::BIGINT), 0::BIGINT,
          'Q4: the reinstalled battery is no longer loose stock');
SELECT is((SELECT array_agg(unit_id) FROM v_reuse_inventory WHERE category = 'BATTERY' AND latest_health >= 80),
          ARRAY[current_setting('wt.battery2')::BIGINT], 'Q4: category BATTERY with min health 80 returns only the loose battery');

-- current state and holder (Q3)
SELECT is((SELECT current_state FROM v_unit_current WHERE unit_id = current_setting('wt.laptop_a')::BIGINT), 'RECYCLED', 'Q3: laptop A is RECYCLED');
SELECT is((SELECT current_holder_org_id FROM v_unit_current WHERE unit_id = current_setting('wt.battery')::BIGINT),
          current_setting('wt.org_r')::INT, 'Q3: the battery is held by the refurbisher');

-- custody gaps (Q7, TRD section 9): exactly the seeded gap
SELECT is((SELECT array_agg(DISTINCT e.unit_id) FROM lifecycle_event e
            WHERE fn_org_of_facility(e.facility_id) <> COALESCE(
                    (SELECT fn_org_of_facility(f.facility_id) FROM lifecycle_event f WHERE f.unit_id = e.unit_id ORDER BY f.event_id LIMIT 1), -1)
              AND NOT EXISTS (SELECT 1 FROM transfer_item ti JOIN custody_transfer ct USING (transfer_id)
                              WHERE ti.unit_id = e.unit_id AND ct.to_org_id = fn_org_of_facility(e.facility_id)
                                AND ct.received_at IS NOT NULL AND ct.received_at <= e.occurred_at)),
          ARRAY[current_setting('wt.board_gap')::BIGINT], 'Q7: the one unit with no manifest is listed, with no false positives');

-- material recovery (Q5)
SELECT lives_ok($$CALL sp_refresh_material_recovery()$$, 'Q5: the materialized view refreshes concurrently');
SELECT is((SELECT recovered_kg FROM mv_material_recovery
            WHERE recycler_id = current_setting('wt.org_y')::INT AND material_name = 'Demo Copper'),
          1.000::NUMERIC, 'Q5: one recycled laptop recovered 1 kg of copper (nominal)');

-- public passport and staff passport (Q1)
SELECT columns_are('public', 'v_public_passport',
  ARRAY['passport_uid','model_number','category','manufacturer','manufactured_on','current_state','history','latest_health','chain_verified'],
  'the public view exposes exactly the PublicPassport fields');
SELECT results_eq(
  format($f$SELECT latest_health, chain_verified, (SELECT array_agg(h->>'type') FROM jsonb_array_elements(history) h)
            FROM v_public_passport WHERE passport_uid = (SELECT passport_uid FROM unit WHERE unit_id = %s)$f$, current_setting('wt.battery')),
  $$VALUES (86::SMALLINT, true, ARRAY['MANUFACTURED','COLLECTED','HARVESTED','DIAGNOSED','REINSTALLED']::TEXT[])$$,
  'public passport: health 86, chain verified, five history entries');

SELECT * FROM finish();
ROLLBACK;
