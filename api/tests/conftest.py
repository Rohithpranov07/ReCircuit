"""Test infrastructure: a throw-away PostgreSQL 16 container built from the real migrations."""
from __future__ import annotations

import os
import subprocess
from collections.abc import AsyncIterator, Iterator
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import psycopg
import pytest
import pytest_asyncio
from testcontainers.community.postgres import PostgresContainer

from app.config import Settings
from app.db import Claims, Database
from app.main import create_app

REPO = Path(__file__).resolve().parents[2]
PASSWORD = "test-password"


@dataclass
class Pg:
    host: str
    port: int

    def url(self, user: str, db: str = "recircuit") -> str:
        return f"postgresql://{user}:{PASSWORD}@{self.host}:{self.port}/{db}"


@pytest.fixture(scope="session")
def pg() -> Iterator[Pg]:
    with PostgresContainer("postgres:16", username="postgres", password=PASSWORD, dbname="postgres",
                           driver=None) as c:
        info = Pg(c.get_container_host_ip(), int(c.get_exposed_port(5432)))
        with psycopg.connect(info.url("postgres", "postgres"), autocommit=True) as conn:
            conn.execute(f"CREATE ROLE rc_owner LOGIN CREATEROLE PASSWORD '{PASSWORD}'")
            conn.execute(f"CREATE ROLE rc_app LOGIN NOINHERIT PASSWORD '{PASSWORD}'")
            conn.execute("CREATE DATABASE recircuit OWNER rc_owner")
        env = {**os.environ, "DBMATE_MIGRATIONS_TABLE": "dbmate.schema_migrations", "DBMATE_NO_DUMP_SCHEMA": "true"}
        subprocess.run(["dbmate", "--url", info.url("rc_owner") + "?sslmode=disable", "-d",
                        str(REPO / "db" / "migrations"), "up"], check=True, env=env, capture_output=True)
        yield info


@dataclass
class World:
    org_p: int
    org_t: int
    fac_p: int
    fac_t: int
    actor_p: int
    actor_t: int
    model_ssd: int

    def producer(self) -> Claims:
        return Claims(self.actor_p, self.org_p, "PRODUCER")

    def technician(self) -> Claims:
        return Claims(self.actor_t, self.org_t, "TECHNICIAN")


@pytest.fixture(scope="session")
def world(pg: Pg) -> World:
    """A producer and a technician organisation, built through the routines as the owner would."""
    with psycopg.connect(pg.url("rc_owner"), autocommit=True) as conn:
        def one(q: str, *a: Any) -> int:
            row = conn.execute(q, a).fetchone()
            assert row is not None
            return int(row[0])
        org_p = one("SELECT sp_admin_create_org('Demo Producer 01','PRODUCER','CPCB-T-1','27TESTP0001A1Z1')")
        org_t = one("SELECT sp_admin_create_org('Demo Refurbisher 01','REFURBISHER','CPCB-T-2','27TESTR0001A1Z2')")
        fac_p = one("SELECT sp_admin_create_facility(%s,'Plant P','600001')", org_p)
        fac_t = one("SELECT sp_admin_create_facility(%s,'Lab T','600002')", org_t)
        actor_p = one("SELECT sp_admin_create_actor(%s,'Demo P','PRODUCER','p@example.com','x')", fac_p)
        actor_t = one("SELECT sp_admin_create_actor(%s,'Demo T','TECHNICIAN','t@example.com','x')", fac_t)
        with conn.transaction():
            conn.execute("SELECT set_config('rc.org_id', %s, true), set_config('rc.actor_id', %s, true)",
                         (str(org_p), str(actor_p)))
            model = one("SELECT sp_register_model('SSD-1','STORAGE',20)")
    return World(org_p, org_t, fac_p, fac_t, actor_p, actor_t, model)


@pytest_asyncio.fixture(scope="session")
async def database(pg: Pg) -> AsyncIterator[Database]:
    db = Database(pg.url("rc_app"))
    await db.open()
    yield db
    await db.close()


@pytest.fixture(scope="session")
def settings(pg: Pg) -> Settings:
    return Settings(database_url=pg.url("rc_app"), jwt_secret="test-secret-test-secret-test-secret",
                    jwt_access_ttl_min=15, jwt_refresh_ttl_days=7, bcrypt_rounds=4, login_max_failures=5,
                    login_lock_minutes=15, public_base_url="http://localhost:5173",
                    public_rate_limit="30/minute", cors_origins=[], serializable_retries=3)


@pytest.fixture
def app(settings: Settings, database: Database) -> Any:
    return create_app(settings, database)


@dataclass
class Demo:
    auditor: Claims
    admin: Claims
    unit_id: int
    passport_uid: str
    gap_unit_id: int
    tamper_event_id: int


@pytest.fixture(scope="session")
def demo(pg: Pg, world: World) -> Demo:
    """An auditor, an admin, one fully tested unit and one unit with a custody gap."""
    from datetime import UTC, datetime, timedelta
    base = datetime.now(UTC) - timedelta(days=20)
    with psycopg.connect(pg.url("rc_owner"), autocommit=True) as conn:
        def one(q: str, *a: Any) -> Any:
            row = conn.execute(q, a).fetchone()
            assert row is not None
            return row[0]
        aud = int(one("SELECT sp_admin_create_actor(%s,'Demo Auditor','AUDITOR','aud@example.com','x')", world.fac_p))
        adm = int(one("SELECT sp_admin_create_actor(%s,'Demo Admin','ADMIN','adm@example.com','x')", world.fac_p))
        unit = int(one("SELECT sp_create_unit(%s,'DEMO-1')", world.model_ssd))
        gap = int(one("SELECT sp_create_unit(%s,'DEMO-GAP')", world.model_ssd))
        with conn.transaction():
            conn.execute("SELECT set_config('rc.org_id', %s, true), set_config('rc.actor_id', %s, true)",
                         (str(world.org_p), str(world.actor_p)))
            conn.execute("CALL sp_record_event(%s,'MANUFACTURED',%s,%s)", (unit, base, world.fac_p))
            conn.execute("CALL sp_record_event(%s,'MANUFACTURED',%s,%s)", (gap, base, world.fac_p))
        with conn.transaction():
            conn.execute("SELECT set_config('rc.org_id', %s, true), set_config('rc.actor_id', %s, true)",
                         (str(world.org_t), str(world.actor_t)))
            conn.execute("CALL sp_record_event(%s,'COLLECTED',%s,%s)", (unit, base + timedelta(days=1), world.fac_t))
            conn.execute("CALL sp_record_event(%s,'COLLECTED',%s,%s)", (gap, base + timedelta(days=1), world.fac_t))
            conn.execute("""CALL sp_record_tests(%s,%s,%s,'[{"test_type":"BATTERY_SOH","result":"PASS","measured_value":86,"health_score":86}]'::jsonb)""",
                         (unit, base + timedelta(days=2), world.fac_t))
        uid = str(one("SELECT passport_uid FROM unit WHERE unit_id = %s", unit))
        tamper = int(one("SELECT event_id FROM lifecycle_event WHERE unit_id = %s AND event_type = 'COLLECTED'", unit))
    return Demo(Claims(aud, world.org_p, "AUDITOR"), Claims(adm, world.org_p, "ADMIN"), unit, uid, gap, tamper)
