#!/bin/bash
# Runs once, on first start of an empty data volume (docker-entrypoint-initdb.d), as the
# bootstrap superuser. Creates only the database and the two login roles; extensions, tables,
# routines and every other role are owned by migrations.
set -euo pipefail

: "${RC_OWNER_PASSWORD:?RC_OWNER_PASSWORD is required}"
: "${RC_APP_PASSWORD:?RC_APP_PASSWORD is required}"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres \
     -v owner_pw="$RC_OWNER_PASSWORD" -v app_pw="$RC_APP_PASSWORD" <<'SQL'
CREATE ROLE rc_owner LOGIN PASSWORD :'owner_pw';
CREATE ROLE rc_app   LOGIN NOINHERIT PASSWORD :'app_pw';
CREATE DATABASE recircuit OWNER rc_owner;
SQL
