"""T3.6: the public passport: exact field set, no staff data, rate limit, cache, database role."""
from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Any

import httpx
import pytest
import pytest_asyncio

from app.allowlist import PUBLIC_DB_ROLE
from app.db import Database
from app.errors import ApiException
from app.schemas import PublicPassport
from tests.conftest import Demo


@pytest_asyncio.fixture
async def http(app: Any) -> AsyncIterator[httpx.AsyncClient]:
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t") as client:
        yield client


async def test_public_json_keys_equal_the_public_passport_keys(http: httpx.AsyncClient, demo: Demo) -> None:
    resp = await http.get(f"/api/v1/public/p/{demo.passport_uid}")     # no Authorization header
    assert resp.status_code == 200
    body = resp.json()
    assert set(body) == set(PublicPassport.model_fields)
    assert "unit_id" not in body
    assert body["latest_health"] == 86 and body["chain_verified"] is True
    assert [h["type"] for h in body["history"]] == ["MANUFACTURED", "COLLECTED", "DIAGNOSED"]
    assert all(set(h) == {"type", "date"} for h in body["history"])


async def test_unknown_and_malformed_ids(http: httpx.AsyncClient) -> None:
    missing = await http.get("/api/v1/public/p/6f1d6a52-3c5f-4a54-8f4e-2f5b3a6c9d10")
    assert (missing.status_code, missing.json()["error"]["code"]) == (404, "NOT_FOUND")
    assert (await http.get("/api/v1/public/p/not-a-uuid")).status_code == 400


async def test_thirty_first_request_in_a_minute_is_rejected(http: httpx.AsyncClient, demo: Demo) -> None:
    codes = [(await http.get(f"/api/v1/public/p/{demo.passport_uid}")).status_code for _ in range(31)]
    assert codes[:30] == [200] * 30
    assert codes[30] == 429


async def test_responses_are_cached_for_a_minute(http: httpx.AsyncClient, database: Database, demo: Demo,
                                                 monkeypatch: pytest.MonkeyPatch) -> None:
    calls = 0
    real = database.query

    async def counting(*args: Any, **kwargs: Any) -> Any:
        nonlocal calls
        calls += 1
        return await real(*args, **kwargs)

    monkeypatch.setattr(database, "query", counting)
    for _ in range(3):
        assert (await http.get(f"/api/v1/public/p/{demo.passport_uid}")).status_code == 200
    assert calls == 1


async def test_public_reader_cannot_read_base_tables(database: Database) -> None:
    with pytest.raises(ApiException) as exc:
        await database.query(None, "SELECT count(*) FROM unit", db_role=PUBLIC_DB_ROLE)
    assert exc.value.code == "FORBIDDEN"
    rows = await database.query(None, "SELECT count(*) AS n FROM v_public_passport", db_role=PUBLIC_DB_ROLE)
    assert rows[0]["n"] >= 2
