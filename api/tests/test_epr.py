"""T3.5: custody manifests, EPR certificates, compliance, and the 20-way issuance race."""
from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
import psycopg
import pytest
import pytest_asyncio

from app.db import Claims
from tests.conftest import Pg, World

T0 = datetime.now(UTC) - timedelta(days=60)


def at(days: float) -> str:
    return (T0 + timedelta(days=days)).isoformat()


class Cast:
    def __init__(self, world: World, collector: Claims, fac_c: int, recycler: Claims, fac_y: int,
                 recycled: list[int], other: list[int]) -> None:
        self.world, self.collector, self.fac_c = world, collector, fac_c
        self.recycler, self.fac_y, self.recycled, self.other = recycler, fac_y, recycled, other


@pytest.fixture(scope="module")
def cast(pg: Pg, world: World) -> Cast:
    with psycopg.connect(pg.url("rc_owner"), autocommit=True) as conn:
        def one(q: str, *a: Any) -> int:
            row = conn.execute(q, a).fetchone()
            assert row is not None
            return int(row[0])
        org_c = one("SELECT sp_admin_create_org('Demo Collector 02','COLLECTOR','CPCB-E-1','27TESTE0001A1Z1')")
        org_y = one("SELECT sp_admin_create_org('Demo Recycler 01','RECYCLER','CPCB-E-2','27TESTE0002A1Z2')")
        fac_c = one("SELECT sp_admin_create_facility(%s,'Hub C2','600011')", org_c)
        fac_y = one("SELECT sp_admin_create_facility(%s,'Plant Y','600012')", org_y)
        actor_c = one("SELECT sp_admin_create_actor(%s,'Demo C2','COLLECTOR','c2@example.com','x')", fac_c)
        actor_y = one("SELECT sp_admin_create_actor(%s,'Demo Y','RECYCLER_OPERATOR','y@example.com','x')", fac_y)
        units = [one("SELECT sp_create_unit(%s, %s)", world.model_ssd, f"EPR-{i}") for i in range(30)]
        with conn.transaction():
            conn.execute("SELECT set_config('rc.org_id', %s, true), set_config('rc.actor_id', %s, true)",
                         (str(org_y), str(actor_y)))
            for n, u in enumerate(units):
                conn.execute("CALL sp_record_event(%s,'COLLECTED',%s,%s)", (u, T0 + timedelta(days=1), fac_y))
                if n < 25:    # the last five are never recycled
                    conn.execute("CALL sp_record_event(%s,'RECYCLED',%s,%s)", (u, T0 + timedelta(days=2), fac_y))
    return Cast(world, Claims(actor_c, org_c, "COLLECTOR"), fac_c, Claims(actor_y, org_y, "RECYCLER_OPERATOR"),
                fac_y, units[:25], units[25:])


@pytest_asyncio.fixture
async def http(app: Any) -> AsyncIterator[httpx.AsyncClient]:
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t", timeout=60) as client:
        yield client


def auth(app: Any, claims: Claims) -> dict[str, str]:
    token, _ = app.state.auth.issue_access_token(claims)
    return {"Authorization": f"Bearer {token}"}


def cert_body(no: str, units: list[int], kg: float, grams: float = 1000) -> dict[str, Any]:
    return {"cert_no": no, "category": "ITEW2", "quantity_kg": kg, "financial_year": "2026-27",
            "issued_on": "2026-10-01", "units": [{"unit_id": u, "recovered_mass_g": grams} for u in units]}


async def test_custody_manifest_flow(app: Any, http: httpx.AsyncClient, cast: Cast) -> None:
    coll, rec, tech = auth(app, cast.collector), auth(app, cast.recycler), auth(app, cast.world.technician())
    body = {"manifest_no": "MF-API-1", "to_org_id": cast.recycler.org_id, "shipped_at": at(3), "total_mass_kg": 1.2,
            "items": [{"unit_id": cast.other[0], "declared_condition": "SCRAP"},
                      {"unit_id": cast.other[1], "declared_condition": "FAULTY"}]}
    created = await http.post("/api/v1/transfers", headers=coll, json=body)
    assert created.status_code == 201
    transfer = created.json()["transfer_id"]
    again = await http.post("/api/v1/transfers", headers=coll,
                            json={**body, "manifest_no": "MF-API-2", "items": body["items"][:1]})
    assert (again.status_code, again.json()["error"]["code"]) == (409, "TRANSFER_ALREADY_OPEN")

    assert [t["manifest_no"] for t in (await http.get("/api/v1/transfers", headers=coll)).json()] == ["MF-API-1"]
    assert (await http.get("/api/v1/transfers", headers=tech)).json() == []          # not a party: row-level security

    own = await http.post(f"/api/v1/transfers/{transfer}/receive", headers=coll, json={"received_at": at(4)})
    assert (own.status_code, own.json()["error"]["code"]) == (409, "TRANSFER_NOT_OPEN")
    ok = await http.post(f"/api/v1/transfers/{transfer}/receive", headers=rec,
                         json={"received_at": at(4), "missing_unit_ids": [cast.other[1]]})
    assert ok.status_code == 204
    listed = (await http.get("/api/v1/transfers", headers=rec)).json()[0]
    assert listed["received_at"] is not None
    assert listed["discrepancies"] == [{"unit_id": cast.other[1], "kind": "MISSING"}]


async def test_certificate_allocation_and_compliance(app: Any, http: httpx.AsyncClient, cast: Cast) -> None:
    w = cast.world
    rec, prod, coll = auth(app, cast.recycler), auth(app, w.producer()), auth(app, cast.collector)
    issued = await http.post("/api/v1/certificates", headers=rec,
                             json=cert_body("RC-API-1", cast.recycled[:1], 0.9, 1100))
    assert issued.status_code == 201
    cert = issued.json()["cert_id"]

    reuse = await http.post("/api/v1/certificates", headers=rec, json=cert_body("RC-API-2", cast.recycled[:1], 0.5))
    assert (reuse.status_code, reuse.json()["error"]["code"]) == (409, "CERT_UNIT_REUSED")
    unrecycled = await http.post("/api/v1/certificates", headers=rec, json=cert_body("RC-API-3", cast.other[:1], 0.5))
    assert (unrecycled.status_code, unrecycled.json()["error"]["code"]) == (409, "CERT_UNIT_NOT_RECYCLED")
    over = await http.post("/api/v1/certificates", headers=rec,
                           json=cert_body("RC-API-4", cast.recycled[1:2], 5, 1100))
    assert (over.status_code, over.json()["error"]["code"]) == (409, "CERT_OVERCLAIM")

    not_producer = await http.post(f"/api/v1/certificates/{cert}/allocate", headers=rec,
                                   json={"producer_id": cast.recycler.org_id})
    assert (not_producer.status_code, not_producer.json()["error"]["code"]) == (422, "NOT_A_PRODUCER")
    assert (await http.post(f"/api/v1/certificates/{cert}/allocate", headers=rec,
                            json={"producer_id": w.org_p})).status_code == 204
    twice = await http.post(f"/api/v1/certificates/{cert}/allocate", headers=rec, json={"producer_id": w.org_p})
    assert (twice.status_code, twice.json()["error"]["code"]) == (409, "CERT_ALREADY_ALLOCATED")

    assert (await http.put(f"/api/v1/compliance/{w.org_p}", headers=prod, json={
        "category": "ITEW2", "financial_year": "2026-27", "target_kg": 10})).status_code == 204
    compliance = (await http.get(f"/api/v1/compliance/{w.org_p}", headers=prod)).json()
    assert [(c["category"], float(c["acquired_kg"]), float(c["pct_of_target"])) for c in compliance] == [("ITEW2", 0.9, 9.0)]
    assert (await http.get(f"/api/v1/compliance/{w.org_t}", headers=prod)).status_code == 403   # someone else's
    certs = (await http.get("/api/v1/certificates", headers=prod)).json()
    assert [(c["cert_no"], float(c["backed_kg"])) for c in certs] == [("RC-API-1", 1.1)]
    assert (await http.get("/api/v1/certificates", headers=coll)).status_code == 403


async def test_twenty_parallel_issuances_over_the_same_units_yield_one_certificate(
        app: Any, http: httpx.AsyncClient, cast: Cast) -> None:
    rec = auth(app, cast.recycler)
    units = cast.recycled[5:10]
    results = await asyncio.gather(*[
        http.post("/api/v1/certificates", headers=rec, json=cert_body(f"RC-RACE-{i:02d}", units, 4.0, 1000))
        for i in range(20)])
    codes = sorted(r.status_code for r in results)
    assert codes.count(201) == 1 and codes.count(409) == 19
    assert {r.json()["error"]["code"] for r in results if r.status_code == 409} <= {"CERT_UNIT_REUSED",
                                                                                   "CONFLICT_RETRY"}
    certs = (await http.get("/api/v1/certificates", headers=rec)).json()
    assert len([c for c in certs if c["cert_no"].startswith("RC-RACE-")]) == 1
