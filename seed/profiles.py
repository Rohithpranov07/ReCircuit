"""Seed profiles (TRD section 13). Counts are targets: the unit and event totals land close to them."""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Profile:
    name: str
    org_counts: dict[str, int]      # organisation type -> how many
    facilities_per_org: int
    models: int                     # catalogue size across all producers
    scenarios: int                  # device lifecycles to simulate
    chunk_size: int                 # scenarios per work unit (independent of --jobs)
    retests: tuple[int, int]        # extra DIAGNOSED re-tests per refurbished part (inclusive)
    cert_batch: tuple[int, int]     # units per certificate (inclusive)


SMALL = Profile(
    name="small",
    org_counts={"PRODUCER": 2, "COLLECTOR": 2, "REFURBISHER": 2, "RECYCLER": 2},
    facilities_per_org=1,
    models=40,
    scenarios=97,
    chunk_size=20,
    retests=(3, 8),
    cert_batch=(8, 20),
)

LARGE = Profile(
    name="large",
    org_counts={"PRODUCER": 6, "COLLECTOR": 8, "DISMANTLER": 2, "REFURBISHER": 6, "RECYCLER": 8},
    facilities_per_org=2,
    models=400,
    scenarios=9950,
    chunk_size=50,
    retests=(9, 17),
    cert_batch=(25, 80),
)

PROFILES = {p.name: p for p in (SMALL, LARGE)}
