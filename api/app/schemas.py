"""Pydantic models; they mirror build playbook B.2 field for field. Sections are added task by task."""
from __future__ import annotations

from pydantic import BaseModel, Field


# --- authentication (T3.3) ---------------------------------------------------------------------------
class LoginRequest(BaseModel):
    email: str = Field(min_length=3, max_length=120)
    password: str = Field(min_length=1, max_length=256)


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int        # seconds
