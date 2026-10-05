-- C6 (harvest closes the link), dismantle ordering and atomicity, C7 (tests only on DIAGNOSED events).
BEGIN;
SELECT plan(9);
\o /dev/null
\ir ../fixtures/walkthrough.sql
\o

SELECT set_config('rc.org_id', current_setting('wt.org_c'), true), set_config('rc.actor_id', current_setting('wt.act_c'), true), set_config('rc.role','COLLECTOR',true);

-- T-C6: a COLLECTED loose unit that was never installed cannot be harvested
SELECT throws_ok(format($f$CALL sp_harvest(%s, '2026-09-25T09:00:00Z', %s)$f$, current_setting('wt.board_lost'), current_setting('wt.fac_c')),
                 'RC006', NULL, 'T-C6: harvesting a unit that is not installed is refused');
SELECT is((SELECT current_state FROM v_unit_current WHERE unit_id = current_setting('wt.board_lost')::BIGINT), 'COLLECTED',
          'T-C6: the refusal left the unit COLLECTED');
SELECT is((SELECT removed_at FROM assembly_link
            WHERE child_unit_id = current_setting('wt.battery')::BIGINT AND parent_unit_id = current_setting('wt.laptop_a')::BIGINT),
          '2026-09-01T09:15:00Z'::TIMESTAMPTZ, 'T-C6: harvesting closed the period at the event time');
SELECT is((SELECT string_agg(event_type, ',' ORDER BY event_id) FROM lifecycle_event WHERE unit_id = current_setting('wt.battery')::BIGINT),
          'MANUFACTURED,COLLECTED,HARVESTED,DIAGNOSED,REINSTALLED',
          'sp_dismantle recorded COLLECTED before HARVESTED for a factory-assembled part');

-- US-2: if any part fails, nothing is written
SELECT throws_ok(
  format($f$CALL sp_dismantle(%s, '[{"model_id":%s,"serial_no":"ATOMIC-1"},{"model_id":999999,"serial_no":"ATOMIC-2"}]', '2026-09-26T09:00:00Z', %s)$f$,
         current_setting('wt.laptop_b'), current_setting('wt.m_ssd'), current_setting('wt.fac_c')),
  '23503', NULL, 'sp_dismantle fails when one part is invalid');
SELECT is((SELECT count(*) FROM unit WHERE serial_no = 'ATOMIC-1'), 0::BIGINT, 'sp_dismantle is atomic: the valid part was not kept');

-- T-C7
SELECT throws_ok(
  format($f$INSERT INTO diagnostic_test (event_id, test_type, result, health_score) VALUES (%s, 'BATTERY_SOH', 'PASS', 90)$f$,
         (SELECT event_id FROM lifecycle_event WHERE unit_id = current_setting('wt.battery')::BIGINT AND event_type = 'HARVESTED')),
  'RC007', NULL, 'T-C7: a test on a HARVESTED event is refused');
SELECT throws_ok(
  format($f$INSERT INTO diagnostic_test (event_id, test_type, result, health_score) VALUES (%s, 'BATTERY_SOH', 'PASS', 101)$f$,
         (SELECT event_id FROM lifecycle_event WHERE unit_id = current_setting('wt.battery')::BIGINT AND event_type = 'DIAGNOSED')),
  '23514', NULL, 'a health score above 100 is refused (CHECK)');
SELECT is((SELECT health_score FROM diagnostic_test t JOIN lifecycle_event e USING (event_id)
            WHERE e.unit_id = current_setting('wt.battery')::BIGINT), 86::SMALLINT, 'the stored score is 86');

SELECT * FROM finish();
ROLLBACK;
