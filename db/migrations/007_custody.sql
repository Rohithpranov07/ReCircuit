-- migrate:up
CREATE TABLE custody_transfer (
  transfer_id   BIGSERIAL PRIMARY KEY,
  manifest_no   VARCHAR(30) NOT NULL UNIQUE,
  from_org_id   INT NOT NULL REFERENCES organization(org_id),
  to_org_id     INT NOT NULL REFERENCES organization(org_id),
  shipped_at    TIMESTAMPTZ NOT NULL,
  received_at   TIMESTAMPTZ,
  total_mass_kg NUMERIC(10,3) CHECK (total_mass_kg > 0),
  CHECK (from_org_id <> to_org_id),
  CHECK (received_at IS NULL OR received_at >= shipped_at)
);

CREATE TABLE transfer_item (
  transfer_id        BIGINT REFERENCES custody_transfer(transfer_id),
  unit_id            BIGINT REFERENCES unit(unit_id),
  declared_condition VARCHAR(10) CHECK (declared_condition IN ('WORKING','FAULTY','SCRAP')),
  PRIMARY KEY (transfer_id, unit_id)
);
CREATE INDEX transfer_item_unit ON transfer_item (unit_id);

CREATE TABLE transfer_discrepancy (
  transfer_id  BIGINT REFERENCES custody_transfer(transfer_id),
  unit_id      BIGINT REFERENCES unit(unit_id),
  kind         VARCHAR(8) NOT NULL CHECK (kind IN ('MISSING','EXTRA')),
  noted_by     INT NOT NULL REFERENCES actor(actor_id),
  noted_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (transfer_id, unit_id)
);

-- C8
CREATE FUNCTION fn_transfer_one_open() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM transfer_item ti JOIN custody_transfer ct USING (transfer_id)
             WHERE ti.unit_id = NEW.unit_id AND ct.received_at IS NULL
               AND ct.transfer_id <> NEW.transfer_id) THEN
    RAISE EXCEPTION 'unit % is already on an open manifest', NEW.unit_id USING ERRCODE = 'RC008';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_transfer_one_open BEFORE INSERT ON transfer_item
  FOR EACH ROW EXECUTE FUNCTION fn_transfer_one_open();

CREATE PROCEDURE sp_receive_transfer(p_transfer BIGINT, p_at TIMESTAMPTZ,
                                     p_missing BIGINT[] DEFAULT '{}', p_extra BIGINT[] DEFAULT '{}')
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE custody_transfer SET received_at = p_at
   WHERE transfer_id = p_transfer AND to_org_id = fn_ctx_org() AND received_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'manifest % is not open for your organisation', p_transfer USING ERRCODE = 'RC014';
  END IF;
  INSERT INTO transfer_discrepancy (transfer_id, unit_id, kind, noted_by)
  SELECT p_transfer, u, 'MISSING', current_setting('rc.actor_id')::INT FROM unnest(p_missing) u
  UNION ALL
  SELECT p_transfer, u, 'EXTRA',   current_setting('rc.actor_id')::INT FROM unnest(p_extra) u;
END $$;

-- migrate:down
DROP PROCEDURE sp_receive_transfer(BIGINT, TIMESTAMPTZ, BIGINT[], BIGINT[]);
DROP TRIGGER trg_transfer_one_open ON transfer_item;
DROP FUNCTION fn_transfer_one_open();
DROP TABLE transfer_discrepancy;
DROP INDEX transfer_item_unit;
DROP TABLE transfer_item;
DROP TABLE custody_transfer;
