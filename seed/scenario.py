"""One simulated device lifecycle: manufacture -> sale -> collection -> dismantling -> refurbishment,
reinstallation, recycling or disposal, with custody manifests at every hand-over. Every write goes through
the section B.3 routines, every timestamp is in the past and non-decreasing per unit."""
from __future__ import annotations

import random
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any

from psycopg.types.json import Jsonb

from seed.db import call, set_context
from seed.profiles import Profile
from seed.world import ModelInfo, OrgInfo, World

UTC = timezone.utc
COLLECT_FROM = datetime(2025, 1, 1, tzinfo=UTC)
COLLECT_TO = datetime(2026, 6, 30, tzinfo=UTC)
CUTOFF = datetime(2026, 9, 30, tzinfo=UTC)          # nothing is ever dated after this (events must be past)

PART_CATEGORIES = ["BATTERY", "STORAGE", "MEMORY", "DISPLAY", "BOARD", "CHIP"]
TEST_TYPES = {"BATTERY": "BATTERY_SOH", "STORAGE": "SMART_HEALTH", "MEMORY": "MEMTEST",
              "DISPLAY": "DISPLAY_DEAD_PIXELS", "BOARD": "BOARD_POST", "CHIP": "CHIP_FUNCTION"}
CERT_CATEGORIES = ["ITEW1", "ITEW2", "CEEW1", "CEEW2"]


@dataclass
class Unit:
    unit_id: int
    model: ModelInfo
    serial: str
    alive: bool = True        # False once flagged missing at a receipt: its story stops there
    health: int | None = None


class Scenario:
    def __init__(self, cur: Any, world: World, profile: Profile, rng: random.Random, sid: int) -> None:
        self.cur, self.w, self.p, self.rng, self.tag = cur, world, profile, rng, f"{sid:07d}"
        self.manifests = 0
        self.stats = {"units": 0, "gap_units": 0, "missing": 0}

    # -- small helpers ------------------------------------------------------------------------------
    def ts(self, t: datetime) -> datetime:
        if t > CUTOFF:
            raise AssertionError(f"scenario {self.tag} produced a timestamp after the cutoff: {t}")
        return t

    def act(self, org: OrgInfo) -> None:
        set_context(self.cur, org.org_id, org.actor_id, org.role)

    def new_unit(self, model: ModelInfo, label: str, made_on: datetime) -> Unit:
        uid = call(self.cur, "sp_create_unit", model.model_id, f"{label}-{self.tag}", made_on.date(), None)
        self.stats["units"] += 1
        return Unit(uid, model, f"{label}-{self.tag}")

    def event(self, unit: Unit, kind: str, at: datetime, fac: int) -> None:
        call(self.cur, "sp_record_event", unit.unit_id, kind, self.ts(at), fac, None)

    def ship(self, sender: OrgInfo, receiver: OrgInfo, units: list[Unit], shipped: datetime,
             received: datetime, lose_from: list[Unit] | None = None) -> None:
        """Create a manifest as the sender and confirm it as the receiver. Optionally one unit goes missing."""
        if not units:
            return
        self.manifests += 1
        mass = round(max(sum(u.model.mass_g for u in units) / 1000, 0.001), 3)
        self.act(sender)
        items = [{"unit_id": u.unit_id, "declared_condition": self.rng.choice(["WORKING", "FAULTY", "SCRAP"])}
                 for u in units]
        transfer = call(self.cur, "sp_create_transfer", f"MF-{self.tag}-{self.manifests}", receiver.org_id,
                        self.ts(shipped), mass, Jsonb(items))
        missing: list[int] = []
        if lose_from and len(units) >= 2 and self.rng.random() < 0.05:
            lost = self.rng.choice(lose_from)
            lost.alive = False
            missing.append(lost.unit_id)
            self.stats["missing"] += 1
        self.act(receiver)
        call(self.cur, "sp_receive_transfer", transfer, self.ts(received), missing, [])

    def tests(self, unit: Unit, at: datetime, fac: int, health: int) -> None:
        kind = TEST_TYPES.get(unit.model.category, "FUNCTION_CHECK")
        result = "PASS" if health >= 70 else ("DEGRADED" if health >= 40 else "FAIL")
        call(self.cur, "sp_record_tests", unit.unit_id, self.ts(at), fac,
             Jsonb([{"test_type": kind, "result": result, "measured_value": health, "health_score": health}]))
        unit.health = health

    # -- the lifecycle -------------------------------------------------------------------------------
    def run(self) -> dict[str, int]:
        rng, w = self.rng, self.w
        prod, coll = rng.choice(w.producers), rng.choice(w.collectors)
        ref, rec = rng.choice(w.refurbishers), rng.choice(w.recyclers)
        prod_fac, coll_fac, ref_fac, rec_fac = (prod.facility(rng), coll.facility(rng),
                                                ref.facility(rng), rec.facility(rng))

        tc = COLLECT_FROM + timedelta(seconds=rng.randrange(int((COLLECT_TO - COLLECT_FROM).total_seconds())))
        t_man = tc - timedelta(days=rng.randint(400, 1500), seconds=rng.randrange(86400))
        t_sold = t_man + timedelta(days=rng.randint(10, 200), seconds=rng.randrange(86400))
        whole = rng.random() < 0.10
        part_cats = [] if whole else rng.sample(PART_CATEGORIES, rng.randint(3, 5))
        need_d2 = (not whole) and rng.random() < 0.45

        # --- producer: manufacture and sell
        self.act(prod)
        dev = self.new_unit(rng.choice(prod.models["DEVICE"]), "DEV", t_man)
        parts = [self.new_unit(rng.choice(prod.models[c]), c[:3], t_man) for c in part_cats]
        d2 = self.new_unit(rng.choice(prod.models["DEVICE"]), "DV2", t_man) if need_d2 else None
        everyone = [dev, *parts] + ([d2] if d2 else [])
        for u in everyone:
            self.event(u, "MANUFACTURED", t_man, prod_fac)
        self.event(dev, "SOLD", t_sold, prod_fac)
        if d2:
            self.event(d2, "SOLD", t_sold, prod_fac)

        # --- producer hands everything to the collector
        shipped = tc - timedelta(days=rng.randint(5, 20))
        self.ship(prod, coll, everyone, shipped, shipped + timedelta(hours=rng.randint(24, 72)),
                  lose_from=[*parts, *([d2] if d2 else [])])

        # --- collector: collect, dismantle
        self.act(coll)
        self.event(dev, "COLLECTED", tc, coll_fac)
        if d2 and d2.alive:
            self.event(d2, "COLLECTED", tc + timedelta(minutes=5), coll_fac)
        t_dis = tc + timedelta(minutes=10)
        # the collector's first diagnosis of the device (a shell that is later recycled)
        t_dev = tc + timedelta(minutes=30)
        for _ in range(rng.randint(1, 3)):
            self.tests(dev, t_dev, coll_fac, rng.randint(5, 90))
            t_dev += timedelta(minutes=rng.randint(10, 90))
        live_parts = [u for u in parts if u.alive]
        if live_parts:
            rows = [{"model_id": u.model.model_id, "serial_no": u.serial} for u in live_parts]
            call(self.cur, "sp_dismantle", dev.unit_id, Jsonb(rows), self.ts(t_dis), coll_fac)

        # --- decide each harvested part's path
        to_recycle: list[Unit] = [dev] if dev.alive else []
        to_refurb: list[Unit] = []
        for u in live_parts:
            roll = rng.random()
            if roll < 0.55:
                to_refurb.append(u)
                continue
            # parts that are not refurbished are still diagnosed once or twice before they leave
            t_u = t_dis + timedelta(minutes=20)
            for _ in range(rng.randint(1, 2)):
                self.tests(u, t_u, coll_fac, rng.randint(0, 60))
                t_u += timedelta(minutes=rng.randint(10, 60))
            if roll < 0.90:
                to_recycle.append(u)
            else:
                self.event(u, "DISPOSED", t_u + timedelta(hours=1), coll_fac)

        # --- refurbisher: test, reinstall, loose or onward to the recycler
        after_ref_recycle: list[Unit] = []
        ready_at = t_dis
        if to_refurb or (d2 and d2.alive):
            batch = to_refurb + ([d2] if d2 and d2.alive else [])
            t_ship = t_dis + timedelta(days=rng.randint(1, 3))
            t_rcv = t_ship + timedelta(days=rng.randint(1, 3))
            self.ship(coll, ref, batch, t_ship, t_rcv)
            self.act(ref)
            clock = t_rcv + timedelta(hours=1)
            refurbished_d2 = False
            if d2 and d2.alive:
                self.event(d2, "DIAGNOSED", clock, ref_fac)
                clock += timedelta(hours=rng.randint(1, 20))
                self.event(d2, "REFURBISHED", clock, ref_fac)
                refurbished_d2 = True
            lo, hi = self.p.retests
            for u in [x for x in to_refurb if x.alive]:
                t = clock + timedelta(hours=rng.randint(1, 30))
                health = rng.choice([rng.randint(20, 69), rng.randint(70, 98), rng.randint(70, 98)])
                self.tests(u, t, ref_fac, health)
                for _ in range(rng.randint(lo, hi)):
                    t += timedelta(hours=rng.randint(1, 36))
                    health = max(0, min(100, health + rng.randint(-6, 3)))
                    self.tests(u, t, ref_fac, health)
                t += timedelta(hours=rng.randint(1, 12))
                if health >= 70:
                    if refurbished_d2 and rng.random() < 0.5:
                        assert d2 is not None
                        call(self.cur, "sp_reinstall", u.unit_id, d2.unit_id, self.ts(t), ref_fac)
                        if rng.random() < 0.6:
                            self.event(u, "SOLD", t + timedelta(hours=2), ref_fac)
                    # else: stays loose stock (reuse inventory)
                elif rng.random() < 0.8:
                    after_ref_recycle.append(u)
                    ready_at = max(ready_at, t)
                else:
                    self.event(u, "DISPOSED", t, ref_fac)
            if refurbished_d2:
                assert d2 is not None
                self.event(d2, "SOLD", clock + timedelta(days=rng.randint(2, 6)), ref_fac)

        # --- recycler: whole devices, shells and low-value parts straight from the collector
        t_ship = t_dis + timedelta(days=rng.randint(1, 3))
        t_rcv = t_ship + timedelta(days=rng.randint(1, 3))
        gap = rng.random() < 0.03
        if to_recycle:
            if gap:
                self.stats["gap_units"] += len(to_recycle)      # deliberate custody gap: no manifest at all
                t_rcv = t_ship
            else:
                self.ship(coll, rec, to_recycle, t_ship, t_rcv)
            self.act(rec)
            for u in [x for x in to_recycle if x.alive]:
                self.event(u, "RECYCLED", t_rcv + timedelta(hours=rng.randint(1, 48)), rec_fac)
        # --- ... and parts that failed refurbishment go on from the refurbisher
        if after_ref_recycle:
            t_ship2 = ready_at + timedelta(days=rng.randint(1, 3))
            t_rcv2 = t_ship2 + timedelta(days=rng.randint(1, 3))
            self.ship(ref, rec, after_ref_recycle, t_ship2, t_rcv2)
            self.act(rec)
            for u in [x for x in after_ref_recycle if x.alive]:
                self.event(u, "RECYCLED", t_rcv2 + timedelta(hours=rng.randint(1, 48)), rec_fac)
        return self.stats
