-- T-C10b at a real COMMIT: the over-claim is refused when the transaction commits, and the whole
-- transaction (including the fixture) is rolled back, so there is nothing to clean up.
-- psql would stop at the failing COMMIT, so error-stopping is switched off for this file only.
\set ON_ERROR_STOP off
SELECT plan(3);
CREATE TEMP TABLE before_counts AS
  SELECT (SELECT count(*) FROM organization) AS orgs, (SELECT count(*) FROM epr_certificate) AS certs;

BEGIN;
\o /dev/null
\ir ../fixtures/walkthrough.sql
\o
SELECT set_config('rc.org_id', current_setting('wt.org_y'), true), set_config('rc.actor_id', current_setting('wt.act_y'), true), set_config('rc.role','RECYCLER_OPERATOR',true);
DO $$ BEGIN PERFORM sp_issue_certificate('RC-T-COMMIT','ITEW2',5,'2026-27','2026-09-30',
  format('[{"unit_id":%s,"recovered_mass_g":1100}]', current_setting('wt.board_gap'))::jsonb); END $$;
COMMIT;   -- RC010 is raised here; PostgreSQL rolls the transaction back

SELECT is((SELECT count(*) FROM epr_certificate), (SELECT certs FROM before_counts),
          'T-C10b: the over-claiming certificate was not committed');
SELECT is((SELECT count(*) FROM organization), (SELECT orgs FROM before_counts),
          'the failed COMMIT rolled back the whole transaction');
SELECT is((SELECT count(*) FROM epr_certificate WHERE cert_no = 'RC-T-COMMIT'), 0::BIGINT, 'no trace of the refused certificate');
SELECT * FROM finish();
