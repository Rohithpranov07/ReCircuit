-- migrate:up
CREATE TABLE part_model (
  model_id        SERIAL PRIMARY KEY,
  manufacturer_id INT NOT NULL REFERENCES organization(org_id),
  model_number    VARCHAR(60) NOT NULL,
  category        VARCHAR(20) NOT NULL
                  CHECK (category IN ('DEVICE','BOARD','BATTERY','STORAGE','MEMORY','DISPLAY','CHIP','OTHER')),
  mass_g          NUMERIC(10,2) NOT NULL CHECK (mass_g > 0),
  spec            JSONB,
  UNIQUE (manufacturer_id, model_number)
);
CREATE INDEX part_model_spec_gin ON part_model USING gin (spec jsonb_path_ops);

CREATE TABLE material (
  material_id   SERIAL PRIMARY KEY,
  material_name VARCHAR(40) NOT NULL UNIQUE,
  is_critical   BOOLEAN NOT NULL DEFAULT FALSE,
  is_hazardous  BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE model_material (
  model_id      INT REFERENCES part_model(model_id),
  material_id   INT REFERENCES material(material_id),
  mass_mg       NUMERIC(12,3) NOT NULL CHECK (mass_mg > 0),
  PRIMARY KEY (model_id, material_id)
);

-- SQL-callable copy of the allowed spec keys (TRD section 4); used by sp_register_model (RC012)
CREATE FUNCTION fn_spec_keys(p_category VARCHAR) RETURNS TEXT[]
  LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_category
    WHEN 'DEVICE'  THEN ARRAY['form_factor','release_year','screen_in']
    WHEN 'BATTERY' THEN ARRAY['chemistry','capacity_mAh','nominal_V','cycle_rating']
    WHEN 'STORAGE' THEN ARRAY['interface','capacity_GB']
    WHEN 'MEMORY'  THEN ARRAY['type','capacity_GB','speed_MTs']
    WHEN 'DISPLAY' THEN ARRAY['panel','size_in','resolution']
    WHEN 'BOARD'   THEN ARRAY['board_rev']
    WHEN 'CHIP'    THEN ARRAY['function','package']
    WHEN 'OTHER'   THEN ARRAY[]::TEXT[]
  END
$$;

-- migrate:down
DROP FUNCTION fn_spec_keys(VARCHAR);
DROP TABLE model_material;
DROP TABLE material;
DROP INDEX part_model_spec_gin;
DROP TABLE part_model;
