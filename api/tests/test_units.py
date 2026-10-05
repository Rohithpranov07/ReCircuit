"""T3.4: flows F1 (collect -> dismantle -> test -> reuse inventory) and F2 (reinstall, duplicate refused)
over HTTP against a real database."""
from __future__ import annotations

from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
import psycopg
import pytest
import pytest_asyncio

from app.db import Claims
from tests.conftest import Pg, World

T0 = datetime.now(UTC) - timedelta(days=40)


def at(days: float) -> str:
    return (T0 + timedelta(days=days)).isoformat()


class Cast:
    """Everyone in the flow, with their tokens."""

    def __init__(self, world: World, collector: Claims, fac_c: int, material_id: int) -> None:
        self.world, self.collector, self.fac_c, self.material_id = world, collector, fac_c, material_id


@pytest.fixture(scope="module")
def cast(pg: Pg, world: World) -> Cast:
    with psycopg.connect(pg.url("rc_owner"), autocommit=True) as conn:
        def one(q: str, *a: Any) -> int:
            row = conn.execute(q, a).fetchone()
            assert row is not None
            return int(row[0])
        org_c = one("SELECT sp_admin_create_org('Demo Collector 01','COLLECTOR','CPCB-T-3','27TESTC0001A1Z3')")
        fac_c = one("SELECT sp_admin_create_facility(%s,'Hub C','600003')", org_c)
        actor_c = one("SELECT sp_admin_create_actor(%s,'Demo C','COLLECTOR','c@example.com','x')", fac_c)
        material = one("INSERT INTO material (material_name, is_critical) VALUES ('Test Cobalt', true) "
                       "RETURNING material_id")
    return Cast(world, Claims(actor_c, org_c, "COLLECTOR"), fac_c, material)


@pytest_asyncio.fixture
async def http(app: Any) -> AsyncIterator[httpx.AsyncClient]:
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t") as client:
        yield client


def auth(app: Any, claims: Claims) -> dict[str, str]:
    token, _ = app.state.auth.issue_access_token(claims)
    return {"Authorization": f"Bearer {token}"}


async def test_flows_f1_and_f2(app: Any, http: httpx.AsyncClient, cast: Cast) -> None:
    w = cast.world
    prod, coll, tech = auth(app, w.producer()), auth(app, cast.collector), auth(app, w.technician())

    # -- producer: catalogue and units
    laptop_model = (await http.post("/api/v1/models", headers=prod, json={
        "model_number": "F-LTP", "category": "DEVICE", "mass_g": 1500, "spec": {"form_factor": "laptop"}})).json()["model_id"]
    battery_model = (await http.post("/api/v1/models", headers=prod, json={
        "model_number": "F-BAT", "category": "BATTERY", "mass_g": 250, "spec": {"chemistry": "Li-ion"}})).json()["model_id"]
    bad = await http.post("/api/v1/models", headers=prod, json={
        "model_number": "F-BAD", "category": "BATTERY", "mass_g": 250, "spec": {"bogus": 1}})
    assert (bad.status_code, bad.json()["error"]["code"]) == (400, "SPEC_KEY_UNKNOWN")
    materials = (await http.get("/api/v1/materials", headers=tech)).json()
    assert cast.material_id in [m["material_id"] for m in materials]
    put = await http.put(f"/api/v1/models/{battery_model}/materials", headers=prod,
                         json=[{"material_id": cast.material_id, "mass_mg": 42000}])
    assert put.status_code == 204

    unit_ids: dict[str, int] = {}
    for key, model, serial in [("laptop_a", laptop_model, "F-A"), ("battery", battery_model, "F-B"),
                               ("laptop_b", laptop_model, "F-C")]:
        resp = await http.post("/api/v1/units", headers=prod, json={
            "model_id": model, "serial_no": serial, "manufactured_on": "2023-03-10"})
        assert resp.status_code == 201
        unit_ids[key] = resp.json()["unit_id"]
        ev = await http.post(f"/api/v1/units/{unit_ids[key]}/events", headers=prod, json={
            "event_type": "MANUFACTURED", "occurred_at": at(0), "facility_id": w.fac_p})
        assert ev.status_code == 201 and len(ev.json()["event_hash"]) == 64
    laptop_a, battery, laptop_b = unit_ids["laptop_a"], unit_ids["battery"], unit_ids["laptop_b"]
    bulk = await http.post("/api/v1/units/bulk", headers=prod, json={"units": [
        {"model_id": battery_model, "serial_no": "F-BULK-1"}, {"model_id": battery_model, "serial_no": "F-BULK-2"}]})
    assert bulk.status_code == 201 and len(bulk.json()["unit_ids"]) == 2

    # -- F1: collector collects and dismantles
    assert (await http.post(f"/api/v1/units/{laptop_a}/events", headers=coll, json={
        "event_type": "COLLECTED", "occurred_at": at(10), "facility_id": cast.fac_c})).status_code == 201
    dis = await http.post(f"/api/v1/units/{laptop_a}/dismantle", headers=coll, json={
        "parts": [{"model_id": battery_model, "serial_no": "F-B"}], "occurred_at": at(10.01),
        "facility_id": cast.fac_c})
    assert dis.status_code == 201 and [p["unit_id"] for p in dis.json()["parts"]] == [battery]
    tree_then = await http.get(f"/api/v1/units/{laptop_a}/tree", headers=tech, params={"as_of": at(5)})
    assert [r["unit_id"] for r in tree_then.json()] == [battery]
    assert (await http.get(f"/api/v1/units/{laptop_a}/tree", headers=tech)).json() == []

    # -- technician tests the battery: DIAGNOSED event with score 86, then the reuse inventory lists it
    tests = await http.post(f"/api/v1/units/{battery}/tests", headers=tech, json={
        "occurred_at": at(12), "facility_id": w.fac_t,
        "tests": [{"test_type": "BATTERY_SOH", "result": "PASS", "measured_value": 86, "health_score": 86}]})
    assert (tests.status_code, tests.json()["event_type"]) == (201, "DIAGNOSED")
    inv = await http.get("/api/v1/inventory/reuse", headers=tech, params={"category": "BATTERY", "min_health": 80})
    assert [(r["unit_id"], r["latest_health"]) for r in inv.json()] == [(battery, 86)]
    assert (await http.get("/api/v1/inventory/reuse", headers=tech, params={"min_health": 90})).json() == []

    # -- F2: reinstall into laptop B (collected, diagnosed, refurbished first)
    for kind, day in [("COLLECTED", 11), ("DIAGNOSED", 13), ("REFURBISHED", 13.5)]:
        resp = await http.post(f"/api/v1/units/{laptop_b}/events", headers=tech, json={
            "event_type": kind, "occurred_at": at(day), "facility_id": w.fac_t})
        assert resp.status_code == 201, resp.text
    body = {"new_parent_unit_id": laptop_b, "occurred_at": at(14), "facility_id": w.fac_t}
    first = await http.post(f"/api/v1/units/{battery}/reinstall", headers=tech, json=body)
    assert (first.status_code, first.json()["event_type"]) == (201, "REINSTALLED")
    dup = await http.post(f"/api/v1/units/{battery}/reinstall", headers=tech,
                          json={**body, "occurred_at": at(14.1)})
    assert dup.status_code == 409
    assert dup.json()["error"] == {"code": "ASM_OVERLAP", "constraint": "assembly_link_excl",
                                   "message": dup.json()["error"]["message"]}

    # -- passport, history, timeline, QR
    with psycopg.connect(app.state.settings.database_url.replace("rc_app", "rc_owner")) as conn:
        row = conn.execute("SELECT passport_uid FROM unit WHERE unit_id = %s", (battery,)).fetchone()
        assert row is not None
        passport_uid = str(row[0])
    by_serial = await http.get("/api/v1/units", headers=tech, params={"model_id": battery_model, "serial_no": "F-B"})
    assert (by_serial.status_code, by_serial.json()["passport_uid"], by_serial.json()["unit_id"]) == (200, passport_uid, battery)
    assert (await http.get("/api/v1/units", headers=tech, params={"model_id": battery_model, "serial_no": "nope"})).status_code == 404
    passport = (await http.get(f"/api/v1/units/{passport_uid}", headers=tech)).json()
    assert passport["current_state"] == "REINSTALLED"
    assert passport["current_parent"]["unit_id"] == laptop_b
    assert passport["chain_verified"] is True
    assert passport["current_holder"]["org_id"] == w.org_t
    assert passport["model"]["materials"] == [{"material_name": "Test Cobalt", "mass_mg": 42000.0, "is_critical": True}]
    hist = (await http.get(f"/api/v1/units/{battery}/history", headers=tech)).json()
    assert [h["parent_unit_id"] for h in hist] == [laptop_a, laptop_b]
    events = (await http.get(f"/api/v1/units/{battery}/events", headers=tech)).json()
    assert [e["event_type"] for e in events] == ["MANUFACTURED", "COLLECTED", "HARVESTED", "DIAGNOSED", "REINSTALLED"]
    assert events[3]["tests"][0]["health_score"] == 86
    qr = await http.get(f"/api/v1/units/{battery}/qr", headers=tech)
    assert qr.headers["content-type"] == "image/png" and qr.content[:8] == b"\x89PNG\r\n\x1a\n"


async def test_guards_and_errors(app: Any, http: httpx.AsyncClient, cast: Cast) -> None:
    w = cast.world
    prod, tech = auth(app, w.producer()), auth(app, w.technician())
    body = {"occurred_at": at(20), "facility_id": w.fac_p}
    assert (await http.post("/api/v1/units/1/harvest", headers=prod, json=body)).status_code == 403
    assert (await http.get("/api/v1/inventory/reuse", headers=prod)).status_code == 403
    assert (await http.get("/api/v1/inventory/reuse")).status_code == 401
    unknown = await http.get("/api/v1/units/6f1d6a52-3c5f-4a54-8f4e-2f5b3a6c9d10", headers=tech)
    assert (unknown.status_code, unknown.json()["error"]["code"]) == (404, "NOT_FOUND")
    naive = await http.post("/api/v1/units/1/harvest", headers=tech,
                            json={"occurred_at": "2026-01-01T00:00:00", "facility_id": 1})
    assert (naive.status_code, naive.json()["error"]["code"]) == (400, "INVALID_VALUE")
    missing = await http.get("/api/v1/units/999999/qr", headers=tech)
    assert missing.status_code == 404
