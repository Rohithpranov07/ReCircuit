-- migrate:up
CREATE TABLE diagnostic_test (
  test_id        BIGSERIAL PRIMARY KEY,
  event_id       BIGINT NOT NULL REFERENCES lifecycle_event(event_id),
  test_type      VARCHAR(40) NOT NULL,      -- e.g. 'BATTERY_SOH', 'SMART_HEALTH', 'MEMTEST', 'DISPLAY_DEAD_PIXELS'
  result         VARCHAR(10) NOT NULL CHECK (result IN ('PASS','DEGRADED','FAIL')),
  measured_value NUMERIC(12,3),
  health_score   SMALLINT CHECK (health_score BETWEEN 0 AND 100)
);
CREATE INDEX diagnostic_test_event ON diagnostic_test (event_id);

-- C7
CREATE FUNCTION fn_test_event_type() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (SELECT event_type FROM lifecycle_event WHERE event_id = NEW.event_id) <> 'DIAGNOSED' THEN
    RAISE EXCEPTION 'tests can only attach to DIAGNOSED events' USING ERRCODE = 'RC007';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_test_event_type BEFORE INSERT ON diagnostic_test
  FOR EACH ROW EXECUTE FUNCTION fn_test_event_type();

-- migrate:down
DROP TRIGGER trg_test_event_type ON diagnostic_test;
DROP FUNCTION fn_test_event_type();
DROP INDEX diagnostic_test_event;
DROP TABLE diagnostic_test;
