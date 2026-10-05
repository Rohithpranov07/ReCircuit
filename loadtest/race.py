"""Concurrency evidence over HTTP against the running stack (NFR-3 and NFR-4).

  NFR-3  two technicians reinstall the same part at the same moment: exactly one commits, the other is refused.
  NFR-4  twenty recyclers' requests issue certificates over the same recycled units at SERIALIZABLE: exactly one wins.

Everything is set up through the API with the seeded demo accounts.   usage: api/.venv/bin/python loadtest/race.py
"""
from __future__ import annotations

import asyncio
import os
import sys
import time
from collections import Counter
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx

API = os.environ.get("API_URL", "http://localhost:8000/api/v1")
PASSWORD = os.environ.get("LOAD_PASSWORD", "recircuit-demo")
RUN = format(int(time.time()), "x")


def ago(days: float) -> str:
    return (datetime.now(UTC) - timedelta(days=days)).isoformat()


class Actor:
    def __init__(self, http: httpx.AsyncClient, email: str) -> None:
        self.http, self.email = http, email
        self.token = ""
        self.org_id = 0
        self.facility_id = 0

    async def login(self) -> Actor:
        r = await self.http.post(f"{API}/auth/login", json={"email": self.email, "password": PASSWORD})
        r.raise_for_status()
        self.token = r.json()["access_token"]
        me = (await self.call("GET", "/auth/me")).json()
        self.org_id, self.facility_id = me["org_id"], me["facilities"][0]["facility_id"]
        return self

    async def call(self, method: str, path: str, **kw: Any) -> httpx.Response:
        return await self.http.request(method, f"{API}{path}", headers={"Authorization": f"Bearer {self.token}"}, **kw)

    async def ok(self, method: str, path: str, **kw: Any) -> Any:
        r = await self.call(method, path, **kw)
        if r.status_code >= 400:
            raise SystemExit(f"{method} {path} -> {r.status_code} {r.text}")
        return r.json() if r.content else None


async def model_of(a: Actor, category: str, producer_org: int) -> dict[str, Any]:
    models = await a.ok("GET", f"/models?category={category}&limit=500")
    return next(m for m in models if m["manufacturer_id"] == producer_org)


async def make_unit(producer: Actor, model_id: int, label: str, n: int) -> dict[str, Any]:
    serial = f"{label}-{RUN}-{n}"
    created = await producer.ok("POST", "/units", json={"model_id": model_id, "serial_no": serial})
    await producer.ok("POST", f"/units/{created['unit_id']}/events",
                      json={"event_type": "MANUFACTURED", "occurred_at": ago(3), "facility_id": producer.facility_id})
    return {"unit_id": created["unit_id"], "serial": serial}


async def nfr3(http: httpx.AsyncClient, rounds: int) -> Counter[str]:
    producer, collector, t1, t2 = [await Actor(http, e).login() for e in (
        "producer01@example.com", "collector01@example.com", "refurbisher01@example.com", "refurbisher02@example.com")]
    device_model = await model_of(producer, "DEVICE", producer.org_id)
    battery_model = await model_of(producer, "BATTERY", producer.org_id)
    outcomes: Counter[str] = Counter()
    for i in range(rounds):
        donor = await make_unit(producer, device_model["model_id"], "R3D", i)
        part = await make_unit(producer, battery_model["model_id"], "R3B", i)
        targets = []
        for tech, tag in ((t1, "a"), (t2, "b")):
            t = await make_unit(producer, device_model["model_id"], f"R3T{tag}", i)
            for kind, at in (("COLLECTED", 2.0), ("DIAGNOSED", 1.9), ("REFURBISHED", 1.8)):
                await tech.ok("POST", f"/units/{t['unit_id']}/events",
                              json={"event_type": kind, "occurred_at": ago(at), "facility_id": tech.facility_id})
            targets.append(t)
        await collector.ok("POST", f"/units/{donor['unit_id']}/events",
                           json={"event_type": "COLLECTED", "occurred_at": ago(1.5), "facility_id": collector.facility_id})
        await collector.ok("POST", f"/units/{donor['unit_id']}/dismantle", json={
            "parts": [{"model_id": battery_model["model_id"], "serial_no": part["serial"]}],
            "occurred_at": ago(1.4), "facility_id": collector.facility_id})
        await t1.ok("POST", f"/units/{part['unit_id']}/tests", json={
            "occurred_at": ago(1.0), "facility_id": t1.facility_id,
            "tests": [{"test_type": "BATTERY_SOH", "result": "PASS", "measured_value": 90, "health_score": 90}]})
        results = await asyncio.gather(*[
            tech.call("POST", f"/units/{part['unit_id']}/reinstall",
                      json={"new_parent_unit_id": target["unit_id"], "occurred_at": ago(0.5), "facility_id": tech.facility_id})
            for tech, target in zip((t1, t2), targets, strict=True)])
        codes = sorted((r.status_code, r.json().get("error", {}).get("code", "OK")) for r in results)
        outcomes[str(codes)] += 1
    return outcomes


async def nfr4(http: httpx.AsyncClient, attempts: int, units: int) -> Counter[str]:
    producer, collector, recycler = [await Actor(http, e).login() for e in (
        "producer01@example.com", "collector01@example.com", "recycler01@example.com")]
    device_model = await model_of(producer, "DEVICE", producer.org_id)
    made = [await make_unit(producer, device_model["model_id"], "R4", i) for i in range(units)]
    for u in made:
        await collector.ok("POST", f"/units/{u['unit_id']}/events",
                           json={"event_type": "COLLECTED", "occurred_at": ago(2), "facility_id": collector.facility_id})
    manifest = await collector.ok("POST", "/transfers", json={
        "manifest_no": f"MF-R4-{RUN}", "to_org_id": recycler.org_id, "shipped_at": ago(1.9), "total_mass_kg": 5,
        "items": [{"unit_id": u["unit_id"], "declared_condition": "SCRAP"} for u in made]})
    await recycler.ok("POST", f"/transfers/{manifest['transfer_id']}/receive", json={"received_at": ago(1.5)})
    for u in made:
        await recycler.ok("POST", f"/units/{u['unit_id']}/events",
                          json={"event_type": "RECYCLED", "occurred_at": ago(1.0), "facility_id": recycler.facility_id})
    body = lambda i: {"cert_no": f"RC-R4-{RUN}-{i:02d}", "category": "ITEW2", "quantity_kg": 3.0,
                      "financial_year": "2026-27", "issued_on": datetime.now(UTC).date().isoformat(),
                      "units": [{"unit_id": u["unit_id"], "recovered_mass_g": 1000} for u in made]}
    results = await asyncio.gather(*[recycler.call("POST", "/certificates", json=body(i)) for i in range(attempts)])
    return Counter(f"{r.status_code} {r.json().get('error', {}).get('code', 'ISSUED')}" for r in results)


async def main() -> int:
    async with httpx.AsyncClient(timeout=120) as http:
        t0 = time.time()
        o3 = await nfr3(http, 10)
        print("NFR-3: 10 rounds, two technicians reinstall the same part at the same moment")
        for outcome, n in sorted(o3.items()):
            print(f"  {n} rounds -> {outcome}")
        o4 = await nfr4(http, 20, 5)
        print("NFR-4: 20 parallel certificate requests over the same 5 recycled units (SERIALIZABLE)")
        for outcome, n in sorted(o4.items()):
            print(f"  {n} x {outcome}")
        good3 = set(o3) == {"[(201, 'OK'), (409, 'ASM_OVERLAP')]"}
        good4 = o4.get("201 ISSUED") == 1 and sum(o4.values()) == 20
        print(f"elapsed {time.time() - t0:.1f}s; NFR-3 {'met' if good3 else 'NOT met'}; NFR-4 {'met' if good4 else 'NOT met'}")
        return 0 if good3 and good4 else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
