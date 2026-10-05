"""T3.2: the request pipeline (CALL vs SELECT, role switching, allow-list) and the error mapper."""
from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
import psycopg
import pytest

from app.db import Claims, Database, build_statement
from app.errors import ApiException, map_db_error
from tests.conftest import Pg, World

PAST = datetime.now(UTC) - timedelta(days=30)


def test_procedures_are_called_and_functions_selected() -> None:
    stmt, _ = build_statement("sp_record_event", {"p_unit": 1, "p_type": "COLLECTED", "p_at": PAST, "p_facility": 1})
    assert stmt.as_string().startswith("CALL ")
    stmt, _ = build_statement("sp_create_unit", {"p_model": 1, "p_serial": "S"})
    assert stmt.as_string().startswith("SELECT * FROM ")
    assert "%s" in stmt.as_string() and "'S'" not in stmt.as_string()      # values are bound, not interpolated


def test_nothing_outside_the_allow_list_is_callable() -> None:
    with pytest.raises(KeyError):
        build_statement("pg_sleep", {})
    with pytest.raises(TypeError):
        build_statement("sp_create_unit", {"p_model": 1, "p_serial": "S", "bogus": 1})


async def test_function_and_procedure_run_under_the_callers_role(database: Database, world: World) -> None:
    rows = await database.run(world.producer(), "sp_create_unit", p_model=world.model_ssd, p_serial="PIPE-1")
    unit_id = rows[0]["sp_create_unit"]
    assert isinstance(unit_id, int)
    assert await database.run(world.technician(), "sp_record_event", p_unit=unit_id, p_type="COLLECTED",
                              p_at=PAST, p_facility=world.fac_t) == []
    ver = await database.run(world.technician(), "sp_verify_chain", p_unit=unit_id)
    assert ver[0]["sp_verify_chain"] is None


async def test_role_is_enforced_by_the_database(database: Database, world: World) -> None:
    with pytest.raises(ApiException) as exc:
        await database.run(world.technician(), "sp_register_model", p_model_number="X", p_category="OTHER",
                           p_mass_g=1)
    assert (exc.value.status, exc.value.code) == (403, "FORBIDDEN")


async def test_rc_context_is_visible_to_routines(database: Database, world: World) -> None:
    other = Claims(world.actor_t, world.org_t, "PRODUCER")         # facility of another organisation
    rows = await database.run(world.producer(), "sp_create_unit", p_model=world.model_ssd, p_serial="PIPE-2")
    with pytest.raises(ApiException) as exc:
        await database.run(other, "sp_record_event", p_unit=rows[0]["sp_create_unit"], p_type="COLLECTED",
                           p_at=PAST, p_facility=world.fac_p)
    assert exc.value.code in {"FORBIDDEN", "FACILITY_NOT_YOURS"}


async def test_illegal_transition_maps_to_422(app: Any, database: Database, world: World) -> None:
    unit = (await database.run(world.producer(), "sp_create_unit", p_model=world.model_ssd,
                               p_serial="PIPE-3"))[0]["sp_create_unit"]
    await database.run(world.technician(), "sp_record_event", p_unit=unit, p_type="COLLECTED", p_at=PAST,
                       p_facility=world.fac_t)

    async def record(unit_id: int, kind: str) -> dict[str, str]:      # test-only route; the real ones arrive in T3.4
        await database.run(world.technician(), "sp_record_event", p_unit=unit_id, p_type=kind,
                           p_at=PAST + timedelta(hours=1), p_facility=world.fac_t)
        return {"ok": "true"}

    app.add_api_route("/_t/event", record, methods=["POST"])
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t") as client:
        resp = await client.post("/_t/event", params={"unit_id": unit, "kind": "REINSTALLED"})
    assert resp.status_code == 422
    body = resp.json()
    assert body == {"error": {"code": "ILLEGAL_TRANSITION", "constraint": None, "message": body["error"]["message"]}}
    assert "COLLECTED -> REINSTALLED" in body["error"]["message"]


async def test_overlap_and_unique_violations_map_with_constraint_names(database: Database, world: World,
                                                                       pg: Pg) -> None:
    with pytest.raises(ApiException) as dup:
        await database.run(world.producer(), "sp_create_unit", p_model=world.model_ssd, p_serial="PIPE-1")
    assert (dup.value.status, dup.value.code) == (409, "DUPLICATE")
    with psycopg.connect(pg.url("rc_owner")) as conn:
        conn.execute("INSERT INTO unit (model_id, serial_no) VALUES (%s,'EXCL-A'),(%s,'EXCL-B')",
                     (world.model_ssd, world.model_ssd))
        a, b = [r[0] for r in conn.execute("SELECT unit_id FROM unit WHERE serial_no IN ('EXCL-A','EXCL-B') "
                                           "ORDER BY serial_no").fetchall()]
        conn.execute("INSERT INTO assembly_link (child_unit_id, installed_at, parent_unit_id) VALUES (%s,%s,%s)",
                     (a, PAST, b))
        with pytest.raises(psycopg.errors.ExclusionViolation) as raised:
            conn.execute("INSERT INTO assembly_link (child_unit_id, installed_at, parent_unit_id) VALUES (%s,%s,%s)",
                         (a, PAST + timedelta(days=1), b))
        mapped = map_db_error(raised.value)
        conn.rollback()
    assert (mapped.status, mapped.code, mapped.constraint) == (409, "ASM_OVERLAP", "assembly_link_excl")


async def test_health_reports_postgresql_16(app: Any) -> None:
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t") as client:
        resp = await client.get("/api/v1/health")
    assert resp.status_code == 200
    assert "PostgreSQL 16" in resp.json()["database"]
