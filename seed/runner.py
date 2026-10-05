"""Worker side of the seed: runs chunks of scenarios, each scenario in its own transaction. Lives in its own
module (not __main__) so that spawned worker processes can import it."""
from __future__ import annotations

import random

import psycopg

from seed.profiles import Profile
from seed.scenario import Scenario
from seed.world import World

_WORLD: World | None = None
_PROFILE: Profile | None = None
_DSN = ""
_SEED = 0


def init_worker(world: World, profile: Profile, dsn: str, seed: int) -> None:
    global _WORLD, _PROFILE, _DSN, _SEED
    _WORLD, _PROFILE, _DSN, _SEED = world, profile, dsn, seed


def run_chunk(chunk: int) -> dict[str, int]:
    """Run one chunk of scenarios. The content of a scenario depends only on (seed, scenario id)."""
    assert _WORLD is not None and _PROFILE is not None
    totals = {"units": 0, "gap_units": 0, "missing": 0}
    first = chunk * _PROFILE.chunk_size
    last = min(first + _PROFILE.chunk_size, _PROFILE.scenarios)
    with psycopg.connect(_DSN, autocommit=True) as conn:
        for sid in range(first, last):
            rng = random.Random(f"{_SEED}:scenario:{sid}")
            with conn.transaction(), conn.cursor() as cur:
                stats = Scenario(cur, _WORLD, _PROFILE, rng, sid).run()
            for k, v in stats.items():
                totals[k] += v
    return totals
