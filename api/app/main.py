from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from app.allowlist import PUBLIC_DB_ROLE
from app.config import Settings
from app.db import Database
from app.errors import ApiException

API_PREFIX = "/api/v1"


def create_app(settings: Settings | None = None, database: Database | None = None) -> FastAPI:
    settings = settings or Settings.from_env()
    db = database or Database(settings.database_url, settings.serializable_retries)

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        await db.open()
        try:
            yield
        finally:
            await db.close()

    app = FastAPI(title="ReCircuit API", version="1.0", lifespan=lifespan)
    app.state.settings = settings
    app.state.db = db

    @app.exception_handler(ApiException)
    async def api_exception_handler(_: Request, exc: ApiException) -> JSONResponse:
        return JSONResponse(status_code=exc.status, content=exc.body())

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
