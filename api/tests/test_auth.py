"""T3.3: login, lockout, refresh rotation, deactivation and role guards."""
from __future__ import annotations

import itertools
import time
from collections.abc import Iterator
from typing import Any

import httpx
import jwt
import psycopg
import pytest
from fastapi import Depends

from app.auth import AuthState, require_roles
from app.db import Claims
from tests.conftest import Pg, World

PASSWORD = "correct horse battery"
_counter = itertools.count(1)


class Clock:
    def __init__(self) -> None:
        self.now = time.time()

    def __call__(self) -> float:
        return self.now


@pytest.fixture
def clock() -> Clock:
    return Clock()


@pytest.fixture
def state(app: Any, settings: Any, clock: Clock) -> AuthState:
    st = AuthState(settings, clock)
    app.state.auth = st
    app.add_api_route("/_t/tech-only", _tech_only, methods=["GET"])
    return st


async def _tech_only(claims: Claims = Depends(require_roles("TECHNICIAN"))) -> dict[str, int]:
    return {"actor_id": claims.actor_id}


@pytest.fixture
def client(app: Any, state: AuthState) -> Iterator[httpx.AsyncClient]:
    yield httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t")


def make_actor(pg: Pg, world: World, state: AuthState, role: str = "TECHNICIAN", active: bool = True) -> str:
    email = f"user{next(_counter)}@example.com"
    facility = world.fac_t if role != "PRODUCER" else world.fac_p
    with psycopg.connect(pg.url("rc_owner"), autocommit=True) as conn:
        row = conn.execute("SELECT sp_admin_create_actor(%s,'Demo User',%s,%s,%s)",
                           (facility, role, email, state.hash_password(PASSWORD))).fetchone()
        assert row is not None
        if not active:
            with conn.transaction():
                conn.execute("SELECT set_config('rc.actor_id', %s, true)", (str(row[0]),))
                conn.execute("CALL sp_admin_set_actor_active(%s, false)", (row[0],))
    return email


async def login(client: httpx.AsyncClient, email: str, password: str = PASSWORD) -> httpx.Response:
    return await client.post("/api/v1/auth/login", json={"email": email, "password": password})


async def test_good_login_issues_access_token_and_httponly_refresh_cookie(
        client: httpx.AsyncClient, pg: Pg, world: World, state: AuthState) -> None:
    email = make_actor(pg, world, state)
    resp = await login(client, email)
    assert resp.status_code == 200
    body = resp.json()
    claims = jwt.decode(body["access_token"], state.settings.jwt_secret, algorithms=["HS256"],
                        options={"verify_exp": False})
    assert (claims["role"], claims["org_id"]) == ("TECHNICIAN", world.org_t)
    assert body["expires_in"] == 15 * 60
    cookie = resp.headers["set-cookie"]
    assert "rc_refresh=" in cookie and "HttpOnly" in cookie
    assert PASSWORD not in resp.text


async def test_wrong_password_and_unknown_email_give_the_same_401(
        client: httpx.AsyncClient, pg: Pg, world: World, state: AuthState) -> None:
    email = make_actor(pg, world, state)
    bad = await login(client, email, "nope")
    unknown = await login(client, "nobody@example.com")
    assert bad.status_code == unknown.status_code == 401
    assert bad.json() == unknown.json()
    assert bad.json()["error"]["code"] == "INVALID_CREDENTIALS"


async def test_account_locks_after_five_failures_and_unlocks_later(
        client: httpx.AsyncClient, pg: Pg, world: World, state: AuthState, clock: Clock) -> None:
    email = make_actor(pg, world, state)
    for _ in range(5):
        assert (await login(client, email, "wrong")).status_code == 401
    assert (await login(client, email)).status_code == 401           # the 6th attempt: locked, even if correct
    clock.now += 15 * 60 + 1
    assert (await login(client, email)).status_code == 200


async def test_refresh_token_is_single_use_and_rotates(
        client: httpx.AsyncClient, pg: Pg, world: World, state: AuthState) -> None:
    email = make_actor(pg, world, state)
    first = (await login(client, email)).cookies["rc_refresh"]
    assert first not in state._refresh                                  # only a digest is stored
    resp = await client.post("/api/v1/auth/refresh", cookies={"rc_refresh": first})
    assert resp.status_code == 200
    second = resp.cookies["rc_refresh"]
    assert second != first
    old = await client.post("/api/v1/auth/refresh", cookies={"rc_refresh": first})
    assert old.status_code == 401
    assert (await client.post("/api/v1/auth/refresh", cookies={"rc_refresh": second})).status_code == 200


async def test_deactivated_actor_cannot_log_in_or_refresh(
        client: httpx.AsyncClient, pg: Pg, world: World, state: AuthState) -> None:
    gone = make_actor(pg, world, state, active=False)
    assert (await login(client, gone)).status_code == 401
    email = make_actor(pg, world, state)
    token = (await login(client, email)).cookies["rc_refresh"]
    with psycopg.connect(pg.url("rc_owner"), autocommit=True) as conn:
        conn.execute("UPDATE actor SET is_active = false WHERE email = %s", (email,))
    assert (await client.post("/api/v1/auth/refresh", cookies={"rc_refresh": token})).status_code == 401


async def test_logout_revokes_the_refresh_token(
        client: httpx.AsyncClient, pg: Pg, world: World, state: AuthState) -> None:
    email = make_actor(pg, world, state)
    token = (await login(client, email)).cookies["rc_refresh"]
    assert (await client.post("/api/v1/auth/logout", cookies={"rc_refresh": token})).status_code == 204
    assert (await client.post("/api/v1/auth/refresh", cookies={"rc_refresh": token})).status_code == 401


async def test_role_guard_and_token_expiry(
        client: httpx.AsyncClient, pg: Pg, world: World, state: AuthState, clock: Clock) -> None:
    tech = (await login(client, make_actor(pg, world, state))).json()["access_token"]
    prod = (await login(client, make_actor(pg, world, state, "PRODUCER"))).json()["access_token"]
    assert (await client.get("/_t/tech-only")).status_code == 401
    assert (await client.get("/_t/tech-only", headers={"Authorization": f"Bearer {prod}"})).status_code == 403
    assert (await client.get("/_t/tech-only", headers={"Authorization": f"Bearer {tech}"})).status_code == 200
    clock.now += 16 * 60
    expired = await client.get("/_t/tech-only", headers={"Authorization": f"Bearer {tech}"})
    assert expired.status_code == 401
    assert (await client.get("/_t/tech-only", headers={"Authorization": "Bearer garbage"})).status_code == 401
