-- migrate:up
CREATE EXTENSION IF NOT EXISTS pgcrypto;    -- digest(), gen_random_uuid(), crypt()
CREATE EXTENSION IF NOT EXISTS btree_gist;  -- '=' on BIGINT inside a GiST exclusion constraint

-- migrate:down
DROP EXTENSION IF EXISTS btree_gist;
DROP EXTENSION IF EXISTS pgcrypto;
