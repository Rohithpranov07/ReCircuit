-- C4 and Q8: the SHA-256 hash chain, and detection of an edited row. Everything rolls back at the end.
BEGIN;
SELECT plan(8);
\o /dev/null
\ir ../fixtures/walkthrough.sql
\o

SELECT is((SELECT count(*) FROM unit WHERE sp_verify_chain(unit_id) IS NOT NULL), 0::BIGINT,
          'T-C4: every unit''s chain verifies on clean data');
SELECT is((SELECT count(*) FROM (SELECT DISTINCT ON (unit_id) prev_hash FROM lifecycle_event ORDER BY unit_id, event_id) f
            WHERE f.prev_hash IS NOT NULL), 0::BIGINT, 'a unit''s first event has no previous hash');
SELECT is((SELECT count(*) FROM (SELECT prev_hash, LAG(event_hash) OVER (PARTITION BY unit_id ORDER BY event_id) AS expected
                                   FROM lifecycle_event) x
            WHERE x.expected IS NOT NULL AND x.prev_hash IS DISTINCT FROM x.expected), 0::BIGINT,
          'every later event links to the hash of its predecessor');

-- the digest contract, recomputed independently of fn_event_digest
SELECT is((SELECT encode(e.event_hash, 'hex') FROM lifecycle_event e
            WHERE e.unit_id = current_setting('wt.battery')::BIGINT ORDER BY e.event_id LIMIT 1),
          (SELECT encode(digest('GENESIS|' || e.unit_id || '|MANUFACTURED|2023-03-10T10:00:00.000000Z|' || e.facility_id || '|' || e.actor_id, 'sha256'), 'hex')
             FROM lifecycle_event e WHERE e.unit_id = current_setting('wt.battery')::BIGINT ORDER BY e.event_id LIMIT 1),
          'the genesis hash follows the documented input format');

SELECT set_config('rc.org_id', current_setting('wt.org_c'), true), set_config('rc.actor_id', current_setting('wt.act_c'), true), set_config('rc.role','COLLECTOR',true);
SELECT throws_ok(
  format($f$CALL sp_record_event(%s, 'DIAGNOSED', now() + interval '1 day', %s)$f$, current_setting('wt.board_lost'), current_setting('wt.fac_c')),
  '23514', NULL, 'future-dated events are refused (occurred_at <= recorded_at)');

-- tamper: a superuser edits the facility of the battery's HARVESTED event
CREATE TEMP TABLE tampered AS
  SELECT event_id FROM lifecycle_event
   WHERE unit_id = current_setting('wt.battery')::BIGINT AND event_type = 'HARVESTED';
ALTER TABLE lifecycle_event DISABLE TRIGGER trg_event_immutable;
UPDATE lifecycle_event SET facility_id = current_setting('wt.fac_p')::INT WHERE event_id = (SELECT event_id FROM tampered);
ALTER TABLE lifecycle_event ENABLE TRIGGER trg_event_immutable;

SELECT is(sp_verify_chain(current_setting('wt.battery')::BIGINT), (SELECT event_id FROM tampered),
          'T-C4/Q8: sp_verify_chain reports the first broken link after an edit');
SELECT is(sp_verify_chain(current_setting('wt.laptop_a')::BIGINT), NULL::BIGINT, 'other units'' chains still verify');
SELECT is((SELECT chain_verified FROM v_public_passport
            WHERE passport_uid = (SELECT passport_uid FROM unit WHERE unit_id = current_setting('wt.battery')::BIGINT)),
          false, 'the public passport shows the chain as not verified');

SELECT * FROM finish();
ROLLBACK;
