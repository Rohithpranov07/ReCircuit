"""FR-12.3: the seed generator is deterministic. Two fresh databases seeded with the same profile and seed hold
identical rows and identical event hashes (--jobs 1)."""
from __future__ import annotations

import os
import re
import subprocess
import sys

import psycopg

from tests.conftest import REPO, Pg


def seed_fresh_database(pg: Pg, name: str) -> dict[str, str]:
    with psycopg.connect(pg.url("postgres", "postgres"), autocommit=True) as conn:
        conn.execute(f"CREATE DATABASE {name} OWNER rc_owner")
    env = {**os.environ, "DBMATE_MIGRATIONS_TABLE": "dbmate.schema_migrations", "DBMATE_NO_DUMP_SCHEMA": "true"}
    subprocess.run(["dbmate", "--url", pg.url("rc_owner", name) + "?sslmode=disable", "-d",
                    str(REPO / "db" / "migrations"), "up"], check=True, env=env, capture_output=True)
    run = subprocess.run([sys.executable, "-m", "seed", "--profile", "small", "--seed", "42", "--jobs", "1",
                          "--dsn", pg.url("rc_owner", name)],
                         check=True, cwd=REPO, env={**os.environ, "BCRYPT_ROUNDS": "4"}, capture_output=True, text=True)
    report = dict(re.findall(r"^\s*(\w+)\s+(\S+)$", run.stdout.split("profile=", 1)[1], flags=re.MULTILINE))
    return report


def test_same_seed_gives_identical_counts_and_event_hashes(pg: Pg) -> None:
    first = seed_fresh_database(pg, "seed_one")
    second = seed_fresh_database(pg, "seed_two")
    for key in ("units", "events", "transfers", "certificates", "discrepancies"):
        assert int(first[key]) > 0
    assert first == second
    assert len(first["event_hash_digest"]) == 32
    assert 450 <= int(first["units"]) <= 550
