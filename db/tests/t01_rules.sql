-- C1 (one parent at a time) and C2 (no assembly cycles). Everything rolls back at the end.
BEGIN;
SELECT plan(6);
\o /dev/null
\ir ../fixtures/walkthrough.sql
\o
SELECT set_config('rc.org_id', current_setting('wt.org_r'), true), set_config('rc.actor_id', current_setting('wt.act_r'), true), set_config('rc.role','TECHNICIAN',true);

-- T-C1: the battery is inside laptop B; installing it again overlaps the open period
SELECT throws_ok(
  format($f$CALL sp_reinstall(%s, %s, '2026-09-20T11:43:00Z', %s)$f$,
         current_setting('wt.battery'), current_setting('wt.laptop_b'), current_setting('wt.fac_r')),
  '23P01', 'conflicting key value violates exclusion constraint "assembly_link_excl"',
  'T-C1: duplicate reinstall is refused by assembly_link_excl');
SELECT is((SELECT count(*) FROM assembly_link
            WHERE child_unit_id = current_setting('wt.battery')::BIGINT AND installed_at = '2026-09-20T11:43:00Z'),
          0::BIGINT, 'T-C1: the refused reinstall wrote no assembly period');
SELECT lives_ok(
  format($f$INSERT INTO assembly_link (child_unit_id, installed_at, parent_unit_id)
            VALUES (%s, '2026-09-01T09:15:00Z', %s)$f$, current_setting('wt.ssd'), current_setting('wt.laptop_b')),
  'periods are half-open: a unit can be installed at the very instant its previous period ended');

-- T-C2: laptop B inside its own battery
SELECT throws_ok(
  format($f$INSERT INTO assembly_link (child_unit_id, installed_at, parent_unit_id)
            VALUES (%s, '2026-09-25T09:00:00Z', %s)$f$, current_setting('wt.laptop_b'), current_setting('wt.battery')),
  'RC002', NULL, 'T-C2: a laptop cannot be installed inside its own battery');
SELECT throws_ok(
  format($f$INSERT INTO assembly_link (child_unit_id, installed_at, parent_unit_id) VALUES (%s, '2026-09-25T09:00:00Z', %s)$f$,
         current_setting('wt.laptop_b'), current_setting('wt.laptop_b')),
  'RC002', NULL, 'C2: a unit cannot be its own parent (the cycle trigger fires before the CHECK)');
SELECT throws_ok(
  format($f$INSERT INTO assembly_link (child_unit_id, installed_at, parent_unit_id, removed_at)
            VALUES (%s, '2026-09-26T09:00:00Z', %s, '2026-09-26T09:00:00Z')$f$,
         current_setting('wt.board_lost'), current_setting('wt.laptop_b')),
  '23514', NULL, 'an assembly period must end after it starts (CHECK)');

SELECT * FROM finish();
ROLLBACK;
