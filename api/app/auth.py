"""Password hashing, JWT access tokens, single-use refresh tokens, login lockout and role guards (FR-1).

Refresh sessions and failure counters live in process memory: this is the documented single-instance limitation
of the lab deployment (TRD section 3). Only SHA-256 digests of refresh tokens are kept; passwords and tokens
are never logged."""
from __future__ import annotations

import hashlib
import logging
import secrets
import time
from collections import defaultdict, deque
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any

import jwt
from fastapi import Depends, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from passlib.context import CryptContext

from app.allowlist import ROLE_MAP
from app.config import Settings
from app.db import Claims
from app.errors import ApiException

log = logging.getLogger("recircuit.auth")
ALGORITHM = "HS256"
REFRESH_COOKIE = "rc_refresh"


def invalid_credentials() -> ApiException:
    return ApiException(401, "INVALID_CREDENTIALS", "Email or password is incorrect")


def unauthenticated() -> ApiException:
    return ApiException(401, "UNAUTHENTICATED", "Please sign in again")


@dataclass
class RefreshSession:
    email: str
    claims: Claims
    expires_at: float


class AuthState:
    """Server-side state: bcrypt context, lockout counters and refresh sessions."""

    def __init__(self, settings: Settings, clock: Callable[[], float] = time.time) -> None:
        self.settings = settings
        self.clock = clock
        self.hasher = CryptContext(schemes=["bcrypt"], bcrypt__rounds=settings.bcrypt_rounds)
        self._dummy_hash = self.hasher.hash(secrets.token_urlsafe(8))     # equalises timing for unknown emails
        self._failures: dict[str, deque[float]] = defaultdict(deque)
        self._locked_until: dict[str, float] = {}
        self._refresh: dict[str, RefreshSession] = {}
        if len(settings.jwt_secret.encode()) < 32:
            log.warning("JWT_SECRET is shorter than 32 bytes; set a long random value outside local development")

    # -- passwords --------------------------------------------------------------------------------------
    def hash_password(self, password: str) -> str:
        return str(self.hasher.hash(password))

    def verify_password(self, password: str, password_hash: str | None) -> bool:
        if password_hash is None:
            self.hasher.verify(password, self._dummy_hash)
            return False
        try:
            return bool(self.hasher.verify(password, password_hash))
        except ValueError:
            return False

    # -- lockout (FR-1.1) -------------------------------------------------------------------------------
    def is_locked(self, email: str) -> bool:
        until = self._locked_until.get(email)
        if until is None:
            return False
        if until <= self.clock():
            del self._locked_until[email]
            self._failures.pop(email, None)
            return False
        return True

    def record_failure(self, email: str) -> None:
        now = self.clock()
        window = self.settings.login_lock_minutes * 60
        failures = self._failures[email]
        failures.append(now)
        while failures and failures[0] <= now - window:
            failures.popleft()
        if len(failures) >= self.settings.login_max_failures:
            self._locked_until[email] = now + window

    def record_success(self, email: str) -> None:
        self._failures.pop(email, None)
        self._locked_until.pop(email, None)

    # -- tokens -----------------------------------------------------------------------------------------
    def issue_access_token(self, claims: Claims) -> tuple[str, int]:
        now = int(self.clock())
        ttl = self.settings.jwt_access_ttl_min * 60
        payload = {"sub": str(claims.actor_id), "actor_id": claims.actor_id, "org_id": claims.org_id,
                   "role": claims.role, "iat": now, "exp": now + ttl, "typ": "access"}
        return jwt.encode(payload, self.settings.jwt_secret, algorithm=ALGORITHM), ttl

    def decode_access_token(self, token: str) -> Claims:
        try:
            data: dict[str, Any] = jwt.decode(token, self.settings.jwt_secret, algorithms=[ALGORITHM],
                                              options={"require": ["exp", "iat"], "verify_exp": False})
        except jwt.InvalidTokenError as exc:
            raise unauthenticated() from exc
        if data["exp"] <= self.clock():                     # expiry is judged on the injectable clock
            raise unauthenticated()
        if data.get("typ") != "access" or data.get("role") not in ROLE_MAP:
            raise unauthenticated()
        return Claims(int(data["actor_id"]), int(data["org_id"]), str(data["role"]))

    @staticmethod
    def _digest(token: str) -> str:
        return hashlib.sha256(token.encode()).hexdigest()

    def new_refresh_token(self, email: str, claims: Claims) -> str:
        token = secrets.token_urlsafe(32)
        ttl = self.settings.jwt_refresh_ttl_days * 86400
        self._refresh[self._digest(token)] = RefreshSession(email, claims, self.clock() + ttl)
        return token

    def consume_refresh_token(self, token: str | None) -> RefreshSession:
        """Single use: the session is removed whether or not the caller proceeds."""
        if not token:
            raise unauthenticated()
        session = self._refresh.pop(self._digest(token), None)
        if session is None or session.expires_at <= self.clock():
            raise unauthenticated()
        return session

    def revoke_refresh_token(self, token: str | None) -> None:
        if token:
            self._refresh.pop(self._digest(token), None)


# --- request guards --------------------------------------------------------------------------------------
_bearer = HTTPBearer(auto_error=False)


def auth_state(request: Request) -> AuthState:
    state: AuthState = request.app.state.auth
    return state


async def current_claims(request: Request,
                         creds: HTTPAuthorizationCredentials | None = Depends(_bearer)) -> Claims:
    if creds is None:
        raise unauthenticated()
    return auth_state(request).decode_access_token(creds.credentials)


def require_roles(*roles: str) -> Callable[..., Awaitable[Claims]]:
    """Dependency factory: the caller must be signed in with one of `roles`. The database enforces the same
    rules again; this check gives a clean 403 before any query is made."""
    unknown = set(roles) - set(ROLE_MAP)
    if unknown:
        raise ValueError(f"unknown role(s): {sorted(unknown)}")

    async def guard(claims: Claims = Depends(current_claims)) -> Claims:
        if claims.role not in roles:
            raise ApiException(403, "FORBIDDEN", "Your role is not allowed to do this")
        return claims

    return guard
