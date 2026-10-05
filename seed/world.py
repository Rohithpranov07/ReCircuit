"""The static part of a synthetic world: organisations, people, catalogue. Everything is created through
the section B.3 routines, except the `material` reference rows (no routine exists for them)."""
from __future__ import annotations

import random
from dataclasses import dataclass, field
from typing import Any

from faker import Faker
from psycopg.types.json import Jsonb

from seed.db import call, set_context
from seed.profiles import Profile

DEMO_PASSWORD = "recircuit-demo"   # fictional demo login shared by every seeded account

ORG_ROLE = {"PRODUCER": "PRODUCER", "COLLECTOR": "COLLECTOR", "DISMANTLER": "COLLECTOR",
            "REFURBISHER": "TECHNICIAN", "RECYCLER": "RECYCLER_OPERATOR"}
ORG_LABEL = {"PRODUCER": "Producer", "COLLECTOR": "Collector", "DISMANTLER": "Dismantler",
             "REFURBISHER": "Refurbisher", "RECYCLER": "Recycler"}

# (name, is_critical, is_hazardous)
MATERIALS = [("Aluminium", False, False), ("Copper", False, False), ("Gold", False, False),
             ("Silver", False, False), ("Tin", False, False), ("Lead", False, True),
             ("Cobalt", True, False), ("Lithium", True, False), ("Indium", True, False),
             ("Palladium", True, False)]

CATEGORY_MATERIALS = {
    "DEVICE": ["Aluminium", "Copper"], "BATTERY": ["Cobalt", "Lithium", "Copper", "Aluminium"],
    "BOARD": ["Copper", "Gold", "Silver", "Tin", "Palladium", "Lead"],
    "STORAGE": ["Copper", "Gold", "Aluminium"], "MEMORY": ["Copper", "Gold"],
    "DISPLAY": ["Indium", "Aluminium"], "CHIP": ["Gold", "Copper", "Silver"], "OTHER": ["Aluminium"],
}
CATEGORY_MASS_G = {"DEVICE": (800, 2600), "BATTERY": (120, 450), "BOARD": (90, 260), "STORAGE": (8, 60),
                   "MEMORY": (6, 30), "DISPLAY": (150, 700), "CHIP": (1, 12), "OTHER": (5, 80)}
# every producer gets all eight categories first, then this pattern repeats
CATEGORY_PATTERN = ["DEVICE", "BATTERY", "STORAGE", "MEMORY", "DISPLAY", "BOARD", "CHIP", "OTHER",
                    "DEVICE", "BATTERY", "STORAGE", "BOARD", "BATTERY", "STORAGE", "MEMORY", "BOARD",
                    "DISPLAY", "DEVICE", "CHIP", "BATTERY"]


@dataclass
class ModelInfo:
    model_id: int
    category: str
    mass_g: float


@dataclass
class OrgInfo:
    org_id: int
    org_type: str
    name: str
    facility_ids: list[int]
    actor_id: int
    role: str
    email: str
    models: dict[str, list[ModelInfo]] = field(default_factory=dict)   # producers only

    def facility(self, rng: random.Random) -> int:
        return self.facility_ids[0] if len(self.facility_ids) == 1 else rng.choice(self.facility_ids)


@dataclass
class World:
    producers: list[OrgInfo]
    collectors: list[OrgInfo]      # collectors and dismantlers
    refurbishers: list[OrgInfo]
    recyclers: list[OrgInfo]
    auditor: OrgInfo
    admin: OrgInfo
    logins: list[tuple[str, str]]  # (email, role)


def _spec(category: str, rng: random.Random) -> dict[str, Any]:
    if category == "DEVICE":
        return {"form_factor": rng.choice(["laptop", "phone", "tablet"]), "release_year": rng.randint(2017, 2024),
                "screen_in": rng.choice([6.1, 11.0, 13.3, 14.0, 15.6])}
    if category == "BATTERY":
        return {"chemistry": rng.choice(["Li-ion", "Li-Po"]), "capacity_mAh": rng.choice([3000, 4000, 4900, 5000, 6500]),
                "nominal_V": rng.choice([3.7, 7.6, 11.4]), "cycle_rating": rng.choice([500, 800, 1000])}
    if category == "STORAGE":
        return {"interface": rng.choice(["NVMe", "SATA"]), "capacity_GB": rng.choice([128, 256, 512, 1024])}
    if category == "MEMORY":
        return {"type": rng.choice(["DDR4", "LPDDR5"]), "capacity_GB": rng.choice([4, 8, 16]),
                "speed_MTs": rng.choice([3200, 4800, 5600])}
    if category == "DISPLAY":
        return {"panel": rng.choice(["IPS", "OLED"]), "size_in": rng.choice([6.1, 13.3, 15.6]),
                "resolution": rng.choice(["1920x1080", "2560x1600"])}
    if category == "BOARD":
        return {"board_rev": rng.choice(["A", "B", "C", "D"])}
    if category == "CHIP":
        return {"function": rng.choice(["SoC", "PMIC", "Modem"]), "package": rng.choice(["BGA", "QFN"])}
    return {}


def build_world(conn: Any, profile: Profile, rng: random.Random, password_hash: str, seed: int) -> World:
    """Create the whole static world in one transaction. Deterministic for a given (profile, seed)."""
    fake = Faker("en_IN")
    Faker.seed(seed)
    with conn.transaction(), conn.cursor() as cur:
        for name, critical, hazardous in MATERIALS:
            cur.execute("INSERT INTO material (material_name, is_critical, is_hazardous) VALUES (%s,%s,%s) "
                        "ON CONFLICT (material_name) DO NOTHING", (name, critical, hazardous))
        cur.execute("SELECT material_name, material_id FROM material")
        material_id = {n: i for n, i in cur.fetchall()}

        orgs: dict[str, list[OrgInfo]] = {t: [] for t in profile.org_counts}
        gst_n = 0
        first_admin_set = False
        admin: OrgInfo | None = None
        auditor: OrgInfo | None = None
        logins: list[tuple[str, str]] = []

        def make_actor(org: OrgInfo, facility_id: int, role: str, email: str) -> int:
            return int(call(cur, "sp_admin_create_actor", facility_id, fake.name(), role, email, password_hash))

        for org_type, count in profile.org_counts.items():
            for n in range(1, count + 1):
                gst_n += 1
                name = f"Demo {ORG_LABEL[org_type]} {n:02d}"
                org_id = call(cur, "sp_admin_create_org", name, org_type, f"DEMO-CPCB-{gst_n:05d}",
                              f"27DM{gst_n:05d}A1Z{gst_n % 10}{chr(65 + gst_n % 26)}{chr(65 + (gst_n // 26) % 26)}")
                facilities = [call(cur, "sp_admin_create_facility", org_id, f"{name} Site {k}",
                                   str(rng.randint(100001, 999999)), rng.choice([None, 600, 1200, 2400]))
                              for k in range(1, profile.facilities_per_org + 1)]
                email = f"{org_type.lower()}{n:02d}@example.com"
                role = ORG_ROLE[org_type]
                info = OrgInfo(org_id, org_type, name, facilities, 0, role, email)
                if not first_admin_set:
                    # bootstrap: the first administrator is created without an acting user; from here on
                    # every admin routine runs as that administrator and is audited
                    adm_id = make_actor(info, facilities[0], "ADMIN", "admin@example.com")
                    set_context(cur, org_id, adm_id, "ADMIN")
                    admin = OrgInfo(org_id, org_type, name, facilities, adm_id, "ADMIN", "admin@example.com")
                    aud_id = make_actor(info, facilities[0], "AUDITOR", "auditor@example.com")
                    auditor = OrgInfo(org_id, org_type, name, facilities, aud_id, "AUDITOR", "auditor@example.com")
                    logins += [("admin@example.com", "ADMIN"), ("auditor@example.com", "AUDITOR")]
                    first_admin_set = True
                info.actor_id = make_actor(info, facilities[0], role, email)
                logins.append((email, role))
                orgs[org_type].append(info)

        # catalogue: every producer owns a share of the models, each with a spec and material composition
        producers = orgs["PRODUCER"]
        for p, producer in enumerate(producers):
            set_context(cur, producer.org_id, producer.actor_id, "PRODUCER")
            n_models = profile.models // len(producers) + (1 if p < profile.models % len(producers) else 0)
            for i in range(n_models):
                category = CATEGORY_PATTERN[i % len(CATEGORY_PATTERN)]
                lo, hi = CATEGORY_MASS_G[category]
                mass_g = round(rng.uniform(lo, hi), 2)
                number = f"P{p + 1:02d}-{category[:3]}-{i + 1:03d}"
                model_id = call(cur, "sp_register_model", number, category, mass_g, Jsonb(_spec(category, rng)))
                names = CATEGORY_MATERIALS[category]
                chosen = rng.sample(names, rng.randint(1, len(names)))
                budget = mass_g * 1000 * 0.6
                weights = [rng.random() + 0.1 for _ in chosen]
                comp = [{"material_id": material_id[m], "mass_mg": round(budget * w / sum(weights), 3)}
                        for m, w in zip(chosen, weights)]
                call(cur, "sp_set_materials", model_id, Jsonb(comp))
                producer.models.setdefault(category, []).append(ModelInfo(model_id, category, mass_g))

    assert admin is not None and auditor is not None
    return World(producers=producers,
                 collectors=orgs.get("COLLECTOR", []) + orgs.get("DISMANTLER", []),
                 refurbishers=orgs["REFURBISHER"], recyclers=orgs["RECYCLER"],
                 auditor=auditor, admin=admin, logins=logins)
