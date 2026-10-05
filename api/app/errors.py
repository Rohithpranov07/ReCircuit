"""Maps database refusals to the PRD error shape {error: {code, constraint, message}} (build playbook B.4)."""
from __future__ import annotations

import logging
from dataclasses import dataclass

import psycopg

log = logging.getLogger("recircuit.errors")


@dataclass
class ApiException(Exception):
    status: int
    code: str
    message: str
    constraint: str | None = None

    def body(self) -> dict[str, dict[str, str | None]]:
        return {"error": {"code": self.code, "constraint": self.constraint, "message": self.message}}


# SQLSTATE raised by our triggers/routines -> (API code, HTTP status)
_RC_CODES: dict[str, tuple[str, int]] = {
    "RC002": ("ASM_CYCLE", 409), "RC003": ("HISTORY_IMMUTABLE", 409), "RC005": ("ILLEGAL_TRANSITION", 422),
    "RC006": ("HARVEST_NOT_INSTALLED", 409), "RC007": ("TEST_WRONG_EVENT", 409),
    "RC008": ("TRANSFER_ALREADY_OPEN", 409), "RC009": ("CERT_UNIT_NOT_RECYCLED", 409),
    "RC010": ("CERT_OVERCLAIM", 409), "RC011": ("EVENT_OUT_OF_ORDER", 422), "RC012": ("SPEC_KEY_UNKNOWN", 400),
    "RC013": ("FACILITY_NOT_YOURS", 403), "RC014": ("TRANSFER_NOT_OPEN", 409),
    "RC015": ("CERT_ALREADY_ALLOCATED", 409), "RC016": ("NOT_A_PRODUCER", 422),
}


def map_db_error(exc: psycopg.Error) -> ApiException:
    state = exc.sqlstate or ""
    constraint = exc.diag.constraint_name
    detail = exc.diag.message_primary or "The database refused the request"
    if state in _RC_CODES:
        code, status = _RC_CODES[state]
        return ApiException(status, code, detail)
    if state == "23P01" and constraint == "assembly_link_excl":
        return ApiException(409, "ASM_OVERLAP",
                            "This unit is already installed in another unit during that period", constraint)
    if state == "23505":
        if constraint == "certificate_unit_pkey":
            return ApiException(409, "CERT_UNIT_REUSED", "This unit already backs another certificate", constraint)
        return ApiException(409, "DUPLICATE", "A record with the same unique value already exists", constraint)
    if state == "42501":
        return ApiException(403, "FORBIDDEN", "Your role is not allowed to do this")
    if state == "40001":
        return ApiException(409, "CONFLICT_RETRY", "The request conflicted with another one; please retry")
    if state == "23514" or state == "23503" or state.startswith("22"):
        return ApiException(400, "INVALID_VALUE", "One of the submitted values is not valid", constraint)
    log.error("unmapped database error sqlstate=%s constraint=%s message=%s", state, constraint, detail)
    return ApiException(500, "INTERNAL_ERROR", "Something went wrong on our side")
