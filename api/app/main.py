from __future__ import annotations

import asyncio
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager, suppress
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from slowapi import Limiter
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address

from app.allowlist import PUBLIC_DB_ROLE
from app.auth import AuthState
from app.config import Settings
from app.db import Claims, Database
from app.errors import ApiException
from app.routers import admin, catalogue, certificates, public, reports, transfers, units
from app.routers import auth as auth_router

API_PREFIX = "/api/v1"
REFRESH_INTERVAL_SECONDS = 24 * 3600
log = logging.getLogger("recircuit.refresh")


async def refresh_material_recovery_daily(db: Database) -> None:
    """Nightly refresh of mv_material_recovery (TRD section 11). The API never holds rc_owner credentials: the
    refresh runs as rc_admin through sp_refresh_material_recovery."""
    system = Claims(actor_id=0, org_id=0, role="ADMIN")
    while True:
        try:
            await db.run(system, "sp_refresh_material_recovery")
        except Exception:                                  # keep the timer alive whatever the cause
            log.exception("material recovery refresh failed")
        await asyncio.sleep(REFRESH_INTERVAL_SECONDS)


def create_app(settings: Settings | None = None, database: Database | None = None) -> FastAPI:
    settings = settings or Settings.from_env()
    db = database or Database(settings.database_url, settings.serializable_retries)

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        await db.open()
        refresher = asyncio.create_task(refresh_material_recovery_daily(db))
        try:
            yield
        finally:
            refresher.cancel()
            with suppress(asyncio.CancelledError):
                await refresher
            await db.close()

    app = FastAPI(title="ReCircuit API", version="1.0", lifespan=lifespan)
    app.state.settings = settings
    app.state.db = db
    app.state.auth = AuthState(settings)
    limiter = Limiter(key_func=get_remote_address)
    app.state.limiter = limiter
    app.include_router(auth_router.router, prefix=API_PREFIX)
    for r in (catalogue.router, units.router, units.inventory, transfers.router, certificates.router,
              reports.router, admin.router, public.build_router(db, limiter, settings.public_rate_limit)):
        app.include_router(r, prefix=API_PREFIX)

    @app.exception_handler(ApiException)
    async def api_exception_handler(_: Request, exc: ApiException) -> JSONResponse:
        return JSONResponse(status_code=exc.status, content=exc.body())

    @app.exception_handler(RateLimitExceeded)
    async def rate_limit_handler(_: Request, __: RateLimitExceeded) -> JSONResponse:
        return JSONResponse(status_code=429,
                            content=ApiException(429, "RATE_LIMITED", "Too many requests; please slow down").body())

    @app.exception_handler(RequestValidationError)
    async def validation_handler(_: Request, exc: RequestValidationError) -> JSONResponse:
        first = exc.errors()[0] if exc.errors() else {}
        where = ".".join(str(p) for p in first.get("loc", []) if p != "body")
        message = f"{where}: {first.get('msg', 'invalid request')}" if where else "invalid request"
        return JSONResponse(status_code=400, content=ApiException(400, "INVALID_VALUE", message).body())

    @app.get(f"{API_PREFIX}/health")
    async def health() -> dict[str, Any]:
        rows = await db.query(None, "SELECT version() AS version", db_role=PUBLIC_DB_ROLE)
        return {"status": "ok", "database": rows[0]["version"]}

    return app
