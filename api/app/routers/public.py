"""The public passport (FR-11): no login, `public_reader` only, v_public_passport only, rate limited and cached."""
from __future__ import annotations

import time
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Request
from slowapi import Limiter

from app.allowlist import PUBLIC_DB_ROLE
from app.db import Database
from app.errors import ApiException
from app.schemas import PublicPassport

CACHE_SECONDS = 60


def build_router(db: Database, limiter: Limiter, rate_limit: str) -> APIRouter:
    router = APIRouter(tags=["public"])
    cache: dict[UUID, tuple[float, dict[str, Any]]] = {}

    @router.get("/public/p/{passport_uid}", response_model=PublicPassport)
    @limiter.limit(rate_limit)
    async def public_passport(request: Request, passport_uid: UUID) -> dict[str, Any]:
        hit = cache.get(passport_uid)
        if hit and hit[0] > time.monotonic():
            return hit[1]
        rows = await db.query(
            None,
            """SELECT passport_uid::text AS passport_uid, model_number, category, manufacturer,
                      manufactured_on::text AS manufactured_on, current_state,
                      COALESCE(history, '[]'::jsonb) AS history, latest_health, chain_verified
                 FROM v_public_passport WHERE passport_uid = %s""",
            [passport_uid], db_role=PUBLIC_DB_ROLE)
        if not rows:
            raise ApiException(404, "NOT_FOUND", "Passport was not found")
        data = PublicPassport.model_validate(rows[0]).model_dump()
        cache[passport_uid] = (time.monotonic() + CACHE_SECONDS, data)
        return data

    return router
