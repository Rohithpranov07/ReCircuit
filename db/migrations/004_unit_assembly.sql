-- migrate:up
CREATE TABLE unit (
  unit_id         BIGSERIAL PRIMARY KEY,
  model_id        INT  NOT NULL REFERENCES part_model(model_id),
  serial_no       VARCHAR(60) NOT NULL,
  passport_uid    UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  manufactured_on DATE,
  UNIQUE (model_id, serial_no)
);

CREATE TABLE assembly_link (
  child_unit_id   BIGINT REFERENCES unit(unit_id),
  installed_at    TIMESTAMPTZ NOT NULL,
  parent_unit_id  BIGINT NOT NULL REFERENCES unit(unit_id),
  removed_at      TIMESTAMPTZ,                         -- NULL = still installed
  PRIMARY KEY (child_unit_id, installed_at),
  CHECK (child_unit_id <> parent_unit_id),
  CHECK (removed_at IS NULL OR removed_at > installed_at),
  CONSTRAINT assembly_link_excl                         -- C1
    EXCLUDE USING gist (child_unit_id WITH =,
                        tstzrange(installed_at, removed_at) WITH &&)
);
CREATE INDEX assembly_link_parent ON assembly_link (parent_unit_id);

-- C2: no cycles at the moment of installation
CREATE FUNCTION fn_asm_no_cycle() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
    WITH RECURSIVE anc(unit_id, depth) AS (
      SELECT NEW.parent_unit_id, 1
      UNION ALL
      SELECT a.parent_unit_id, anc.depth + 1
      FROM assembly_link a JOIN anc ON a.child_unit_id = anc.unit_id
      WHERE tstzrange(a.installed_at, a.removed_at) @> NEW.installed_at
        AND anc.depth < 10                               -- depth cap (risk R2)
    )
    SELECT 1 FROM anc WHERE unit_id = NEW.child_unit_id
  ) THEN
    RAISE EXCEPTION 'unit % would be inside its own descendant', NEW.child_unit_id
      USING ERRCODE = 'RC002';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_asm_no_cycle BEFORE INSERT ON assembly_link
  FOR EACH ROW EXECUTE FUNCTION fn_asm_no_cycle();

-- migrate:down
DROP TRIGGER trg_asm_no_cycle ON assembly_link;
DROP FUNCTION fn_asm_no_cycle();
DROP INDEX assembly_link_parent;
DROP TABLE assembly_link;
DROP TABLE unit;
