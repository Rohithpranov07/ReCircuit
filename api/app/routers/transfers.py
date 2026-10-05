"""Chain of custody (FR-8). Manifests are visible to the two organisations involved (row-level security)."""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Request, Response

from app.auth import require_roles
from app.db import Claims, Database
from app.schemas import ReceiveRequest, TransferCreate

router = APIRouter(tags=["transfers"])
PARTIES = ("COLLECTOR", "TECHNICIAN", "RECYCLER_OPERATOR")


def _db(request: Request) -> Database:
    db: Database = request.app.state.db
    return db


@router.get("/transfers")
async def list_transfers(request: Request,
                         claims: Claims = Depends(require_roles(*PARTIES))) -> list[dict[str, Any]]:
    return await _db(request).query(
        claims,
        """SELECT ct.transfer_id, ct.manifest_no, ct.from_org_id, fo.org_name AS from_org, ct.to_org_id,
                  tor.org_name AS to_org, ct.shipped_at, ct.received_at, ct.total_mass_kg,
                  COALESCE((SELECT jsonb_agg(jsonb_build_object('unit_id', ti.unit_id,
                                   'declared_condition', ti.declared_condition, 'serial_no', u.serial_no,
                                   'model_number', pm.model_number) ORDER BY ti.unit_id)
                              FROM transfer_item ti JOIN unit u ON u.unit_id = ti.unit_id
                              JOIN part_model pm ON pm.model_id = u.model_id
                             WHERE ti.transfer_id = ct.transfer_id), '[]'::jsonb) AS items,
                  COALESCE((SELECT jsonb_agg(jsonb_build_object('unit_id', d.unit_id, 'kind', d.kind)
                                   ORDER BY d.unit_id)
                              FROM transfer_discrepancy d WHERE d.transfer_id = ct.transfer_id),
                           '[]'::jsonb) AS discrepancies
             FROM custody_transfer ct
             JOIN organization fo ON fo.org_id = ct.from_org_id
             JOIN organization tor ON tor.org_id = ct.to_org_id
            ORDER BY ct.shipped_at DESC, ct.transfer_id DESC LIMIT 500""")


@router.post("/transfers", status_code=201)
async def create_transfer(body: TransferCreate, request: Request,
                          claims: Claims = Depends(require_roles(*PARTIES))) -> dict[str, int]:
    rows = await _db(request).run(
        claims, "sp_create_transfer", p_manifest_no=body.manifest_no, p_to_org=body.to_org_id,
        p_shipped_at=body.shipped_at, p_total_mass_kg=body.total_mass_kg,
        p_items=[i.model_dump() for i in body.items])
    return {"transfer_id": rows[0]["sp_create_transfer"]}


@router.post("/transfers/{transfer_id}/receive", status_code=204)
async def receive_transfer(transfer_id: int, body: ReceiveRequest, request: Request,
                           claims: Claims = Depends(require_roles(*PARTIES))) -> Response:
    await _db(request).run(claims, "sp_receive_transfer", p_transfer=transfer_id, p_at=body.received_at,
                           p_missing=body.missing_unit_ids, p_extra=body.extra_unit_ids)
    return Response(status_code=204)
