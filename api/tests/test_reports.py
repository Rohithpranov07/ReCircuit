"""T3.6: reports Q1-Q8 with CSV export, the audit endpoints and the admin routes."""
from __future__ import annotations

import csv
import io
from collections.abc import AsyncIterator, Iterator
from typing import Any

import httpx
import psycopg
import pytest
import pytest_asyncio

from app.db import Claims
from tests.conftest import Demo, Pg, World


@pytest_asyncio.fixture
async def http(app: Any) -> AsyncIterator[httpx.AsyncClient]:
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t", timeout=60) as client:
        yield client


def auth(app: Any, claims: Claims) -> dict[str, str]:
    token, _ = app.state.auth.issue_access_token(claims)
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def tamper(pg: Pg, world: World, demo: Demo) -> Iterator[None]:
    """A superuser edits one event's facility (trigger disabled), then puts it back."""
    def edit(facility: int) -> None:
        with psycopg.connect(pg.url("postgres"), autocommit=True) as conn:
            conn.execute("ALTER TABLE lifecycle_event DISABLE TRIGGER trg_event_immutable")
            conn.execute("UPDATE lifecycle_event SET facility_id = %s WHERE event_id = %s", (facility, demo.tamper_event_id))
            conn.execute("ALTER TABLE lifecycle_event ENABLE TRIGGER trg_event_immutable")
    edit(world.fac_p)
    yield
    edit(world.fac_t)


async def test_csv_has_the_same_rows_as_json(app: Any, http: httpx.AsyncClient, demo: Demo) -> None:
    aud = auth(app, demo.auditor)
    as_json = (await http.get("/api/v1/reports/current-state", headers=aud)).json()
    resp = await http.get("/api/v1/reports/current-state", headers=aud, params={"format": "csv"})
    assert resp.headers["content-type"].startswith("text/csv")
    parsed = list(csv.DictReader(io.StringIO(resp.text)))
    assert [int(r["unit_id"]) for r in parsed] == [r["unit_id"] for r in as_json]
    assert len(parsed) >= 2


async def test_report_roles_and_parameters(app: Any, http: httpx.AsyncClient, world: World, demo: Demo) -> None:
    aud, prod, tech = auth(app, demo.auditor), auth(app, world.producer()), auth(app, world.technician())
    assert (await http.get("/api/v1/reports/material-recovery", headers=aud)).status_code == 200
    assert (await http.get("/api/v1/reports/material-recovery", headers=prod)).status_code == 403
    assert (await http.get("/api/v1/reports/custody-gaps", headers=tech)).status_code == 403
    assert (await http.get("/api/v1/reports/nope", headers=aud)).status_code == 404
    assert (await http.get("/api/v1/reports/passport", headers=aud)).status_code == 400
    passport = (await http.get("/api/v1/reports/passport", headers=aud, params={"unit_id": demo.unit_id})).json()
    assert passport[0]["current_state"] == "DIAGNOSED"
    tree = await http.get("/api/v1/reports/part-tree", headers=aud, params={"root": demo.unit_id})
    assert tree.json() == []
    backing = await http.get("/api/v1/reports/certificate-backing", headers=aud, params={"shortfall": "true"})
    assert backing.json() == []
    reuse = await http.get("/api/v1/reports/reuse-inventory", headers=tech)
    assert reuse.status_code == 200


async def test_custody_gap_report_lists_the_unmanifested_unit(app: Any, http: httpx.AsyncClient, demo: Demo) -> None:
    gaps = (await http.get("/api/v1/reports/custody-gaps", headers=auth(app, demo.auditor))).json()
    assert demo.gap_unit_id in {g["unit_id"] for g in gaps}


async def test_tamper_check_detects_an_edited_event(app: Any, http: httpx.AsyncClient, demo: Demo) -> None:
    aud = auth(app, demo.auditor)
    clean = (await http.get("/api/v1/audit/verify", headers=aud)).json()
    assert clean["verified"] is True and clean["checked"] >= 2 and clean["broken"] == []
    assert (await http.get("/api/v1/reports/tamper-check", headers=aud)).json() == []


async def test_tamper_check_after_edit(app: Any, http: httpx.AsyncClient, demo: Demo, tamper: None) -> None:
    aud = auth(app, demo.auditor)
    one = (await http.get("/api/v1/audit/verify", headers=aud, params={"unit": demo.unit_id})).json()
    assert one == {"unit_id": demo.unit_id, "verified": False, "first_broken_event_id": demo.tamper_event_id}
    everything = (await http.get("/api/v1/audit/verify", headers=aud)).json()
    assert everything["verified"] is False
    assert [b["unit_id"] for b in everything["broken"]] == [demo.unit_id]
    report = (await http.get("/api/v1/reports/tamper-check", headers=aud)).json()
    assert report == [{"unit_id": demo.unit_id, "first_broken_event_id": demo.tamper_event_id}]


async def test_audit_log_is_for_oversight_roles(app: Any, http: httpx.AsyncClient, world: World, demo: Demo) -> None:
    log = (await http.get("/api/v1/audit/log", headers=auth(app, demo.admin))).json()
    assert log and {"log_id", "actor_name", "action", "entity", "entity_id"} <= set(log[0])
    assert (await http.get("/api/v1/audit/log", headers=auth(app, world.technician()))).status_code == 403
    assert (await http.get("/api/v1/audit/verify", headers=auth(app, world.producer()))).status_code == 403


async def test_admin_creates_a_working_account_and_deactivates_it(
        app: Any, http: httpx.AsyncClient, world: World, demo: Demo) -> None:
    adm = auth(app, demo.admin)
    assert (await http.post("/api/v1/organizations", headers=auth(app, world.producer()), json={
        "org_name": "X", "org_type": "RECYCLER"})).status_code == 403
    org = (await http.post("/api/v1/organizations", headers=adm, json={
        "org_name": "Demo Recycler 77", "org_type": "RECYCLER", "cpcb_reg_no": "CPCB-ADM-1",
        "gstin": "27ADMIN0001A1Z9"})).json()["org_id"]
    fac = (await http.post(f"/api/v1/organizations/{org}/facilities", headers=adm, json={
        "facility_name": "Plant 77", "pincode": "600077", "authorised_capacity_tpa": 500})).json()["facility_id"]
    created = await http.post("/api/v1/actors", headers=adm, json={
        "facility_id": fac, "full_name": "Demo Operator", "role": "RECYCLER_OPERATOR",
        "email": "op77@example.com", "password": "a-long-demo-password"})
    assert created.status_code == 201
    actor = created.json()["actor_id"]
    login = await http.post("/api/v1/auth/login", json={"email": "op77@example.com", "password": "a-long-demo-password"})
    assert login.status_code == 200
    listed = (await http.get("/api/v1/actors", headers=adm)).json()
    assert all("password_hash" not in a for a in listed)
    assert (await http.patch(f"/api/v1/actors/{actor}", headers=adm, json={"is_active": False})).status_code == 204
    again = await http.post("/api/v1/auth/login", json={"email": "op77@example.com", "password": "a-long-demo-password"})
    assert again.status_code == 401
    dup = await http.post("/api/v1/actors", headers=adm, json={
        "facility_id": fac, "full_name": "Dup", "role": "COLLECTOR", "email": "op77@example.com",
        "password": "another-long-password"})
    assert (dup.status_code, dup.json()["error"]["code"]) == (409, "DUPLICATE")
    orgs = (await http.get("/api/v1/organizations", headers=adm)).json()
    assert any(o["org_id"] == org and o["facilities"][0]["facility_id"] == fac for o in orgs)


async def test_me_and_the_organisation_directory_for_staff(app: Any, http: httpx.AsyncClient, world: World) -> None:
    tech = auth(app, world.technician())
    me = (await http.get("/api/v1/auth/me", headers=tech)).json()
    assert (me["role"], me["org_id"]) == ("TECHNICIAN", world.org_t)
    assert world.fac_t in [f["facility_id"] for f in me["facilities"]]
    assert (await http.get("/api/v1/auth/me")).status_code == 401
    orgs = (await http.get("/api/v1/organizations", headers=tech)).json()
    assert {o["org_id"] for o in orgs} >= {world.org_p, world.org_t}
    assert (await http.post("/api/v1/organizations", headers=tech, json={"org_name": "X", "org_type": "RECYCLER"})).status_code == 403
