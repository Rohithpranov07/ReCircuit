-- migrate:up
CREATE TABLE epr_certificate (
  cert_id        BIGSERIAL PRIMARY KEY,
  cert_no        VARCHAR(40) NOT NULL UNIQUE,
  recycler_id    INT NOT NULL REFERENCES organization(org_id),
  producer_id    INT REFERENCES organization(org_id),   -- NULL until allocated
  category       VARCHAR(20) NOT NULL,
  quantity_kg    NUMERIC(10,3) NOT NULL CHECK (quantity_kg > 0),
  financial_year CHAR(7) NOT NULL CHECK (financial_year ~ '^[0-9]{4}-[0-9]{2}$'),
  issued_on      DATE NOT NULL
);

CREATE TABLE certificate_unit (
  unit_id          BIGINT PRIMARY KEY REFERENCES unit(unit_id),   -- C10a
  cert_id          BIGINT NOT NULL REFERENCES epr_certificate(cert_id),
  recovered_mass_g NUMERIC(10,2) NOT NULL CHECK (recovered_mass_g > 0)
);
CREATE INDEX certificate_unit_cert ON certificate_unit (cert_id);

CREATE TABLE epr_target (
  producer_id    INT REFERENCES organization(org_id),
  category       VARCHAR(20),
  financial_year CHAR(7) CHECK (financial_year ~ '^[0-9]{4}-[0-9]{2}$'),
  target_kg      NUMERIC(12,3) NOT NULL CHECK (target_kg > 0),
  PRIMARY KEY (producer_id, category, financial_year)
);

-- C9
CREATE FUNCTION fn_cert_unit_recycled() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM lifecycle_event e
    JOIN epr_certificate c ON c.cert_id = NEW.cert_id
    WHERE e.unit_id = NEW.unit_id AND e.event_type = 'RECYCLED'
      AND fn_org_of_facility(e.facility_id) = c.recycler_id) THEN
    RAISE EXCEPTION 'unit % was not recycled by the issuing recycler', NEW.unit_id USING ERRCODE = 'RC009';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_cert_unit_recycled BEFORE INSERT ON certificate_unit
  FOR EACH ROW EXECUTE FUNCTION fn_cert_unit_recycled();

-- C10b: checked at COMMIT
CREATE FUNCTION fn_cert_quantity() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE cid BIGINT := COALESCE(NEW.cert_id, OLD.cert_id); claimed NUMERIC; backed NUMERIC;
BEGIN
  SELECT quantity_kg INTO claimed FROM epr_certificate WHERE cert_id = cid;
  SELECT COALESCE(SUM(recovered_mass_g),0) / 1000 INTO backed FROM certificate_unit WHERE cert_id = cid;
  IF claimed IS NOT NULL AND backed < claimed THEN
    RAISE EXCEPTION 'certificate % claims % kg but is backed by % kg', cid, claimed, backed
      USING ERRCODE = 'RC010';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER trg_cert_quantity
  AFTER INSERT OR UPDATE OR DELETE ON certificate_unit
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION fn_cert_quantity();
CREATE CONSTRAINT TRIGGER trg_cert_quantity_head
  AFTER INSERT OR UPDATE ON epr_certificate
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION fn_cert_quantity();

-- migrate:down
DROP TRIGGER trg_cert_quantity_head ON epr_certificate;
DROP TRIGGER trg_cert_quantity ON certificate_unit;
DROP FUNCTION fn_cert_quantity();
DROP TRIGGER trg_cert_unit_recycled ON certificate_unit;
DROP FUNCTION fn_cert_unit_recycled();
DROP TABLE epr_target;
DROP INDEX certificate_unit_cert;
DROP TABLE certificate_unit;
DROP TABLE epr_certificate;
