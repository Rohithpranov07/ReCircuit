-- migrate:up
CREATE TABLE lifecycle_event (
  event_id          BIGSERIAL PRIMARY KEY,
  unit_id           BIGINT NOT NULL REFERENCES unit(unit_id),
  facility_id       INT    NOT NULL REFERENCES facility(facility_id),
  actor_id          INT    NOT NULL REFERENCES actor(actor_id),
  event_type        VARCHAR(20) NOT NULL
                    CHECK (event_type IN ('MANUFACTURED','SOLD','COLLECTED','DIAGNOSED','HARVESTED',
                                          'REFURBISHED','REINSTALLED','RECYCLED','DISPOSED')),
  occurred_at       TIMESTAMPTZ NOT NULL,                 -- valid time
  recorded_at       TIMESTAMPTZ NOT NULL DEFAULT now(),   -- transaction time (forced by C4)
  prev_hash         BYTEA,                                -- NULL only for a unit's first event
  event_hash        BYTEA NOT NULL UNIQUE,                -- set by C4
  corrects_event_id BIGINT REFERENCES lifecycle_event(event_id),
  CHECK (occurred_at <= recorded_at)
);
CREATE INDEX lifecycle_event_unit_time ON lifecycle_event (unit_id, event_id DESC);

-- C5 rule data (reference table; all-key relation)
CREATE TABLE event_transition (
  from_type VARCHAR(20) NOT NULL,     -- 'NONE' = unit has no events yet
  to_type   VARCHAR(20) NOT NULL,
  PRIMARY KEY (from_type, to_type)
);
INSERT INTO event_transition VALUES
 ('NONE','MANUFACTURED'),('NONE','COLLECTED'),
 ('MANUFACTURED','SOLD'),('MANUFACTURED','COLLECTED'),
 ('SOLD','COLLECTED'),
 ('COLLECTED','DIAGNOSED'),('COLLECTED','HARVESTED'),('COLLECTED','RECYCLED'),('COLLECTED','DISPOSED'),
 ('DIAGNOSED','DIAGNOSED'),('DIAGNOSED','REFURBISHED'),('DIAGNOSED','HARVESTED'),
 ('DIAGNOSED','RECYCLED'),('DIAGNOSED','DISPOSED'),
 ('HARVESTED','DIAGNOSED'),('HARVESTED','REINSTALLED'),('HARVESTED','RECYCLED'),('HARVESTED','DISPOSED'),
 ('REFURBISHED','SOLD'),('REFURBISHED','DIAGNOSED'),
 ('REINSTALLED','SOLD'),('REINSTALLED','COLLECTED'),('REINSTALLED','DIAGNOSED');
-- RECYCLED and DISPOSED have no outgoing rows: terminal.
INSERT INTO event_transition VALUES ('DIAGNOSED','REINSTALLED');

CREATE TABLE audit_log (
  log_id     BIGSERIAL PRIMARY KEY,
  actor_id   INT NOT NULL REFERENCES actor(actor_id),
  action     VARCHAR(40) NOT NULL,     -- 'CERT_ISSUE','CERT_ALLOCATE','ROLE_CHANGE','ACTOR_DEACTIVATE',...
  entity     VARCHAR(40) NOT NULL,
  entity_id  TEXT NOT NULL,
  details    JSONB,
  logged_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- append-only via trg_audit_immutable (below)

-- C5: legal transitions + monotonic occurred_at
CREATE FUNCTION fn_event_transition() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE last_type VARCHAR(20); last_at TIMESTAMPTZ;
BEGIN
  SELECT event_type, occurred_at INTO last_type, last_at
  FROM lifecycle_event WHERE unit_id = NEW.unit_id ORDER BY event_id DESC LIMIT 1;
  IF NOT EXISTS (SELECT 1 FROM event_transition
                 WHERE from_type = COALESCE(last_type,'NONE') AND to_type = NEW.event_type) THEN
    RAISE EXCEPTION 'illegal transition % -> % for unit %', COALESCE(last_type,'NONE'), NEW.event_type, NEW.unit_id
      USING ERRCODE = 'RC005';
  END IF;
  IF last_at IS NOT NULL AND NEW.occurred_at < last_at THEN
    RAISE EXCEPTION 'event for unit % occurs before its previous event', NEW.unit_id USING ERRCODE = 'RC011';
  END IF;
  RETURN NEW;
END $$;

-- C4: hash chain (runs after C5; see ordering note below)
CREATE FUNCTION fn_event_chain() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE last_hash BYTEA;
BEGIN
  PERFORM 1 FROM unit WHERE unit_id = NEW.unit_id FOR UPDATE;          -- serialise per unit
  SELECT event_hash INTO last_hash FROM lifecycle_event
   WHERE unit_id = NEW.unit_id ORDER BY event_id DESC LIMIT 1;
  NEW.prev_hash   := last_hash;
  NEW.recorded_at := now();
  NEW.event_hash  := fn_event_digest(last_hash, NEW.unit_id, NEW.event_type,
                                     NEW.occurred_at, NEW.facility_id, NEW.actor_id);
  RETURN NEW;
END $$;

CREATE FUNCTION fn_event_digest(p_prev BYTEA, p_unit BIGINT, p_type VARCHAR, p_at TIMESTAMPTZ,
                                p_fac INT, p_actor INT) RETURNS BYTEA
LANGUAGE sql IMMUTABLE AS $$
  SELECT digest(
    COALESCE(encode(p_prev,'hex'),'GENESIS') || '|' || p_unit || '|' || p_type || '|' ||
    to_char(p_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') || '|' || p_fac || '|' || p_actor,
    'sha256');
$$;

-- Trigger names are prefixed so PostgreSQL's alphabetical firing order is explicit:
CREATE TRIGGER trg_event_10_transition BEFORE INSERT ON lifecycle_event
  FOR EACH ROW EXECUTE FUNCTION fn_event_transition();      -- C5
CREATE TRIGGER trg_event_20_chain      BEFORE INSERT ON lifecycle_event
  FOR EACH ROW EXECUTE FUNCTION fn_event_chain();           -- C4

-- C6: harvesting closes the open assembly period
CREATE FUNCTION fn_event_harvest() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.event_type = 'HARVESTED' THEN
    UPDATE assembly_link SET removed_at = NEW.occurred_at
     WHERE child_unit_id = NEW.unit_id AND removed_at IS NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'unit % is not installed in anything', NEW.unit_id USING ERRCODE = 'RC006';
    END IF;
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER trg_event_harvest AFTER INSERT ON lifecycle_event
  FOR EACH ROW EXECUTE FUNCTION fn_event_harvest();

-- C3: append-only
CREATE FUNCTION fn_event_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = 'RC003';
END $$;
CREATE TRIGGER trg_event_immutable BEFORE UPDATE OR DELETE ON lifecycle_event
  FOR EACH ROW EXECUTE FUNCTION fn_event_immutable();
CREATE TRIGGER trg_audit_immutable BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION fn_event_immutable();

-- the one entry point for events
CREATE PROCEDURE sp_record_event(p_unit BIGINT, p_type VARCHAR, p_at TIMESTAMPTZ, p_facility INT,
                                 p_corrects BIGINT DEFAULT NULL)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF fn_org_of_facility(p_facility) <> fn_ctx_org() THEN
    RAISE EXCEPTION 'facility % is not in your organisation', p_facility USING ERRCODE = 'RC013';
  END IF;
  INSERT INTO lifecycle_event (unit_id, facility_id, actor_id, event_type, occurred_at,
                               event_hash, corrects_event_id)
  VALUES (p_unit, p_facility, current_setting('rc.actor_id')::INT, p_type, p_at,
          '\x00', p_corrects);                       -- placeholder; C4 overwrites
END $$;

CREATE PROCEDURE sp_harvest(p_unit BIGINT, p_at TIMESTAMPTZ, p_facility INT)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$ CALL sp_record_event(p_unit, 'HARVESTED', p_at, p_facility) $$;

-- Q8: returns NULL if the chain is intact, else the first event_id whose stored hash is wrong
CREATE FUNCTION sp_verify_chain(p_unit BIGINT) RETURNS BIGINT
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE r RECORD; expected_prev BYTEA := NULL;
BEGIN
  FOR r IN SELECT * FROM lifecycle_event WHERE unit_id = p_unit ORDER BY event_id LOOP
    IF r.prev_hash IS DISTINCT FROM expected_prev
       OR r.event_hash <> fn_event_digest(r.prev_hash, r.unit_id, r.event_type,
                                          r.occurred_at, r.facility_id, r.actor_id) THEN
      RETURN r.event_id;
    END IF;
    expected_prev := r.event_hash;
  END LOOP;
  RETURN NULL;
END $$;

-- migrate:down
DROP FUNCTION sp_verify_chain(BIGINT);
DROP PROCEDURE sp_harvest(BIGINT, TIMESTAMPTZ, INT);
DROP PROCEDURE sp_record_event(BIGINT, VARCHAR, TIMESTAMPTZ, INT, BIGINT);
DROP TRIGGER trg_audit_immutable ON audit_log;
DROP TRIGGER trg_event_immutable ON lifecycle_event;
DROP FUNCTION fn_event_immutable();
DROP TRIGGER trg_event_harvest ON lifecycle_event;
DROP FUNCTION fn_event_harvest();
DROP TRIGGER trg_event_20_chain ON lifecycle_event;
DROP TRIGGER trg_event_10_transition ON lifecycle_event;
DROP FUNCTION fn_event_digest(BYTEA, BIGINT, VARCHAR, TIMESTAMPTZ, INT, INT);
DROP FUNCTION fn_event_chain();
DROP FUNCTION fn_event_transition();
DROP TABLE audit_log;
DROP TABLE event_transition;
DROP INDEX lifecycle_event_unit_time;
DROP TABLE lifecycle_event;
