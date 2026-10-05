-- The TRD section 14 scenario ("a day in the life of a battery"), with every date in the past.
-- Run it INSIDE a transaction (psql -1 -f, or after BEGIN): it uses transaction-local settings.
-- Entity ids are published as custom settings so later statements, and tests, can read them:
--   SELECT current_setting('wt.battery')::BIGINT;
-- All organisations, people and e-mail addresses are fictional.
--
-- Timeline (all UTC):
--   2023-03-10  laptop A, battery, SSD and board manufactured; A sold 2023-04-01
--   2026-08-18  producer ships the units to the collector (MF-2026-0310), received 2026-08-20
--   2026-09-01  collector scans A (COLLECTED 09:10) and dismantles it (09:15) -> parts HARVESTED
--   2026-09-02  manifest MF-2026-0311 (both batteries, SSD, laptop B) to the refurbisher; received 2026-09-03
--   2026-09-03  technician diagnoses both batteries: BATTERY_SOH 86 (the second one stays loose: reuse inventory)
--   2026-09-20  laptop B diagnosed and refurbished (11:39, 11:40); battery reinstalled into B (11:42)
--   2026-09-21  manifest MF-2026-0312 (A, board, a lost board) to the recycler; received 2026-09-22, lost board flagged missing
--   2026-09-22  recycler RECYCLED A and the board; certificate RC-REC-2026-000412 (0.9 kg, backed by 1.1 kg)
--   2026-09-23  certificate allocated to the producer; producer target set
--   2026-09-24  an extra board turns up at the recycler with no manifest (a custody gap for Q7)

-- ---------------------------------------------------------------- organisations, facilities, people
SELECT set_config('wt.org_p', sp_admin_create_org('Demo Producer 01','PRODUCER','CPCB-DEMO-P01','27DEMOP0001A1Z1')::text, true);
SELECT set_config('wt.org_c', sp_admin_create_org('Demo Collector 01','COLLECTOR','CPCB-DEMO-C01','27DEMOC0001A1Z2')::text, true);
SELECT set_config('wt.org_r', sp_admin_create_org('Demo Refurbisher 01','REFURBISHER','CPCB-DEMO-R01','27DEMOR0001A1Z3')::text, true);
SELECT set_config('wt.org_y', sp_admin_create_org('Demo Recycler 01','RECYCLER','CPCB-DEMO-Y01','27DEMOY0001A1Z4')::text, true);
SELECT set_config('wt.org_d', sp_admin_create_org('Demo Dismantler 01','DISMANTLER','CPCB-DEMO-D01','27DEMOD0001A1Z5')::text, true);

SELECT set_config('wt.fac_p', sp_admin_create_facility(current_setting('wt.org_p')::INT,'Producer HQ','600001')::text, true);
SELECT set_config('wt.fac_c', sp_admin_create_facility(current_setting('wt.org_c')::INT,'Collection Centre','600002')::text, true);
SELECT set_config('wt.fac_r', sp_admin_create_facility(current_setting('wt.org_r')::INT,'Refurbishment Lab','600003')::text, true);
SELECT set_config('wt.fac_y', sp_admin_create_facility(current_setting('wt.org_y')::INT,'Recycling Plant','600004', 1200)::text, true);
SELECT set_config('wt.fac_d', sp_admin_create_facility(current_setting('wt.org_d')::INT,'Audit Office','600005')::text, true);

SELECT set_config('wt.act_p', sp_admin_create_actor(current_setting('wt.fac_p')::INT,'Meera (demo)','PRODUCER','meera@example.com','not-a-real-hash')::text, true);
SELECT set_config('wt.act_c', sp_admin_create_actor(current_setting('wt.fac_c')::INT,'Arjun (demo)','COLLECTOR','arjun@example.com','not-a-real-hash')::text, true);
SELECT set_config('wt.act_r', sp_admin_create_actor(current_setting('wt.fac_r')::INT,'Kavya (demo)','TECHNICIAN','kavya@example.com','not-a-real-hash')::text, true);
SELECT set_config('wt.act_y', sp_admin_create_actor(current_setting('wt.fac_y')::INT,'Suresh (demo)','RECYCLER_OPERATOR','suresh@example.com','not-a-real-hash')::text, true);
SELECT set_config('wt.act_a', sp_admin_create_actor(current_setting('wt.fac_d')::INT,'Dr Rao (demo)','AUDITOR','rao@example.com','not-a-real-hash')::text, true);
SELECT set_config('wt.act_x', sp_admin_create_actor(current_setting('wt.fac_d')::INT,'Admin (demo)','ADMIN','admin@example.com','not-a-real-hash')::text, true);

-- reference data: materials (catalogue reference data, written directly)
INSERT INTO material (material_name, is_critical, is_hazardous) VALUES
  ('Demo Cobalt', true, false), ('Demo Lithium', true, false), ('Demo Copper', false, false);

-- ================================================================ step 1: producer registers models
SELECT set_config('rc.org_id', current_setting('wt.org_p'), true), set_config('rc.actor_id', current_setting('wt.act_p'), true), set_config('rc.role','PRODUCER',true);
SELECT set_config('wt.m_laptop',  sp_register_model('LTP-14','DEVICE',1500,'{"form_factor":"laptop","release_year":2023}')::text, true);
SELECT set_config('wt.m_battery', sp_register_model('BP-56Wh','BATTERY',250,'{"chemistry":"Li-ion","capacity_mAh":4900}')::text, true);
SELECT set_config('wt.m_ssd',     sp_register_model('SSD-512','STORAGE',20,'{"interface":"NVMe","capacity_GB":512}')::text, true);
SELECT set_config('wt.m_board',   sp_register_model('MB-14','BOARD',180,'{"board_rev":"C"}')::text, true);

SELECT set_config('wt.mat_copper',  (SELECT material_id FROM material WHERE material_name='Demo Copper')::text, true);
SELECT set_config('wt.mat_cobalt',  (SELECT material_id FROM material WHERE material_name='Demo Cobalt')::text, true);
SELECT set_config('wt.mat_lithium', (SELECT material_id FROM material WHERE material_name='Demo Lithium')::text, true);
CALL sp_set_materials(current_setting('wt.m_laptop')::INT,
  format('[{"material_id":%s,"mass_mg":1000000}]', current_setting('wt.mat_copper'))::jsonb);
CALL sp_set_materials(current_setting('wt.m_battery')::INT,
  format('[{"material_id":%s,"mass_mg":42000},{"material_id":%s,"mass_mg":3100}]',
         current_setting('wt.mat_cobalt'), current_setting('wt.mat_lithium'))::jsonb);

-- ================================================================ step 2-3: units, manufacture, sale
SELECT set_config('wt.laptop_a', sp_create_unit(current_setting('wt.m_laptop')::INT,'LAP-50991','2023-03-10')::text, true);
SELECT set_config('wt.laptop_b', sp_create_unit(current_setting('wt.m_laptop')::INT,'LAP-51007','2023-05-01')::text, true);
SELECT set_config('wt.battery',  sp_create_unit(current_setting('wt.m_battery')::INT,'BAT-48213','2023-03-10')::text, true);
SELECT set_config('wt.battery2', sp_create_unit(current_setting('wt.m_battery')::INT,'BAT-48214','2023-03-10')::text, true);
SELECT set_config('wt.ssd',      sp_create_unit(current_setting('wt.m_ssd')::INT,'SSD-7001','2023-03-10')::text, true);
SELECT set_config('wt.board',    sp_create_unit(current_setting('wt.m_board')::INT,'MB-7002','2023-03-10')::text, true);

CALL sp_record_event(current_setting('wt.laptop_a')::BIGINT,'MANUFACTURED','2023-03-10T10:00:00Z', current_setting('wt.fac_p')::INT);
CALL sp_record_event(current_setting('wt.battery')::BIGINT, 'MANUFACTURED','2023-03-10T10:00:00Z', current_setting('wt.fac_p')::INT);
CALL sp_record_event(current_setting('wt.battery2')::BIGINT,'MANUFACTURED','2023-03-10T10:00:00Z', current_setting('wt.fac_p')::INT);
CALL sp_record_event(current_setting('wt.ssd')::BIGINT,     'MANUFACTURED','2023-03-10T10:00:00Z', current_setting('wt.fac_p')::INT);
CALL sp_record_event(current_setting('wt.board')::BIGINT,   'MANUFACTURED','2023-03-10T10:00:00Z', current_setting('wt.fac_p')::INT);
CALL sp_record_event(current_setting('wt.laptop_b')::BIGINT,'MANUFACTURED','2023-05-01T10:00:00Z', current_setting('wt.fac_p')::INT);
CALL sp_record_event(current_setting('wt.laptop_a')::BIGINT,'SOLD','2023-04-01T10:00:00Z', current_setting('wt.fac_p')::INT);
CALL sp_record_event(current_setting('wt.laptop_b')::BIGINT,'SOLD','2023-06-01T10:00:00Z', current_setting('wt.fac_p')::INT);

-- ================================================================ producer hands the units to the collector (manifest MF-2026-0310)
SELECT set_config('wt.mf0', sp_create_transfer('MF-2026-0310', current_setting('wt.org_c')::INT, '2026-08-18T08:00:00Z', 4.000,
  format('[{"unit_id":%s,"declared_condition":"WORKING"},{"unit_id":%s,"declared_condition":"WORKING"},{"unit_id":%s,"declared_condition":"WORKING"},{"unit_id":%s,"declared_condition":"WORKING"},{"unit_id":%s,"declared_condition":"WORKING"},{"unit_id":%s,"declared_condition":"WORKING"}]',
         current_setting('wt.laptop_a'), current_setting('wt.laptop_b'), current_setting('wt.battery'),
         current_setting('wt.battery2'), current_setting('wt.ssd'), current_setting('wt.board'))::jsonb)::text, true);

-- ================================================================ steps 4-5: collector collects and dismantles A
SELECT set_config('rc.org_id', current_setting('wt.org_c'), true), set_config('rc.actor_id', current_setting('wt.act_c'), true), set_config('rc.role','COLLECTOR',true);
CALL sp_receive_transfer(current_setting('wt.mf0')::BIGINT, '2026-08-20T08:00:00Z');
CALL sp_record_event(current_setting('wt.laptop_a')::BIGINT,'COLLECTED','2026-09-01T09:10:00Z', current_setting('wt.fac_c')::INT);
CALL sp_record_event(current_setting('wt.laptop_b')::BIGINT,'COLLECTED','2026-08-25T09:00:00Z', current_setting('wt.fac_c')::INT);
CALL sp_dismantle(current_setting('wt.laptop_a')::BIGINT,
  format('[{"model_id":%s,"serial_no":"BAT-48213"},{"model_id":%s,"serial_no":"BAT-48214"},{"model_id":%s,"serial_no":"SSD-7001"},{"model_id":%s,"serial_no":"MB-7002"}]',
         current_setting('wt.m_battery'), current_setting('wt.m_battery'), current_setting('wt.m_ssd'), current_setting('wt.m_board'))::jsonb,
  '2026-09-01T09:15:00Z', current_setting('wt.fac_c')::INT);

-- ================================================================ steps 6-7: manifest to the refurbisher
SELECT set_config('wt.mf1', sp_create_transfer('MF-2026-0311', current_setting('wt.org_r')::INT, '2026-09-02T08:00:00Z', 1.790,
  format('[{"unit_id":%s,"declared_condition":"WORKING"},{"unit_id":%s,"declared_condition":"WORKING"},{"unit_id":%s,"declared_condition":"WORKING"},{"unit_id":%s,"declared_condition":"WORKING"}]',
         current_setting('wt.battery'), current_setting('wt.battery2'), current_setting('wt.ssd'), current_setting('wt.laptop_b'))::jsonb)::text, true);
SELECT set_config('rc.org_id', current_setting('wt.org_r'), true), set_config('rc.actor_id', current_setting('wt.act_r'), true), set_config('rc.role','TECHNICIAN',true);
CALL sp_receive_transfer(current_setting('wt.mf1')::BIGINT, '2026-09-03T08:30:00Z');

-- ================================================================ steps 8-11: diagnose, refurbish B, reinstall
CALL sp_record_tests(current_setting('wt.battery')::BIGINT, '2026-09-03T10:00:00Z', current_setting('wt.fac_r')::INT,
  '[{"test_type":"BATTERY_SOH","result":"PASS","measured_value":86,"health_score":86}]'::jsonb);
-- a second battery stays loose after its diagnosis: it is the reuse-inventory entry (TRD step 9)
CALL sp_record_tests(current_setting('wt.battery2')::BIGINT, '2026-09-03T10:30:00Z', current_setting('wt.fac_r')::INT,
  '[{"test_type":"BATTERY_SOH","result":"PASS","measured_value":86,"health_score":86}]'::jsonb);
CALL sp_record_event(current_setting('wt.laptop_b')::BIGINT,'DIAGNOSED','2026-09-20T11:39:00Z', current_setting('wt.fac_r')::INT);
CALL sp_record_event(current_setting('wt.laptop_b')::BIGINT,'REFURBISHED','2026-09-20T11:40:00Z', current_setting('wt.fac_r')::INT);
CALL sp_reinstall(current_setting('wt.battery')::BIGINT, current_setting('wt.laptop_b')::BIGINT, '2026-09-20T11:42:00Z', current_setting('wt.fac_r')::INT);

-- ================================================================ step 13: manifest to the recycler, one unit missing
SELECT set_config('rc.org_id', current_setting('wt.org_c'), true), set_config('rc.actor_id', current_setting('wt.act_c'), true), set_config('rc.role','COLLECTOR',true);
-- a third item, a loose board, is declared on the manifest but never arrives
SELECT set_config('wt.board_lost', sp_create_unit(current_setting('wt.m_board')::INT,'MB-7003','2023-03-10')::text, true);
CALL sp_record_event(current_setting('wt.board_lost')::BIGINT,'COLLECTED','2026-09-20T09:00:00Z', current_setting('wt.fac_c')::INT);
SELECT set_config('wt.mf2', sp_create_transfer('MF-2026-0312', current_setting('wt.org_y')::INT, '2026-09-21T08:00:00Z', 1.930,
  format('[{"unit_id":%s,"declared_condition":"SCRAP"},{"unit_id":%s,"declared_condition":"SCRAP"},{"unit_id":%s,"declared_condition":"SCRAP"}]',
         current_setting('wt.laptop_a'), current_setting('wt.board'), current_setting('wt.board_lost'))::jsonb)::text, true);
SELECT set_config('rc.org_id', current_setting('wt.org_y'), true), set_config('rc.actor_id', current_setting('wt.act_y'), true), set_config('rc.role','RECYCLER_OPERATOR',true);
CALL sp_receive_transfer(current_setting('wt.mf2')::BIGINT, '2026-09-22T08:00:00Z',
                         ARRAY[current_setting('wt.board_lost')::BIGINT]);

-- ================================================================ steps 14-17: recycle, certify, allocate
CALL sp_record_event(current_setting('wt.laptop_a')::BIGINT,'RECYCLED','2026-09-22T10:00:00Z', current_setting('wt.fac_y')::INT);
CALL sp_record_event(current_setting('wt.board')::BIGINT,   'RECYCLED','2026-09-22T10:05:00Z', current_setting('wt.fac_y')::INT);
SELECT set_config('wt.cert', sp_issue_certificate('RC-REC-2026-000412','ITEW2',0.900,'2026-27','2026-09-22',
  format('[{"unit_id":%s,"recovered_mass_g":1100}]', current_setting('wt.laptop_a'))::jsonb)::text, true);
CALL sp_allocate_certificate(current_setting('wt.cert')::BIGINT, current_setting('wt.org_p')::INT);

SELECT set_config('rc.org_id', current_setting('wt.org_p'), true), set_config('rc.actor_id', current_setting('wt.act_p'), true), set_config('rc.role','PRODUCER',true);
CALL sp_set_target('ITEW2','2026-27',10);

-- ================================================================ a custody gap (for Q7): no manifest, yet events at the recycler
SELECT set_config('rc.org_id', current_setting('wt.org_c'), true), set_config('rc.actor_id', current_setting('wt.act_c'), true), set_config('rc.role','COLLECTOR',true);
SELECT set_config('wt.board_gap', sp_create_unit(current_setting('wt.m_board')::INT,'MB-7099','2023-03-10')::text, true);
CALL sp_record_event(current_setting('wt.board_gap')::BIGINT,'COLLECTED','2026-09-23T09:00:00Z', current_setting('wt.fac_c')::INT);
SELECT set_config('rc.org_id', current_setting('wt.org_y'), true), set_config('rc.actor_id', current_setting('wt.act_y'), true), set_config('rc.role','RECYCLER_OPERATOR',true);
CALL sp_record_event(current_setting('wt.board_gap')::BIGINT,'RECYCLED','2026-09-24T09:00:00Z', current_setting('wt.fac_y')::INT);
