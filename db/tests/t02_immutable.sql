-- C3: lifecycle_event and audit_log are append-only. Everything rolls back at the end.
BEGIN;
SELECT plan(5);
\o /dev/null
\ir ../fixtures/walkthrough.sql
\o
CREATE TEMP TABLE before_counts AS
  SELECT (SELECT count(*) FROM lifecycle_event) AS events, (SELECT count(*) FROM audit_log) AS audits;

SELECT throws_ok($$UPDATE lifecycle_event SET event_type = event_type$$, 'RC003', NULL, 'T-C3: UPDATE on lifecycle_event is refused');
SELECT throws_ok($$DELETE FROM lifecycle_event$$, 'RC003', NULL, 'T-C3: DELETE on lifecycle_event is refused');
SELECT throws_ok($$UPDATE audit_log SET action = action$$, 'RC003', NULL, 'T-C3: UPDATE on audit_log is refused');
SELECT throws_ok($$DELETE FROM audit_log$$, 'RC003', NULL, 'T-C3: DELETE on audit_log is refused');
SELECT is((SELECT (SELECT count(*) FROM lifecycle_event) = b.events AND (SELECT count(*) FROM audit_log) = b.audits FROM before_counts b),
          true, 'the refusals changed no rows');

SELECT * FROM finish();
ROLLBACK;
