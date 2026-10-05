"""Reports Q1-Q8 (FR-10), CSV export, and the audit endpoints (FR-10.8, FR-12.2)."""
from __future__ import annotations

import csv
import io
import json
from collections.abc import Iterator
from datetime import datetime
from typing import Any, Literal

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import StreamingResponse

from app.allowlist import ROLE_MAP
from app.auth import current_claims, require_roles
from app.db import Claims, Database
from app.errors import ApiException

router = APIRouter(tags=["reports"])
STAFF = tuple(ROLE_MAP)
OVERSIGHT = ("AUDITOR", "ADMIN")
VERIFY_BATCH = 1000

# report name -> roles allowed to read it (the database grants decide again)
REPORT_ROLES: dict[str, tuple[str, ...]] = {
    "passport": STAFF, "part-tree": STAFF, "current-state": STAFF,
    "reuse-inventory": ("TECHNICIAN", "AUDITOR", "ADMIN"),
    "material-recovery": OVERSIGHT,
    "certificate-backing": ("PRODUCER", "RECYCLER_OPERATOR", "AUDITOR", "ADMIN"),
    "custody-gaps": OVERSIGHT, "tamper-check": OVERSIGHT,
}

# Q7, copied from db/queries/q7_custody_gaps.sql (TRD section 9)
CUSTODY_GAPS = """SELECT DISTINCT e.unit_id, fn_org_of_facility(e.facility_id) AS org_id
FROM lifecycle_event e
WHERE fn_org_of_facility(e.facility_id) <> COALESCE(
        (SELECT fn_org_of_facility(f.facility_id) FROM lifecycle_event f
          WHERE f.unit_id = e.unit_id ORDER BY f.event_id LIMIT 1), -1)
  AND NOT EXISTS (
        SELECT 1 FROM transfer_item ti JOIN custody_transfer ct USING (transfer_id)
        WHERE ti.unit_id = e.unit_id AND ct.to_org_id = fn_org_of_facility(e.facility_id)
          AND ct.received_at IS NOT NULL AND ct.received_at <= e.occurred_at)
ORDER BY 1"""


def _db(request: Request) -> Database:
    db: Database = request.app.state.db
    return db


def _csv_cell(value: Any) -> Any:
    if isinstance(value, dict | list):
        return json.dumps(value, default=str)
    return "" if value is None else value


def csv_response(name: str, rows: list[dict[str, Any]]) -> StreamingResponse:
    def generate() -> Iterator[str]:
        buf = io.StringIO()
        if rows:
            writer = csv.DictWriter(buf, fieldnames=list(rows[0]))
            writer.writeheader()
            yield buf.getvalue()
            for row in rows:
                buf.seek(0)
                buf.truncate()
                writer.writerow({k: _csv_cell(v) for k, v in row.items()})
                yield buf.getvalue()

    return StreamingResponse(generate(), media_type="text/csv",
                             headers={"Content-Disposition": f'attachment; filename="{name}.csv"'})


async def verify_all(db: Database, claims: Claims) -> tuple[int, list[dict[str, Any]]]:
    """Q8: recompute every unit's chain, VERIFY_BATCH units per query. Returns (units checked, broken units)."""
    checked, last = 0, 0
    broken: list[dict[str, Any]] = []
    while True:
        rows = await db.query(
            claims,
            """SELECT unit_id, sp_verify_chain(unit_id) AS first_broken_event_id FROM unit
                WHERE unit_id > %s ORDER BY unit_id LIMIT 1000""", [last])
        if not rows:
            return checked, broken
        checked += len(rows)
        broken += [r for r in rows if r["first_broken_event_id"] is not None]
        last = rows[-1]["unit_id"]


@router.get("/reports/{name}")
async def get_report(name: str, request: Request, format: Literal["json", "csv"] = "json",
                     unit_id: int | None = None, root: int | None = None, holder_org_id: int | None = None, as_of: datetime | None = None,
                     state: str | None = Query(default=None, max_length=20), category: str | None = None,
                     min_health: int | None = Query(default=None, ge=0, le=100), shortfall: bool = False,
                     limit: int = Query(1000, ge=1, le=50000),
                     claims: Claims = Depends(current_claims)) -> Any:
    if name not in REPORT_ROLES:
        raise ApiException(404, "NOT_FOUND", f"Report {name} does not exist")
    if claims.role not in REPORT_ROLES[name]:
        raise ApiException(403, "FORBIDDEN", "Your role is not allowed to do this")
    db = _db(request)
    rows: list[dict[str, Any]]
    if name == "passport":
        if unit_id is None:
            raise ApiException(400, "INVALID_VALUE", "unit_id: this report needs a unit")
        rows = await db.query(claims, "SELECT * FROM v_unit_passport WHERE unit_id = %s", [unit_id])
    elif name == "part-tree":
        if root is None:
            raise ApiException(400, "INVALID_VALUE", "root: this report needs a root unit")
        params: dict[str, Any] = {"p_root": root}
        if as_of is not None:
            params["p_as_of"] = as_of
        rows = await db.run(claims, "fn_part_tree", **params)
    elif name == "current-state":
        rows = await db.query(
            claims,
            """SELECT c.*, u.serial_no, m.model_number, m.category, m.mass_g, cu.cert_id AS certificate_id
                 FROM v_unit_current c
                 JOIN unit u ON u.unit_id = c.unit_id
                 JOIN part_model m ON m.model_id = u.model_id
                 LEFT JOIN certificate_unit cu ON cu.unit_id = c.unit_id
                WHERE (%(state)s::text IS NULL OR c.current_state = %(state)s)
                  AND (%(holder)s::int IS NULL OR c.current_holder_org_id = %(holder)s)
                ORDER BY c.unit_id LIMIT %(limit)s""", {"state": state, "holder": holder_org_id, "limit": limit})
    elif name == "reuse-inventory":
        rows = await db.query(
            claims,
            """SELECT * FROM v_reuse_inventory
                WHERE (%(category)s::text IS NULL OR category = %(category)s)
                  AND (%(min_health)s::int IS NULL OR latest_health >= %(min_health)s)
                ORDER BY latest_health DESC NULLS LAST, unit_id LIMIT %(limit)s""",
            {"category": category, "min_health": min_health, "limit": limit})
    elif name == "material-recovery":
        rows = await db.query(claims, "SELECT * FROM mv_material_recovery "
                                      "ORDER BY quarter DESC, recycler_id, material_name")
    elif name == "certificate-backing":
        rows = await db.query(
            claims,
            """SELECT * FROM v_certificate_backing WHERE (NOT %(shortfall)s OR backed_kg < claimed_kg)
                ORDER BY cert_id""", {"shortfall": shortfall})
    elif name == "custody-gaps":
        rows = await db.query(claims, CUSTODY_GAPS)
    else:                                              # tamper-check
        _, rows = await verify_all(db, claims)
    if format == "csv":
        return csv_response(name, rows)
    return rows


@router.get("/audit/verify")
async def audit_verify(request: Request, unit: int | None = None,
                       claims: Claims = Depends(require_roles(*OVERSIGHT))) -> dict[str, Any]:
    """One unit when `unit` is given, otherwise every unit in batches of 1,000."""
    db = _db(request)
    if unit is not None:
        rows = await db.run(claims, "sp_verify_chain", p_unit=unit)
        first = rows[0]["sp_verify_chain"]
        return {"unit_id": unit, "verified": first is None, "first_broken_event_id": first}
    checked, broken = await verify_all(db, claims)
    return {"checked": checked, "verified": not broken, "broken": broken}


@router.get("/audit/log")
async def audit_log(request: Request, limit: int = Query(100, ge=1, le=1000), before: int | None = None,
                    claims: Claims = Depends(require_roles(*OVERSIGHT))) -> list[dict[str, Any]]:
    return await _db(request).query(
        claims,
        """SELECT l.log_id, l.logged_at, l.actor_id, a.full_name AS actor_name, l.action, l.entity, l.entity_id,
                  l.details
             FROM audit_log l JOIN actor a ON a.actor_id = l.actor_id
            WHERE (%(before)s::bigint IS NULL OR l.log_id < %(before)s)
            ORDER BY l.log_id DESC LIMIT %(limit)s""", {"before": before, "limit": limit})
