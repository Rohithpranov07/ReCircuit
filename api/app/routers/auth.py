from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Cookie, Depends, Request, Response

from app.allowlist import LOGIN_DB_ROLE
from app.auth import REFRESH_COOKIE, AuthState, auth_state, current_claims, invalid_credentials
from app.db import Claims, Database
from app.schemas import LoginRequest, TokenResponse

router = APIRouter(prefix="/auth", tags=["auth"])


def _db(request: Request) -> Database:
    db: Database = request.app.state.db
    return db


async def _lookup(db: Database, email: str) -> dict[str, Any] | None:
    rows = await db.run(None, "fn_auth_lookup", db_role=LOGIN_DB_ROLE, p_email=email)
    return rows[0] if rows else None


def _set_cookie(response: Response, state: AuthState, token: str) -> None:
    response.set_cookie(REFRESH_COOKIE, token, max_age=state.settings.jwt_refresh_ttl_days * 86400, httponly=True,
                        samesite="strict", path="/api/v1/auth")


@router.post("/login", response_model=TokenResponse)
async def login(body: LoginRequest, request: Request, response: Response,
                state: AuthState = Depends(auth_state)) -> TokenResponse:
    email = body.email.strip().lower()
    if state.is_locked(email):
        raise invalid_credentials()                     # a locked account looks like any other failure
    row = await _lookup(_db(request), body.email.strip())
    ok = state.verify_password(body.password, row["password_hash"] if row else None)
    if not (row and ok and row["is_active"]):
        state.record_failure(email)
        raise invalid_credentials()
    state.record_success(email)
    claims = Claims(row["actor_id"], row["org_id"], row["role"])
    token, ttl = state.issue_access_token(claims)
    _set_cookie(response, state, state.new_refresh_token(body.email.strip(), claims))
    return TokenResponse(access_token=token, expires_in=ttl)


@router.post("/refresh", response_model=TokenResponse)
async def refresh(request: Request, response: Response, state: AuthState = Depends(auth_state),
                  rc_refresh: str | None = Cookie(default=None)) -> TokenResponse:
    session = state.consume_refresh_token(rc_refresh)          # the old token is dead from here on
    row = await _lookup(_db(request), session.email)
    if not (row and row["is_active"]):
        raise invalid_credentials()
    claims = Claims(row["actor_id"], row["org_id"], row["role"])
    token, ttl = state.issue_access_token(claims)
    _set_cookie(response, state, state.new_refresh_token(session.email, claims))
    return TokenResponse(access_token=token, expires_in=ttl)


@router.post("/logout", status_code=204)
async def logout(response: Response, state: AuthState = Depends(auth_state),
                 rc_refresh: str | None = Cookie(default=None)) -> None:
    state.revoke_refresh_token(rc_refresh)
    response.delete_cookie(REFRESH_COOKIE, path="/api/v1/auth")


@router.get("/me")
async def me(request: Request, claims: Claims = Depends(current_claims)) -> dict[str, Any]:
    """Who the caller is, and the facilities of their organisation (every event is recorded at a facility)."""
    rows = await _db(request).query(
        claims,
        """SELECT a.actor_id, a.full_name, a.role, o.org_id, o.org_name, o.org_type,
                  COALESCE((SELECT jsonb_agg(jsonb_build_object('facility_id', f.facility_id,
                                   'facility_name', f.facility_name) ORDER BY f.facility_id)
                              FROM facility f WHERE f.org_id = o.org_id), '[]'::jsonb) AS facilities
             FROM actor a JOIN facility fa ON fa.facility_id = a.facility_id
             JOIN organization o ON o.org_id = fa.org_id WHERE a.actor_id = %s""", [claims.actor_id])
    if not rows:
        raise invalid_credentials()
    return rows[0]
