-- C5 (legal transitions) and C5b (event order in time). Everything rolls back at the end.
BEGIN;
SELECT plan(8);
\o /dev/null
\ir ../fixtures/walkthrough.sql
\o

SELECT set_config('rc.org_id', current_setting('wt.org_p'), true), set_config('rc.actor_id', current_setting('wt.act_p'), true), set_config('rc.role','PRODUCER',true);
SELECT set_config('wt.z', sp_create_unit(current_setting('wt.m_ssd')::INT, 'TRANS-1')::text, true);
CALL sp_record_event(current_setting('wt.z')::BIGINT, 'MANUFACTURED', '2026-09-01T09:00:00Z', current_setting('wt.fac_p')::INT);
CALL sp_record_event(current_setting('wt.z')::BIGINT, 'SOLD',         '2026-09-02T09:00:00Z', current_setting('wt.fac_p')::INT);

SELECT throws_ok(format($f$CALL sp_record_event(%s, 'REINSTALLED', '2026-09-03T09:00:00Z', %s)$f$, current_setting('wt.z'), current_setting('wt.fac_p')),
                 'RC005', NULL, 'T-C5: SOLD -> REINSTALLED is refused');

SELECT set_config('wt.w', sp_create_unit(current_setting('wt.m_ssd')::INT, 'TRANS-2')::text, true);
SELECT throws_ok(format($f$CALL sp_record_event(%s, 'HARVESTED', '2026-09-03T09:00:00Z', %s)$f$, current_setting('wt.w'), current_setting('wt.fac_p')),
                 'RC005', NULL, 'T-C5: a unit with no events cannot start as HARVESTED');

SELECT set_config('rc.org_id', current_setting('wt.org_y'), true), set_config('rc.actor_id', current_setting('wt.act_y'), true), set_config('rc.role','RECYCLER_OPERATOR',true);
SELECT throws_ok(format($f$CALL sp_record_event(%s, 'DIAGNOSED', '2026-09-30T09:00:00Z', %s)$f$, current_setting('wt.laptop_a'), current_setting('wt.fac_y')),
                 'RC005', NULL, 'T-C5: no event may follow RECYCLED (terminal)');

SELECT set_config('rc.org_id', current_setting('wt.org_c'), true), set_config('rc.actor_id', current_setting('wt.act_c'), true), set_config('rc.role','COLLECTOR',true);
CALL sp_record_event(current_setting('wt.z')::BIGINT, 'COLLECTED', '2026-09-30T09:00:00Z', current_setting('wt.fac_c')::INT);
SELECT throws_ok(format($f$CALL sp_record_event(%s, 'DIAGNOSED', '2026-09-29T09:00:00Z', %s)$f$, current_setting('wt.z'), current_setting('wt.fac_c')),
                 'RC011', NULL, 'T-C5b: an event dated before the previous one is refused');

SELECT is((SELECT count(*) FROM lifecycle_event WHERE unit_id = current_setting('wt.z')::BIGINT), 3::BIGINT,
          'refused events left no rows behind');
SELECT is((SELECT count(*) FROM event_transition), 24::BIGINT, 'the transition table holds 24 legal pairs');
SELECT is((SELECT count(*) FROM event_transition WHERE from_type IN ('RECYCLED','DISPOSED')), 0::BIGINT,
          'RECYCLED and DISPOSED are terminal');
SELECT ok(EXISTS (SELECT 1 FROM event_transition WHERE from_type = 'DIAGNOSED' AND to_type = 'REINSTALLED'),
          'DIAGNOSED -> REINSTALLED is legal (walkthrough fix)');

SELECT * FROM finish();
ROLLBACK;
