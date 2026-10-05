"""python -m seed --profile small|large --seed N [--jobs K] [--dsn URL]

Builds a deterministic synthetic world through the database routines only. Row counts and event content are
identical for a given (profile, seed); entity ids, and therefore event hashes, are identical too when --jobs is 1
(with more jobs, scenarios commit in a nondeterministic order, so ids may differ between runs)."""
from __future__ import annotations

import argparse
import multiprocessing
import os
import random
import re
import sys
import time
from collections.abc import Iterable
from datetime import date, timedelta
from pathlib import Path
from typing import Any

import bcrypt
import psycopg
from psycopg.types.json import Jsonb

from seed.db import call, set_context
from seed.profiles import PROFILES, Profile
from seed.runner import init_worker, run_chunk
from seed.scenario import CERT_CATEGORIES
from seed.world import DEMO_PASSWORD, World, build_world


def load_env() -> dict[str, str]:
    """Read ./.env (KEY=VALUE, trailing '# comments' allowed) without overriding the real environment."""
    values: dict[str, str] = {}
    path = Path(".env")
    if path.exists():
        for line in path.read_text().splitlines():
            m = re.match(r"^\s*([A-Z0-9_]+)=(.*?)\s*(?:\s#.*)?$", line)
            if m:
                values[m.group(1)] = m.group(2)
    return {**values, **os.environ}


def default_dsn(env: dict[str, str]) -> str:
    if env.get("SEED_DATABASE_URL"):
        return env["SEED_DATABASE_URL"]
    owner_pw = env.get("RC_OWNER_PASSWORD", "change-me-owner")
    port = env.get("DB_HOST_PORT", "5432")
    return f"postgresql://rc_owner:{owner_pw}@localhost:{port}/recircuit"


def financial_year(d: date) -> str:
    start = d.year if d.month >= 4 else d.year - 1
    return f"{start}-{(start + 1) % 100:02d}"


def issue_certificates(conn: Any, world: World, profile: Profile, seed: int) -> dict[str, int]:
    """Recyclers certify about three quarters of what they recycled; recyclers allocate most certificates to
    producers; producers set targets. Every row goes through the routines."""
    rng = random.Random(f"{seed}:certificates")
    issued = allocated = 0
    seen: set[tuple[str, str]] = set()
    lo, hi = profile.cert_batch
    with conn.transaction(), conn.cursor() as cur:
        for rec in world.recyclers:
            cur.execute(
                """SELECT e.unit_id, m.mass_g, e.occurred_at
                     FROM lifecycle_event e
                     JOIN unit u ON u.unit_id = e.unit_id
                     JOIN part_model m ON m.model_id = u.model_id
                    WHERE e.event_type = 'RECYCLED' AND fn_org_of_facility(e.facility_id) = %s
                      AND NOT EXISTS (SELECT 1 FROM certificate_unit cu WHERE cu.unit_id = e.unit_id)
                    ORDER BY e.event_id""", (rec.org_id,))
            rows = cur.fetchall()
            rows = rows[: int(len(rows) * 0.75)]
            pos = 0
            while pos < len(rows):
                batch = rows[pos: pos + rng.randint(lo, hi)]
                pos += len(batch)
                units = [{"unit_id": uid, "recovered_mass_g": round(float(mass) * rng.uniform(0.7, 1.0), 2)}
                         for uid, mass, _ in batch]
                backed_kg = sum(u["recovered_mass_g"] for u in units) / 1000
                issued_on = (max(r[2] for r in batch) + timedelta(days=rng.randint(5, 30))).date()
                fy = financial_year(issued_on)
                category = rng.choice(CERT_CATEGORIES)
                issued += 1
                set_context(cur, rec.org_id, rec.actor_id, rec.role)
                cert = call(cur, "sp_issue_certificate", f"RC-REC-{issued_on.year}-{issued:06d}", category,
                            round(backed_kg * 0.95, 3), fy, issued_on, Jsonb(units))
                if rng.random() < 0.85:
                    producer = rng.choice(world.producers)
                    call(cur, "sp_allocate_certificate", cert, producer.org_id)
                    allocated += 1
                seen.add((category, fy))
        for producer in world.producers:
            set_context(cur, producer.org_id, producer.actor_id, producer.role)
            for category, fy in sorted(seen):
                call(cur, "sp_set_target", category, fy, rng.randint(5, 200))
    return {"certificates": issued, "allocated": allocated}


def summary(conn: Any) -> dict[str, Any]:
    queries = {
        "organizations": "SELECT count(*) FROM organization", "facilities": "SELECT count(*) FROM facility",
        "actors": "SELECT count(*) FROM actor", "part_models": "SELECT count(*) FROM part_model",
        "units": "SELECT count(*) FROM unit", "assembly_links": "SELECT count(*) FROM assembly_link",
        "events": "SELECT count(*) FROM lifecycle_event", "diagnostic_tests": "SELECT count(*) FROM diagnostic_test",
        "transfers": "SELECT count(*) FROM custody_transfer", "transfer_items": "SELECT count(*) FROM transfer_item",
        "discrepancies": "SELECT count(*) FROM transfer_discrepancy",
        "certificates": "SELECT count(*) FROM epr_certificate", "certificate_units": "SELECT count(*) FROM certificate_unit",
        "audit_rows": "SELECT count(*) FROM audit_log",
        "event_hash_digest": "SELECT md5(string_agg(event_hash::text, '' ORDER BY event_id)) FROM lifecycle_event",
    }
    with conn.cursor() as cur:
        out = {}
        for k, q in queries.items():
            cur.execute(q)
            row = cur.fetchone()
            assert row is not None
            out[k] = row[0]
    return out


def main(argv: list[str] | None = None) -> int:
    env = load_env()
    ap = argparse.ArgumentParser(prog="python -m seed", description="Deterministic synthetic ReCircuit data.")
    ap.add_argument("--profile", choices=sorted(PROFILES), required=True)
    ap.add_argument("--seed", type=int, required=True)
    ap.add_argument("--jobs", type=int, default=1, help="worker processes (default 1; see module docstring)")
    ap.add_argument("--dsn", default=default_dsn(env), help="connection string for the rc_owner login")
    args = ap.parse_args(argv)
    profile = PROFILES[args.profile]
    started = time.time()

    with psycopg.connect(args.dsn, autocommit=True) as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT (SELECT count(*) FROM organization) + (SELECT count(*) FROM unit)")
            row = cur.fetchone()
            assert row is not None
            if row[0] != 0:
                print("refusing to seed a database that already holds data", file=sys.stderr)
                return 2
        rounds = int(env.get("BCRYPT_ROUNDS", "12"))
        pw_hash = bcrypt.hashpw(DEMO_PASSWORD.encode(), bcrypt.gensalt(rounds=rounds)).decode()
        world = build_world(conn, profile, random.Random(f"{args.seed}:world"), pw_hash, args.seed)
        print(f"world built: {sum(profile.org_counts.values())} organisations, catalogue of {profile.models} models "
              f"({time.time() - started:.1f}s)", flush=True)

        chunks = list(range((profile.scenarios + profile.chunk_size - 1) // profile.chunk_size))
        totals = {"units": 0, "gap_units": 0, "missing": 0}
        init_args = (world, profile, args.dsn, args.seed)
        results: Iterable[dict[str, int]]
        if args.jobs <= 1:
            init_worker(*init_args)
            results = (run_chunk(c) for c in chunks)
            pool = None
        else:
            pool = multiprocessing.get_context("spawn").Pool(args.jobs, init_worker, init_args)
            results = pool.imap_unordered(run_chunk, chunks)
        for n, res in enumerate(results, 1):
            for k, v in res.items():
                totals[k] += v
            if n % max(1, len(chunks) // 10) == 0 or n == len(chunks):
                print(f"  chunks {n}/{len(chunks)}  units so far {totals['units']}  "
                      f"({time.time() - started:.0f}s)", flush=True)
        if pool is not None:
            pool.close()
            pool.join()

        certs = issue_certificates(conn, world, profile, args.seed)
        report = summary(conn)

    print(f"\nprofile={profile.name} seed={args.seed} jobs={args.jobs} elapsed={time.time() - started:.1f}s")
    for k, v in {**report, **{f'seeded_{k}': v for k, v in totals.items() if k != 'units'}, **certs}.items():
        print(f"{k:>20} {v}")
    print("\ndemo logins (fictional; password for all: " + DEMO_PASSWORD + ")")
    for email, role in world.logins[:12]:
        print(f"  {email:<28} {role}")
    if len(world.logins) > 12:
        print(f"  ... and {len(world.logins) - 12} more")
    return 0


if __name__ == "__main__":
    sys.exit(main())
