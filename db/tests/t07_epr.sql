-- C9, C10a, C10b and the EPR happy path. Everything rolls back at the end.
BEGIN;
SELECT plan(9);
\o /dev/null
\ir ../fixtures/walkthrough.sql
\o

SELECT set_config('rc.org_id', current_setting('wt.org_y'), true), set_config('rc.actor_id', current_setting('wt.act_y'), true), set_config('rc.role','RECYCLER_OPERATOR',true);

-- T-C9
SELECT throws_ok(
  format($f$SELECT sp_issue_certificate('RC-T-1','ITEW2',0.5,'2026-27','2026-09-30','[{"unit_id":%s,"recovered_mass_g":900}]')$f$, current_setting('wt.board_lost')),
  'RC009', NULL, 'T-C9: a unit that was never recycled cannot back a certificate');
SELECT is((SELECT count(*) FROM epr_certificate WHERE cert_no = 'RC-T-1'), 0::BIGINT, 'T-C9: the refused certificate left no row');
SELECT set_config('rc.org_id', current_setting('wt.org_r'), true), set_config('rc.actor_id', current_setting('wt.act_r'), true), set_config('rc.role','TECHNICIAN',true);
SELECT throws_ok(
  format($f$SELECT sp_issue_certificate('RC-T-2','ITEW2',0.5,'2026-27','2026-09-30','[{"unit_id":%s,"recovered_mass_g":900}]')$f$, current_setting('wt.board')),
  'RC009', NULL, 'T-C9: an organisation that did not recycle the unit cannot certify it');
SELECT set_config('rc.org_id', current_setting('wt.org_y'), true), set_config('rc.actor_id', current_setting('wt.act_y'), true), set_config('rc.role','RECYCLER_OPERATOR',true);

-- T-C10a: the laptop already backs RC-REC-2026-000412
SELECT throws_ok(
  format($f$SELECT sp_issue_certificate('RC-T-3','ITEW2',0.5,'2026-27','2026-09-30','[{"unit_id":%s,"recovered_mass_g":900}]')$f$, current_setting('wt.laptop_a')),
  '23505', 'duplicate key value violates unique constraint "certificate_unit_pkey"',
  'T-C10a: a unit cannot back a second certificate');

-- T-C10b: checked at COMMIT; the check is forced here with SET CONSTRAINTS
SELECT throws_ok(
  format($f$SELECT sp_issue_certificate('RC-T-4','ITEW2',5,'2026-27','2026-09-30','[{"unit_id":%s,"recovered_mass_g":1100}]'); SET CONSTRAINTS ALL IMMEDIATE$f$, current_setting('wt.board')),
  'RC010', NULL, 'T-C10b: 5 kg claimed against 1.1 kg backed is refused');
DO $$ BEGIN PERFORM sp_issue_certificate('RC-T-5','ITEW2',1.1,'2026-27','2026-09-30',
  format('[{"unit_id":%s,"recovered_mass_g":1100}]', current_setting('wt.board'))::jsonb); END $$;
SELECT lives_ok($$SET CONSTRAINTS ALL IMMEDIATE$$, 'T-C10b: claiming exactly what is backed passes');
SET CONSTRAINTS ALL DEFERRED;

-- EPR happy path
SELECT results_eq(
  format($f$SELECT claimed_kg, backed_kg, unit_count FROM v_certificate_backing WHERE cert_id = %s$f$, current_setting('wt.cert')),
  $$VALUES (0.900::NUMERIC, 1.100::NUMERIC, 1::BIGINT)$$, 'EPR happy path: 0.9 kg claimed, 1.1 kg backed');
SELECT is((SELECT pct_of_target FROM v_epr_compliance WHERE producer_id = current_setting('wt.org_p')::INT AND category = 'ITEW2'),
          9.0::NUMERIC, 'compliance: 0.9 kg of a 10 kg target is 9.0%');
SELECT is((SELECT count(*) FROM v_certificate_backing WHERE backed_kg < claimed_kg), 0::BIGINT, 'Q6: no certificate is over-claimed');

SELECT * FROM finish();
ROLLBACK;
