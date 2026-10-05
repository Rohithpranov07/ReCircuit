-- migrate:up
CREATE TABLE organization (
  org_id        SERIAL PRIMARY KEY,
  org_name      VARCHAR(120) NOT NULL,
  org_type      VARCHAR(20)  NOT NULL
                CHECK (org_type IN ('PRODUCER','COLLECTOR','DISMANTLER','REFURBISHER','RECYCLER')),
  cpcb_reg_no   VARCHAR(30)  UNIQUE,
  gstin         CHAR(15)     UNIQUE
);

CREATE TABLE facility (
  facility_id   SERIAL PRIMARY KEY,
  org_id        INT NOT NULL REFERENCES organization(org_id),
  facility_name VARCHAR(120) NOT NULL,
  pincode       CHAR(6) NOT NULL CHECK (pincode ~ '^[1-9][0-9]{5}$'),
  authorised_capacity_tpa NUMERIC(10,2) CHECK (authorised_capacity_tpa >= 0)
);

CREATE TABLE actor (
  actor_id      SERIAL PRIMARY KEY,
  facility_id   INT NOT NULL REFERENCES facility(facility_id),
  full_name     VARCHAR(100) NOT NULL,
  role          VARCHAR(20)  NOT NULL
                CHECK (role IN ('PRODUCER','COLLECTOR','TECHNICIAN','RECYCLER_OPERATOR','AUDITOR','ADMIN')),
  email         VARCHAR(120) NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,                       -- bcrypt, cost 12
  is_active     BOOLEAN NOT NULL DEFAULT TRUE
);

-- helper used by RLS and procedures
CREATE FUNCTION fn_org_of_facility(f INT) RETURNS INT
  LANGUAGE sql STABLE AS $$ SELECT org_id FROM facility WHERE facility_id = f $$;
CREATE FUNCTION fn_ctx_org()  RETURNS INT  LANGUAGE sql STABLE AS $$ SELECT current_setting('rc.org_id')::INT $$;
CREATE FUNCTION fn_ctx_role() RETURNS TEXT LANGUAGE sql STABLE AS $$ SELECT current_setting('rc.role') $$;

-- migrate:down
DROP FUNCTION fn_ctx_role();
DROP FUNCTION fn_ctx_org();
DROP FUNCTION fn_org_of_facility(INT);
DROP TABLE actor;
DROP TABLE facility;
DROP TABLE organization;
