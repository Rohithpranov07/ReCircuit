"""Settings read from the environment (build playbook B.1). No defaults for secrets."""
from __future__ import annotations

import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    database_url: str
    jwt_secret: str
    jwt_access_ttl_min: int
    jwt_refresh_ttl_days: int
    bcrypt_rounds: int
    login_max_failures: int
    login_lock_minutes: int
    public_base_url: str
    public_rate_limit: str
    cors_origins: list[str]
    serializable_retries: int

    @classmethod
    def from_env(cls) -> Settings:
        env = os.environ
        return cls(
            database_url=env["DATABASE_URL"],
            jwt_secret=env.get("JWT_SECRET", ""),
            jwt_access_ttl_min=int(env.get("JWT_ACCESS_TTL_MIN", "15")),
            jwt_refresh_ttl_days=int(env.get("JWT_REFRESH_TTL_DAYS", "7")),
            bcrypt_rounds=int(env.get("BCRYPT_ROUNDS", "12")),
            login_max_failures=int(env.get("LOGIN_MAX_FAILURES", "5")),
            login_lock_minutes=int(env.get("LOGIN_LOCK_MINUTES", "15")),
            public_base_url=env.get("PUBLIC_BASE_URL", "http://localhost:5173"),
            public_rate_limit=env.get("PUBLIC_RATE_LIMIT", "30/minute"),
            cors_origins=[o.strip() for o in env.get("CORS_ORIGINS", "").split(",") if o.strip()],
            serializable_retries=int(env.get("SERIALIZABLE_RETRIES", "3")),
        )
