-- C8 (one open manifest per unit), receiver-only receipt, RC013, derived holder. Rolls back at the end.
BEGIN;
SELECT plan(11);
\o /dev/null
\ir ../fixtures/walkthrough.sql
\o

SELECT set_config('rc.org_id', current_setting('wt.org_c'), true), set_config('rc.actor_id', current_setting('wt.act_c'), true), set_config('rc.role','COLLECTOR',true);
SELECT set_config('wt.u1', sp_create_unit(current_setting('wt.m_ssd')::INT, 'CUSTODY-1')::text, true);
SELECT set_config('wt.x1', sp_create_transfer('MF-T-X1', current_setting('wt.org_y')::INT, '2026-09-26T08:00:00Z', 1,
  format('[{"unit_id":%s,"declared_condition":"FAULTY"}]', current_setting('wt.u1'))::jsonb)::text, true);

SELECT throws_ok(
  format($f$SELECT sp_create_transfer('MF-T-X2', %s, '2026-09-26T09:00:00Z', 1, '[{"unit_id":%s,"declared_condition":"FAULTY"}]')$f$,
         current_setting('wt.org_r'), current_setting('wt.u1')),
  'RC008', NULL, 'T-C8: a unit on an open manifest cannot go on a second one');
SELECT throws_ok(format($f$SELECT sp_create_transfer('MF-T-X3', %s, '2026-09-26T09:00:00Z', 1, '[{"unit_id":%s,"declared_condition":"FAULTY"}]')$f$,
                        current_setting('wt.org_c'), current_setting('wt.u1')),
                 '23514', NULL, 'a manifest cannot go from an organisation to itself');
SELECT throws_ok($f$SELECT sp_create_transfer('MF-T-X4', 1, '2026-09-26T09:00:00Z', 1, '[]')$f$,
                 '23514', NULL, 'a manifest needs at least one unit');

-- receipt rules
SELECT throws_ok(format($f$CALL sp_receive_transfer(%s, '2026-09-27T08:00:00Z')$f$, current_setting('wt.x1')),
                 'RC014', NULL, 'the sender cannot confirm receipt (RC014)');
SELECT set_config('rc.org_id', current_setting('wt.org_r'), true), set_config('rc.actor_id', current_setting('wt.act_r'), true), set_config('rc.role','TECHNICIAN',true);
SELECT throws_ok(format($f$CALL sp_receive_transfer(%s, '2026-09-27T08:00:00Z')$f$, current_setting('wt.x1')),
                 'RC014', NULL, 'a third organisation cannot confirm receipt (RC014)');
SELECT set_config('rc.org_id', current_setting('wt.org_y'), true), set_config('rc.actor_id', current_setting('wt.act_y'), true), set_config('rc.role','RECYCLER_OPERATOR',true);
SELECT throws_ok(format($f$CALL sp_receive_transfer(%s, '2026-09-25T08:00:00Z')$f$, current_setting('wt.x1')),
                 '23514', NULL, 'receipt before shipment is refused (CHECK)');
SELECT lives_ok(format($f$CALL sp_receive_transfer(%s, '2026-09-27T08:00:00Z')$f$, current_setting('wt.x1')),
                'the receiving organisation confirms receipt');
SELECT is((SELECT current_holder_org_id FROM v_unit_current WHERE unit_id = current_setting('wt.u1')::BIGINT),
          current_setting('wt.org_y')::INT, 'the holder is the receiver of the latest received manifest');
SELECT throws_ok(format($f$CALL sp_receive_transfer(%s, '2026-09-28T08:00:00Z')$f$, current_setting('wt.x1')),
                 'RC014', NULL, 'a manifest cannot be received twice (RC014)');

-- fixture facts
SELECT is((SELECT array_agg(unit_id || ':' || kind) FROM transfer_discrepancy WHERE transfer_id = current_setting('wt.mf2')::BIGINT),
          ARRAY[current_setting('wt.board_lost') || ':MISSING'], 'the missing unit was recorded as a discrepancy');

-- RC013: an event at another organisation's facility
SELECT set_config('rc.org_id', current_setting('wt.org_c'), true), set_config('rc.actor_id', current_setting('wt.act_c'), true), set_config('rc.role','COLLECTOR',true);
SELECT throws_ok(format($f$CALL sp_record_event(%s, 'DIAGNOSED', '2026-09-26T09:00:00Z', %s)$f$, current_setting('wt.board_lost'), current_setting('wt.fac_y')),
                 'RC013', NULL, 'RC013: an event cannot be recorded at another organisation''s facility');

SELECT * FROM finish();
ROLLBACK;
