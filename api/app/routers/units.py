"""Unit passports, assembly, events and diagnostics (FR-4 to FR-7). State, holder and parent are read from
the database views; nothing is derived here."""
from __future__ import annotations

import io
import json
from datetime import datetime
from typing import Any
from uuid import UUID

import psycopg
import qrcode
from fastapi import APIRouter, Depends, Query, Request, Response
from qrcode.image.pil import PilImage

from app.allowlist import ROLE_MAP
from app.auth import require_roles
from app.db import Claims, Database
from app.errors import ApiException
from app.schemas import (
    BulkUnits,
    Category,
    DismantleRequest,
    EventCreate,
    HarvestRequest,
    ReinstallRequest,
    TestsRequest,
    UnitCreate,
    UnitPassport,
)

router = APIRouter(tags=["units"])
STAFF = tuple(ROLE_MAP)


def _db(request: Request) -> Database:
    db: Database = request.app.state.db
    return db


def not_found(what: str) -> ApiException:
    return ApiException(404, "NOT_FOUND", f"{what} was not found")


LAST_EVENT = ("SELECT event_type, encode(event_hash, 'hex') AS event_hash FROM lifecycle_event "
              "WHERE unit_id = %s ORDER BY event_id DESC LIMIT 1")


# --- creation -------------------------------------------------------------------------------------------------
@router.post("/units", status_code=201)
async def create_unit(body: UnitCreate, request: Request,
                      claims: Claims = Depends(require_roles("PRODUCER", "COLLECTOR"))) -> dict[str, Any]:
    rows = await _db(request).run(claims, "sp_create_unit", p_model=body.model_id, p_serial=body.serial_no,
                                  p_manufactured_on=body.manufactured_on, p_parent=body.parent_unit_id)
    return {"unit_id": rows[0]["sp_create_unit"]}


@router.post("/units/bulk", status_code=201)
async def bulk_create_units(body: BulkUnits, request: Request,
                            claims: Claims = Depends(require_roles("PRODUCER", "COLLECTOR"))) -> dict[str, Any]:
    units = [u.model_dump(mode="json") for u in body.units]
    rows = await _db(request).run(claims, "sp_bulk_create_units", p_units=units)
    return {"unit_ids": rows[0]["sp_bulk_create_units"]}


# --- passport -------------------------------------------------------------------------------------------------
@router.get("/units/{passport_uid}", response_model=UnitPassport)
async def get_passport(passport_uid: UUID, request: Request,
                       claims: Claims = Depends(require_roles(*STAFF))) -> UnitPassport:
    """Q1 in two steps (docs/plans/SUMMARY.md): resolve passport_uid to unit_id, then read the view by unit_id."""
    async def work(conn: psycopg.AsyncConnection[dict[str, Any]]) -> dict[str, Any] | None:
        cur = await conn.execute("SELECT unit_id FROM unit WHERE passport_uid = %s", [passport_uid])
        found = await cur.fetchone()
        if found is None:
            return None
        unit_id = found["unit_id"]
        cur = await conn.execute("SELECT * FROM v_unit_passport WHERE unit_id = %s", [unit_id])
        passport = await cur.fetchone()
        assert passport is not None
        cur = await conn.execute(
            """SELECT mat.material_name, mm.mass_mg, mat.is_critical FROM model_material mm
                 JOIN material mat ON mat.material_id = mm.material_id
                WHERE mm.model_id = %s ORDER BY mat.material_name""", [passport["model_id"]])
        materials = await cur.fetchall()
        holder = parent = None
        if passport["current_holder_org_id"] is not None:
            cur = await conn.execute("SELECT org_id, org_name FROM organization WHERE org_id = %s",
                                     [passport["current_holder_org_id"]])
            holder = await cur.fetchone()
        if passport["current_parent_id"] is not None:
            cur = await conn.execute(
                """SELECT u.unit_id, u.passport_uid, m.model_number FROM unit u
                     JOIN part_model m ON m.model_id = u.model_id WHERE u.unit_id = %s""",
                [passport["current_parent_id"]])
            parent = await cur.fetchone()
        cur = await conn.execute("SELECT sp_verify_chain(%s) IS NULL AS ok", [unit_id])
        verified = await cur.fetchone()
        assert verified is not None
        return {"passport": passport, "materials": materials, "holder": holder, "parent": parent,
                "verified": verified["ok"]}

    data = await _db(request).transaction(claims, work)
    if data is None:
        raise not_found("Passport")
    p = data["passport"]
    return UnitPassport.model_validate({
        "unit_id": p["unit_id"], "passport_uid": str(p["passport_uid"]), "serial_no": p["serial_no"],
        "manufactured_on": p["manufactured_on"],
        "model": {"model_id": p["model_id"], "model_number": p["model_number"], "category": p["category"],
                  "mass_g": float(p["mass_g"]), "manufacturer": p["manufacturer"], "spec": p["spec"] or {},
                  "materials": [{"material_name": m["material_name"], "mass_mg": float(m["mass_mg"]),
                                 "is_critical": m["is_critical"]} for m in data["materials"]]},
        "current_state": p["current_state"], "state_since": p["state_since"],
        "current_holder": data["holder"],
        "current_parent": ({**data["parent"], "passport_uid": str(data["parent"]["passport_uid"])}
                           if data["parent"] else None),
        "chain_verified": data["verified"],
    })


@router.get("/units/{unit_id}/qr")
async def get_qr(unit_id: int, request: Request,
                 claims: Claims = Depends(require_roles(*STAFF))) -> Response:
    rows = await _db(request).query(claims, "SELECT passport_uid FROM unit WHERE unit_id = %s", [unit_id])
    if not rows:
        raise not_found("Unit")
    base = request.app.state.settings.public_base_url.rstrip("/")
    buf = io.BytesIO()
    image = qrcode.make(f"{base}/p/{rows[0]['passport_uid']}", image_factory=PilImage)
    image.save(buf, format="PNG")
    return Response(content=buf.getvalue(), media_type="image/png")


# --- assembly -------------------------------------------------------------------------------------------------
@router.get("/units/{unit_id}/tree")
async def get_tree(unit_id: int, request: Request, as_of: datetime | None = None,
                   claims: Claims = Depends(require_roles(*STAFF))) -> list[dict[str, Any]]:
    params: dict[str, Any] = {"p_root": unit_id}
    if as_of is not None:
        params["p_as_of"] = as_of
    return await _db(request).run(claims, "fn_part_tree", **params)


@router.get("/units/{unit_id}/history")
async def get_assembly_history(unit_id: int, request: Request,
                               claims: Claims = Depends(require_roles(*STAFF))) -> list[dict[str, Any]]:
    """FR-5.7: every device the part has been inside, in install order, with durations."""
    return await _db(request).query(
        claims,
        """SELECT a.parent_unit_id, p.passport_uid, m.model_number, a.installed_at, a.removed_at,
                  COALESCE(a.removed_at, now()) - a.installed_at AS duration
             FROM assembly_link a
             JOIN unit p ON p.unit_id = a.parent_unit_id
             JOIN part_model m ON m.model_id = p.model_id
            WHERE a.child_unit_id = %s ORDER BY a.installed_at""", [unit_id])


@router.post("/units/{unit_id}/dismantle", status_code=201)
async def dismantle(unit_id: int, body: DismantleRequest, request: Request,
                    claims: Claims = Depends(require_roles("COLLECTOR", "TECHNICIAN"))) -> dict[str, Any]:
    parts = [p.model_dump() for p in body.parts]
    rows = await _db(request).run(
        claims, "sp_dismantle", p_device=unit_id, p_parts=parts, p_at=body.occurred_at,
        p_facility=body.facility_id,
        followup=("""SELECT u.unit_id, u.serial_no, u.model_id FROM unit u
                      JOIN jsonb_to_recordset(%s::jsonb) AS x(model_id int, serial_no text)
                        ON x.model_id = u.model_id AND x.serial_no = u.serial_no ORDER BY u.unit_id""",
                  [json.dumps(parts)]))
    return {"parts": rows}


@router.post("/units/{unit_id}/harvest", status_code=201)
async def harvest(unit_id: int, body: HarvestRequest, request: Request,
                  claims: Claims = Depends(require_roles("TECHNICIAN"))) -> dict[str, Any]:
    rows = await _db(request).run(claims, "sp_harvest", p_unit=unit_id, p_at=body.occurred_at,
                                  p_facility=body.facility_id, followup=(LAST_EVENT, [unit_id]))
    return dict(rows[0])


@router.post("/units/{unit_id}/reinstall", status_code=201)
async def reinstall(unit_id: int, body: ReinstallRequest, request: Request,
                    claims: Claims = Depends(require_roles("TECHNICIAN"))) -> dict[str, Any]:
    rows = await _db(request).run(claims, "sp_reinstall", p_unit=unit_id, p_new_parent=body.new_parent_unit_id,
                                  p_at=body.occurred_at, p_facility=body.facility_id,
                                  followup=(LAST_EVENT, [unit_id]))
    return dict(rows[0])


# --- events and tests -----------------------------------------------------------------------------------------
@router.get("/units/{unit_id}/events")
async def list_events(unit_id: int, request: Request,
                      claims: Claims = Depends(require_roles(*STAFF))) -> list[dict[str, Any]]:
    """FR-6.7: the timeline, ordered by occurred_at, with facility, actor and tests."""
    return await _db(request).query(
        claims,
        """SELECT e.event_id, e.event_type, e.occurred_at, e.recorded_at, e.facility_id, f.facility_name,
                  e.actor_id, a.full_name AS actor_name, encode(e.event_hash, 'hex') AS event_hash,
                  e.corrects_event_id,
                  COALESCE((SELECT jsonb_agg(jsonb_build_object('test_type', t.test_type, 'result', t.result,
                                   'measured_value', t.measured_value, 'health_score', t.health_score)
                                   ORDER BY t.test_id)
                              FROM diagnostic_test t WHERE t.event_id = e.event_id), '[]'::jsonb) AS tests
             FROM lifecycle_event e
             JOIN facility f ON f.facility_id = e.facility_id
             JOIN actor a ON a.actor_id = e.actor_id
            WHERE e.unit_id = %s ORDER BY e.occurred_at, e.event_id""", [unit_id])


@router.post("/units/{unit_id}/events", status_code=201)
async def record_event(unit_id: int, body: EventCreate, request: Request,
                       claims: Claims = Depends(require_roles("PRODUCER", "COLLECTOR", "TECHNICIAN",
                                                              "RECYCLER_OPERATOR"))) -> dict[str, Any]:
    rows = await _db(request).run(claims, "sp_record_event", p_unit=unit_id, p_type=body.event_type,
                                  p_at=body.occurred_at, p_facility=body.facility_id,
                                  p_corrects=body.corrects_event_id, followup=(LAST_EVENT, [unit_id]))
    return dict(rows[0])


@router.post("/units/{unit_id}/tests", status_code=201)
async def record_tests(unit_id: int, body: TestsRequest, request: Request,
                       claims: Claims = Depends(require_roles("TECHNICIAN"))) -> dict[str, Any]:
    rows = await _db(request).run(claims, "sp_record_tests", p_unit=unit_id, p_at=body.occurred_at,
                                  p_facility=body.facility_id, p_tests=[t.model_dump() for t in body.tests],
                                  followup=(LAST_EVENT, [unit_id]))
    return dict(rows[0])


# --- reuse inventory ------------------------------------------------------------------------------------------
inventory = APIRouter(tags=["inventory"])


@inventory.get("/inventory/reuse")
async def reuse_inventory(request: Request, category: Category | None = None,
                          min_health: int | None = Query(default=None, ge=0, le=100),
                          claims: Claims = Depends(require_roles("TECHNICIAN"))) -> list[dict[str, Any]]:
    """Q4 / FR-7.3: loose parts with their latest health, filtered by category and minimum health."""
    return await _db(request).query(
        claims,
        """SELECT unit_id, passport_uid, category, model_number, latest_health, test_type, tested_at,
                  current_holder_org_id
             FROM v_reuse_inventory
            WHERE (%(category)s::text IS NULL OR category = %(category)s)
              AND (%(min_health)s::int IS NULL OR latest_health >= %(min_health)s)
            ORDER BY latest_health DESC NULLS LAST, unit_id LIMIT 500""",
        {"category": category, "min_health": min_health})

